// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";

import { stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import { bundleFunctions, entrySource } from "./bundle-functions";

afterAll(() => stopBundlerWorker());

const T = 60_000;
const CAT = "2026-11";

describe("bundleFunctions", () => {
  it("dos funciones, lo compartido, zod y los tipos de Supabase: un index.mjs y sus trozos", { timeout: T }, async () => {
    const r = await bundleFunctions({
      catalog: CAT,
      mode: "development",
      files: {
        "/supabase/functions/_shared/cors.ts": 'export const corsHeaders = { "Access-Control-Allow-Origin": "*" };\n',
        "/supabase/functions/hola/index.ts":
          'import "jsr:@supabase/functions-js/edge-runtime.d.ts";\nimport { z } from "npm:zod";\nimport { corsHeaders } from "../_shared/cors.ts";\nDeno.serve(async (req) => {\n  const { name } = z.object({ name: z.string() }).parse(await req.json());\n  return Response.json({ message: `Hello ${name}!` }, { headers: corsHeaders });\n});\n',
        "/supabase/functions/viejo/index.ts":
          'import { serve } from "https://deno.land/std@0.168.0/http/server.ts";\nimport { corsHeaders } from "../_shared/cors";\nserve(() => new Response("ok", { headers: corsHeaders }));\n',
      },
    });
    expect(r?.ok).toBe(true);
    if (!r?.ok) return;
    expect(r.functions.map((f) => f.name)).toEqual(["hola", "viejo"]);
    expect(Object.keys(r.files)).toContain("index.mjs");
    expect(Object.keys(r.files).some((f) => f.startsWith("chunks/") && f.endsWith(".mjs"))).toBe(true);
    expect(r.files["index.mjs"]).toContain("createHandler");
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(r.maps).length).toBeGreaterThan(0);
    expect(r.warnings).toEqual([]);
  });

  it("lo que no está en el catálogo: un diagnóstico con fichero y línea", { timeout: T }, async () => {
    const r = await bundleFunctions({
      catalog: CAT,
      mode: "development",
      files: { "/supabase/functions/a/index.ts": '// uno\nimport pad from "npm:left-pad@1";\nDeno.serve(() => new Response(pad("x", 3)));\n' },
    });
    expect(r?.ok).toBe(false);
    if (r?.ok !== false) return;
    expect(r.errors[0]).toMatchObject({ ruta: "/supabase/functions/a/index.ts", linea: 2, gravedad: "Error", codigo: "functions-bundle", fuente: "esbuild" });
    expect(r.errors[0]!.mensaje).toMatch(/isn't in this project's Edge Functions catalog/);
  });

  it("un error de sintaxis dice su línea", { timeout: T }, async () => {
    const r = await bundleFunctions({ catalog: CAT, mode: "development", files: { "/supabase/functions/a/index.ts": "Deno.serve(() => {\n  return new Response(\n});\n" } });
    expect(r?.ok === false && r.errors[0]!.linea).toBe(3);
  });

  it("otra versión mayor avisa, no rompe", { timeout: T }, async () => {
    const r = await bundleFunctions({
      catalog: CAT,
      mode: "development",
      files: { "/supabase/functions/a/index.ts": 'import Stripe from "npm:stripe@14";\nDeno.serve(() => new Response(typeof Stripe));\n' },
    });
    expect(r?.ok).toBe(true);
    expect(r?.warnings[0]).toMatchObject({ ruta: "/supabase/functions/a/index.ts", linea: 1, gravedad: "Warning", codigo: "functions-version" });
  });

  it("la disposición rota y la carpeta vacía", { timeout: T }, async () => {
    const malo = await bundleFunctions({ catalog: CAT, mode: "development", files: { "/supabase/functions/9/index.ts": "" } });
    expect(malo?.ok === false && malo.errors[0]!.ruta).toBe("/supabase/functions/9/");
    expect(await bundleFunctions({ catalog: CAT, mode: "development", files: {} })).toEqual({ ok: true, hash: "empty", files: {}, maps: {}, functions: [], warnings: [] });
  });

  it("misma carpeta, mismo paquete (caché por contenido)", { timeout: T }, async () => {
    const files = { "/supabase/functions/a/index.ts": 'Deno.serve(() => new Response("a"));\n' };
    const a = await bundleFunctions({ catalog: CAT, mode: "development", files });
    const b = await bundleFunctions({ catalog: CAT, mode: "development", files: { ...files } });
    expect(a).toBe(b);
  });

  it("🔴 lleva la entrada de Cloudflare y ningún import.meta.url (en workerd no existe)", { timeout: T }, async () => {
    const r = await bundleFunctions({
      catalog: CAT,
      mode: "production",
      files: { "/supabase/functions/pago/index.ts": 'import Stripe from "npm:stripe@23";\nDeno.serve(() => new Response(typeof Stripe));\n' },
    });
    expect(r?.ok).toBe(true);
    if (!r?.ok) return;
    expect(r.files["worker.mjs"]).toContain('import { invoke } from "./index.mjs";');
    expect(r.files["worker.mjs"]).toContain("export default");
    for (const [f, texto] of Object.entries(r.files)) expect(texto.includes("import.meta.url"), f).toBe(false);
  });
});

describe("entrySource", () => {
  it("instala el envoltorio y carga cada función perezosa", () => {
    const s = entrySource([{ name: "hola", entry: "/supabase/functions/hola/index.ts", verifyJwt: true, importMap: null }]);
    expect(s).toContain('import { createHandler, installGlobals } from "openlen:runtime";');
    expect(s).toContain('"hola": () => import("/supabase/functions/hola/index.ts"),');
    expect(s).not.toContain("awslambda");
  });
});
