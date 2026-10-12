// @vitest-environment node
//
// EL MOTOR `cloudflare` (spec local 2026-10-12, Parte 4) contra una API de
// Cloudflare simulada: lo que pide y cómo lee lo que le contestan.
import { describe, expect, it, vi } from "vitest";

import { CloudflareEngine } from "./cloudflare";
import { CloudflareApiError } from "./cloudflare-api";
import type { Frame, InvokeEvent } from "./types";

const CFG = { accountId: "acc1", apiToken: "tok", namespace: "openlen-functions", dispatchUrl: "https://openlen-dispatch.prueba.workers.dev/", dispatchKey: "k" };
const DEST = { ref: "abcdefghijklmnopqrst", environment: "draft" as const };
const BASE = "https://api.cloudflare.com/client/v4/accounts/acc1/workers/dispatch/namespaces/openlen-functions/scripts/openlen-abcdefghijklmnopqrst-draft";
const LIMITS = { cpuMs: 200, subRequests: 1000 };
const EVENTO: InvokeEvent = { fn: "hola", method: "GET", path: "", query: "", headers: [], bodyB64: null, host: "h", remoteAddr: "1.1.1.1" };

type Llamada = { url: string; method: string; init: RequestInit };
const ok = (result: unknown) => new Response(JSON.stringify({ success: true, errors: [], result }), { status: 200 });
const mal = (status: number, message: string) => new Response(JSON.stringify({ success: false, errors: [{ code: 1, message }], result: null }), { status });
const ndjson = (...fs: Frame[]) => fs.map((f) => `${JSON.stringify(f)}\n`).join("");

function api(responder: (c: Llamada) => Response | Promise<Response>) {
  const llamadas: Llamada[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const c = { url: String(url), method: init.method ?? "GET", init };
    llamadas.push(c);
    return responder(c);
  }) as unknown as typeof fetch;
  return { llamadas, engine: new CloudflareEngine(CFG, f) };
}

async function todos(it: AsyncIterable<Frame>): Promise<Frame[]> {
  const out: Frame[] = [];
  for await (const f of it) out.push(f);
  return out;
}

describe("CloudflareEngine — la API", () => {
  it("deploy: un PUT multipart con la entrada, la compatibilidad, cada variable como secret_text, la etiqueta del hash y cada módulo", async () => {
    const { llamadas, engine } = api(() => ok({}));
    await engine.deploy(DEST, { hash: "abc123", files: { "worker.mjs": "w", "index.mjs": "i", "chunks/a.mjs": "a" } }, { SUPABASE_URL: "https://u", STRIPE_SECRET_KEY: "sk" }, { timeoutSec: 150, memoryMb: 128 });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toMatchObject({ url: BASE, method: "PUT" });
    expect((llamadas[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    const form = llamadas[0]!.init.body as FormData;
    expect(JSON.parse(await (form.get("metadata") as Blob).text())).toEqual({
      main_module: "worker.mjs",
      compatibility_date: "2026-07-30",
      compatibility_flags: ["nodejs_compat"],
      bindings: [
        { type: "secret_text", name: "SUPABASE_URL", text: "https://u" },
        { type: "secret_text", name: "STRIPE_SECRET_KEY", text: "sk" },
      ],
      tags: ["h-abc123"],
    });
    for (const [nombre, texto] of [["worker.mjs", "w"], ["index.mjs", "i"], ["chunks/a.mjs", "a"]] as const) {
      const parte = form.get(nombre) as File;
      expect(await parte.text()).toBe(texto);
      expect(parte.type).toBe("application/javascript+module");
    }
  });

  it("un error de la API se lanza con su mensaje (el borrador se lo dice a Len; publicar se niega)", async () => {
    const { engine } = api(() => mal(400, "Uncaught SyntaxError at worker.mjs"));
    const e = await engine.deploy(DEST, { hash: "h", files: { "worker.mjs": "x" } }, {}, { timeoutSec: 1, memoryMb: 128 }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CloudflareApiError);
    expect(e).toMatchObject({ status: 400, message: "Uncaught SyntaxError at worker.mjs" });
  });

  it("deployedHash: la etiqueta del hash; sin script, null", async () => {
    const { engine, llamadas } = api(() => ok(["otra", "h-abc123"]));
    expect(await engine.deployedHash(DEST)).toBe("abc123");
    expect(llamadas[0]).toMatchObject({ url: `${BASE}/tags`, method: "GET" });
    expect(await api(() => mal(404, "This Worker does not exist")).engine.deployedHash(DEST)).toBeNull();
  });

  it("🔴 deployedHash no pregunta a la API en cada llamada: lo que el motor subió o quitó lo sabe, y lo leído vale 5 minutos", async () => {
    let ahora = 0;
    const llamadas: string[] = [];
    const f = (async (url: string, init: RequestInit = {}) => {
      llamadas.push(`${init.method ?? "GET"} ${String(url).replace(BASE, "")}`);
      return init.method === "GET" ? ok(["h-viejo"]) : ok(null);
    }) as unknown as typeof fetch;
    const engine = new CloudflareEngine(CFG, f, () => ahora);
    expect(await engine.deployedHash(DEST)).toBe("viejo");
    expect(await engine.deployedHash(DEST)).toBe("viejo");
    expect(llamadas).toEqual(["GET /tags"]);
    ahora += 5 * 60_000 + 1;
    expect(await engine.deployedHash(DEST)).toBe("viejo");
    expect(llamadas).toEqual(["GET /tags", "GET /tags"]);
    await engine.deploy(DEST, { hash: "nuevo", files: { "worker.mjs": "w" } }, {}, { timeoutSec: 1, memoryMb: 128 });
    expect(await engine.deployedHash(DEST)).toBe("nuevo");
    await engine.remove(DEST);
    expect(await engine.deployedHash(DEST)).toBeNull();
    expect(llamadas).toEqual(["GET /tags", "GET /tags", "PUT ", "DELETE "]);
  });

  it("🔴 una lectura que estaba en vuelo durante un deploy no pisa lo recién subido", async () => {
    let soltarGet: (r: Response) => void = () => undefined;
    const llamadas: string[] = [];
    const f = (async (_url: string, init: RequestInit = {}) => {
      llamadas.push(init.method ?? "GET");
      if ((init.method ?? "GET") === "GET") return new Promise<Response>((r) => (soltarGet = r));
      return ok(null);
    }) as unknown as typeof fetch;
    const engine = new CloudflareEngine(CFG, f);
    const enVuelo = engine.deployedHash(DEST);
    await engine.deploy(DEST, { hash: "nuevo", files: { "worker.mjs": "w" } }, {}, { timeoutSec: 1, memoryMb: 128 });
    soltarGet(ok(["h-viejo"]));
    expect(await enVuelo).toBe("nuevo");
    expect(await engine.deployedHash(DEST)).toBe("nuevo");
    expect(llamadas).toEqual(["GET", "PUT"]);
  });

  it("setEnv: PUT de cada variable y DELETE de las que sobran; sin script, nada", async () => {
    const { engine, llamadas } = api((c) => (c.method === "GET" ? ok([{ name: "A", type: "secret_text" }, { name: "VIEJA", type: "secret_text" }]) : ok({})));
    await engine.setEnv(DEST, { A: "1", B: "2" });
    expect(llamadas.map((c) => `${c.method} ${c.url.replace(BASE, "")}`)).toEqual(["GET /secrets", "PUT /secrets", "PUT /secrets", "DELETE /secrets/VIEJA"]);
    expect(JSON.parse(String(llamadas[1]!.init.body))).toEqual({ name: "A", text: "1", type: "secret_text" });
    const sin = api(() => mal(404, "This Worker does not exist"));
    await sin.engine.setEnv(DEST, { A: "1" });
    expect(sin.llamadas).toHaveLength(1);
  });

  it("remove: DELETE; si ya no estaba (404), bien; otro fallo, se lanza", async () => {
    const { engine, llamadas } = api(() => ok(null));
    await engine.remove(DEST);
    expect(llamadas[0]).toMatchObject({ method: "DELETE", url: BASE });
    await expect(api(() => mal(404, "This Worker does not exist")).engine.remove(DEST)).resolves.toBeUndefined();
    await expect(api(() => mal(500, "boom")).engine.remove(DEST)).rejects.toThrow("boom");
  });
});

describe("CloudflareEngine — invoke", () => {
  it("POST al despachador con la clave, el script y los límites; los marcos según llegan", async () => {
    const marcos: Frame[] = [{ t: "head", status: 200, headers: [] }, { t: "body", b: "aG9sYQ==" }, { t: "body_end" }, { t: "end", ms: 3 }];
    const { engine, llamadas } = api(() => new Response(ndjson(...marcos)));
    expect(await todos(engine.invoke(DEST, EVENTO, { timeoutMs: 5000, limits: LIMITS }))).toEqual(marcos);
    const c = llamadas[0]!;
    expect(c).toMatchObject({ url: CFG.dispatchUrl, method: "POST" });
    expect(c.init.headers).toMatchObject({ "x-openlen-dispatch-key": "k", "x-openlen-script": "openlen-abcdefghijklmnopqrst-draft", "x-openlen-cpu-ms": "200", "x-openlen-subrequests": "1000" });
    expect(JSON.parse(String(c.init.body))).toEqual(EVENTO);
  });

  it("un marco partido entre dos trozos de la red se lee entero", async () => {
    const b = new TextEncoder().encode(ndjson({ t: "log", level: "log", msg: "hola" }, { t: "end", ms: 1 }));
    const cuerpo = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(b.slice(0, 7));
        c.enqueue(b.slice(7));
        c.close();
      },
    });
    const { engine } = api(() => new Response(cuerpo));
    expect(await todos(engine.invoke(DEST, EVENTO, { timeoutMs: 5000, limits: LIMITS }))).toEqual([{ t: "log", level: "log", msg: "hola" }, { t: "end", ms: 1 }]);
  });

  it("🔴 el despachador no contesta, contesta 403 (otra clave) o 5xx: unavailable al momento", async () => {
    const respuestas: (() => Response)[] = [
      () => {
        throw new TypeError("fetch failed");
      },
      () => new Response("forbidden", { status: 403 }),
      () => new Response("bad gateway", { status: 502 }),
    ];
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      for (const responder of respuestas) {
        const fs = await todos(api(responder).engine.invoke(DEST, EVENTO, { timeoutMs: 5000, limits: LIMITS }));
        // Lo que se anota (y Len puede leer) no habla de la fontanería; el detalle va al registro del servidor.
        expect(fs).toEqual([{ t: "error", kind: "unavailable", message: "Edge Functions are temporarily unavailable. Try again in a moment." }]);
      }
      expect(error.mock.calls.map((c) => c.join(" ")).join("\n")).toMatch(/fetch failed[\s\S]*403[\s\S]*502/);
    } finally {
      error.mockRestore();
    }
  });

  it("cortado a mitad (sin marco end): uncaught y fin", async () => {
    const { engine } = api(() => new Response(ndjson({ t: "head", status: 200, headers: [] })));
    expect(await todos(engine.invoke(DEST, EVENTO, { timeoutMs: 5000, limits: LIMITS }))).toEqual([
      { t: "head", status: 200, headers: [] },
      { t: "error", kind: "uncaught", message: "the function stopped before finishing" },
      { t: "end", ms: 0 },
    ]);
  });

  it("se pasa del tiempo: timeout", async () => {
    const { engine } = api((c) => new Promise<Response>((_, rechazar) => c.init.signal!.addEventListener("abort", () => rechazar(new DOMException("aborted", "AbortError")))));
    expect(await todos(engine.invoke(DEST, EVENTO, { timeoutMs: 30, limits: LIMITS }))).toEqual([{ t: "error", kind: "timeout" }]);
  });
});
