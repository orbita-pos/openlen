// @vitest-environment node
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import { bundleFunctions } from "../bundler/bundle-functions";
import type { Frame, InvokeEvent } from "../runtime/runtime.mjs";
import { LocalEngine } from "./local";
import { destinationName, type Destination } from "./types";

const engine = new LocalEngine();
afterAll(async () => {
  await engine.stopAll();
  stopBundlerWorker();
});

const T = 60_000;
const DEST: Destination = { ref: "abcdefghijklmnopqrst", environment: "draft" };
const LIMITES = { timeoutSec: 150, memoryMb: 256 };

const evento = (fn: string, o: Partial<InvokeEvent> = {}): InvokeEvent => ({
  fn,
  method: "GET",
  path: "",
  query: "",
  headers: [],
  bodyB64: null,
  host: "abcdefghijklmnopqrst.openlen.app",
  remoteAddr: "203.0.113.9",
  ...o,
});

async function marcos(dest: Destination, e: InvokeEvent, timeoutMs = 10_000): Promise<Frame[]> {
  const out: Frame[] = [];
  for await (const f of engine.invoke(dest, e, { timeoutMs, limits: { cpuMs: 50, subRequests: 50 } })) out.push(f);
  return out;
}

const cuerpo = (fs: Frame[]) => Buffer.concat(fs.filter((f) => f.t === "body").map((f) => Buffer.from((f as { b: string }).b, "base64"))).toString();

async function desplegar(files: Record<string, string>, env: Record<string, string> = {}, dest = DEST) {
  const b = await bundleFunctions({ files, catalog: "2026-11", mode: "development" });
  if (!b?.ok) throw new Error(JSON.stringify(b));
  await engine.deploy(dest, { hash: b.hash, files: b.files }, env, LIMITES);
  return b;
}

describe("LocalEngine", () => {
  it("despliega e invoca; el hash queda anotado", { timeout: T }, async () => {
    const b = await desplegar({ "/supabase/functions/hola/index.ts": 'import { z } from "npm:zod";\nDeno.serve(() => new Response(z.string().parse("hola")));\n' });
    expect(await engine.deployedHash(DEST)).toBe(b.hash);
    const fs = await marcos(DEST, evento("hola"));
    expect(fs[0]).toMatchObject({ t: "head", status: 200 });
    expect(cuerpo(fs)).toBe("hola");
    expect(fs.at(-1)!.t).toBe("end");
  });

  it("🔴 la función sólo ve las variables que se le dan: nada del servidor", { timeout: T }, async () => {
    process.env.DATABASE_URL_DE_PRUEBA = "postgres://servidor";
    await desplegar(
      { "/supabase/functions/env/index.ts": "Deno.serve(() => Response.json({ deno: Deno.env.toObject(), proc: Object.keys(process.env) }));\n" },
      { SUPABASE_URL: "https://x.openlen.app", AWS_ACCESS_KEY_ID: "AKIA" },
    );
    const r = JSON.parse(cuerpo(await marcos(DEST, evento("env")))) as { deno: Record<string, string>; proc: string[] };
    expect(r.deno).toEqual({ SUPABASE_URL: "https://x.openlen.app", AWS_ACCESS_KEY_ID: "AKIA" });
    expect(r.proc).not.toContain("DATABASE_URL_DE_PRUEBA");
    expect(r.proc).not.toContain("NEXTAUTH_SECRET");
  });

  it("se pasa de tiempo → timeout, y la siguiente llamada arranca limpia", { timeout: T }, async () => {
    await desplegar({
      "/supabase/functions/cuelga/index.ts": "Deno.serve(() => new Promise(() => {}));\n",
      "/supabase/functions/rapida/index.ts": 'Deno.serve(() => new Response("ok"));\n',
    });
    expect(await marcos(DEST, evento("cuelga"), 300)).toEqual([{ t: "error", kind: "timeout" }]);
    expect(cuerpo(await marcos(DEST, evento("rapida")))).toBe("ok");
  });

  it("redesplegar sustituye; quitar deja not_found", { timeout: T }, async () => {
    await desplegar({ "/supabase/functions/v/index.ts": 'Deno.serve(() => new Response("1"));\n' });
    await desplegar({ "/supabase/functions/v/index.ts": 'Deno.serve(() => new Response("2"));\n' });
    expect(cuerpo(await marcos(DEST, evento("v")))).toBe("2");
    await engine.remove(DEST);
    expect(await engine.deployedHash(DEST)).toBeNull();
    expect(await marcos(DEST, evento("v"))).toEqual([{ t: "error", kind: "not_found" }]);
  });

  it("dos destinos no se mezclan", { timeout: T }, async () => {
    const otro: Destination = { ref: "zyxwvutsrqponmlkjihg", environment: "draft" };
    await desplegar({ "/supabase/functions/q/index.ts": 'Deno.serve(() => new Response("A"));\n' });
    await desplegar({ "/supabase/functions/q/index.ts": 'Deno.serve(() => new Response("B"));\n' }, {}, otro);
    expect(cuerpo(await marcos(DEST, evento("q")))).toBe("A");
    expect(cuerpo(await marcos(otro, evento("q")))).toBe("B");
  });

  it("🔴 setEnv: la siguiente llamada ve lo nuevo; la que estaba en curso acaba con lo de antes", { timeout: T }, async () => {
    await desplegar(
      {
        "/supabase/functions/k/index.ts":
          'Deno.serve(async (req) => { const v = Deno.env.get("K"); if (req.url.includes("lento")) await new Promise((r) => setTimeout(r, 400)); return new Response(v ?? "-"); });\n',
      },
      { K: "1" },
    );
    const enCurso = marcos(DEST, evento("k", { path: "/lento" }));
    await new Promise((r) => setTimeout(r, 100));
    await engine.setEnv(DEST, { K: "2" });
    expect(cuerpo(await marcos(DEST, evento("k")))).toBe("2");
    const viejos = await enCurso;
    expect(viejos.at(-1)!.t).toBe("end");
    expect(cuerpo(viejos)).toBe("1");
  });

  it("🔴 setEnv y luego redesplegar: la carpeta del hilo retirado sigue mientras acaba su llamada, y se borra después", { timeout: T }, async () => {
    const b1 = await desplegar({ "/supabase/functions/r/index.ts": 'Deno.serve(async () => { await new Promise((r) => setTimeout(r, 400)); return new Response("viejo"); });\n' });
    const carpeta = path.join(os.tmpdir(), "openlen-functions", destinationName(DEST), b1.hash);
    const enCurso = marcos(DEST, evento("r"));
    await new Promise((r) => setTimeout(r, 100));
    await engine.setEnv(DEST, { K: "2" });
    await desplegar({ "/supabase/functions/r/index.ts": 'Deno.serve(() => new Response("nuevo"));\n' });
    expect(existsSync(carpeta)).toBe(true);
    expect(cuerpo(await enCurso)).toBe("viejo");
    expect(existsSync(carpeta)).toBe(false);
    expect(cuerpo(await marcos(DEST, evento("r")))).toBe("nuevo");
  });

  it("setEnv sin nada desplegado no hace nada", async () => {
    const nada: Destination = { ref: "nadanadanadanadanada", environment: "live" };
    await engine.setEnv(nada, { K: "x" });
    expect(await engine.deployedHash(nada)).toBeNull();
  });
});
