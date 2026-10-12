// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createHandler, installGlobals, type Frame, type InvokeEvent } from "./runtime.mjs";

installGlobals();

const evento = (o: Partial<InvokeEvent> = {}): InvokeEvent => ({
  fn: "hola",
  method: "POST",
  path: "/x",
  query: "a=1",
  headers: [["content-type", "application/json"]],
  bodyB64: Buffer.from('{"name":"Ana"}').toString("base64"),
  host: "abcdefghijklmnopqrst.openlen.app",
  remoteAddr: "203.0.113.9",
  ...o,
});

async function correr(loaders: Record<string, () => Promise<unknown>>, e = evento()): Promise<Frame[]> {
  let texto = "";
  await createHandler(loaders)(e, { write: (c: string) => (texto += c), end: () => undefined });
  return texto.trim().split("\n").map((l) => JSON.parse(l) as Frame);
}

const cuerpo = (fs: Frame[]) => Buffer.concat(fs.filter((f) => f.t === "body").map((f) => Buffer.from((f as { b: string }).b, "base64"))).toString();

describe("createHandler", () => {
  it("Deno.serve: la función ve /<nombre><ruta>?query y su cuerpo; cabecera, cuerpo, fin", async () => {
    const fs = await correr({
      hola: async () => {
        Deno.serve(async (req: Request) => {
          const { name } = (await req.json()) as { name: string };
          return Response.json({ url: req.url, name }, { status: 201, headers: { "x-a": "b" } });
        });
      },
    });
    expect(fs[0]).toMatchObject({ t: "head", status: 201 });
    expect((fs[0] as { headers: [string, string][] }).headers).toContainEqual(["x-a", "b"]);
    expect(JSON.parse(cuerpo(fs))).toEqual({ url: "https://abcdefghijklmnopqrst.openlen.app/hola/x?a=1", name: "Ana" });
    expect(fs.at(-2)).toEqual({ t: "body_end" });
    expect(fs.at(-1)).toMatchObject({ t: "end" });
  });

  it("las tres formas de Deno.serve", async () => {
    const formas: Record<string, () => Promise<unknown>> = {
      a: async () => Deno.serve(() => new Response("a")),
      b: async () => Deno.serve({ port: 8000 }, () => new Response("b")),
      c: async () => Deno.serve({ handler: () => new Response("c") }),
    };
    for (const fn of ["a", "b", "c"]) expect(cuerpo(await correr(formas, evento({ fn, method: "GET", bodyB64: null })))).toBe(fn);
  });

  it("la forma nueva de Supabase: `export default { fetch }` también vale", async () => {
    const fs = await correr({ hola: async () => ({ default: { fetch: async (req: Request) => new Response(`nuevo ${new URL(req.url).pathname}`) } }) });
    expect(cuerpo(fs)).toBe("nuevo /hola/x");
  });

  it("console dentro de la llamada es un marco; fuera, la consola de siempre", async () => {
    const fs = await correr({ hola: async () => Deno.serve(() => (console.log("pedido", { id: 7 }), new Response("ok"))) });
    expect(fs).toContainEqual({ t: "log", level: "log", msg: "pedido { id: 7 }" });
  });

  it("EdgeRuntime.waitUntil corre DESPUÉS de responder y antes del fin", async () => {
    const fs = await correr({
      hola: async () =>
        Deno.serve(() => {
          EdgeRuntime.waitUntil(new Promise((r) => setTimeout(() => (console.log("después"), r(undefined)), 30)));
          return new Response("ya");
        }),
    });
    const i = fs.findIndex((f) => f.t === "body_end");
    const j = fs.findIndex((f) => f.t === "log" && f.msg === "después");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(fs.at(-1)!.t).toBe("end");
  });

  it("errores: lanza → uncaught; nunca llama a Deno.serve → boot; no existe → not_found; no devuelve Response → uncaught", async () => {
    const lanza = await correr({ hola: async () => Deno.serve(() => { throw new TypeError("precio indefinido"); }) });
    expect(lanza[0]).toMatchObject({ t: "error", kind: "uncaught", message: "precio indefinido" });
    expect(lanza.at(-1)!.t).toBe("end");
    expect((await correr({ hola: async () => undefined }))[0]).toMatchObject({ t: "error", kind: "boot", message: "supabase/functions/hola loaded but never called Deno.serve" });
    expect((await correr({}))[0]).toEqual({ t: "error", kind: "not_found" });
    expect((await correr({ hola: async () => Deno.serve(() => "hola" as unknown as Response) }))[0]).toMatchObject({ t: "error", kind: "uncaught", message: "The handler did not return a Response" });
  });

  it("una API de Deno que aquí no hay lo dice", async () => {
    const fs = await correr({ hola: async () => Deno.serve(async () => new Response(await (Deno as unknown as { readTextFile(p: string): Promise<string> }).readTextFile("/x"))) });
    expect(fs[0]).toMatchObject({ t: "error", kind: "uncaught" });
    expect((fs[0] as { message: string }).message).toMatch(/Deno\.readTextFile is not available in OpenLen Edge Functions/);
  });

  it("Deno.env es el entorno de su proceso tal cual: lo pone el motor, y AWS_ ya no se esconde", () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIA";
    process.env.SUPABASE_URL = "https://a.openlen.app";
    expect(Deno.env.get("AWS_ACCESS_KEY_ID")).toBe("AKIA");
    expect(Deno.env.has("SUPABASE_URL")).toBe(true);
    expect(Deno.env.toObject()).toMatchObject({ AWS_ACCESS_KEY_ID: "AKIA", SUPABASE_URL: "https://a.openlen.app" });
  });
});
