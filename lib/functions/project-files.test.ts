// @vitest-environment node
import { describe, expect, it } from "vitest";

import { functionNamesIn, isFunctionsInputPath, readFunctionsLayout } from "./project-files";

const HOLA = 'Deno.serve(() => new Response("hola"));\n';

describe("readFunctionsLayout", () => {
  it("una carpeta por función, sin las `_` ni los ficheros sueltos, ordenadas", () => {
    const r = readFunctionsLayout({
      "/supabase/functions/checkout/index.ts": HOLA,
      "/supabase/functions/a-b_c/index.js": HOLA,
      "/supabase/functions/_shared/cors.ts": "export const x = 1;",
      "/supabase/functions/import_map.json": '{"imports":{"zod":"npm:zod"}}',
      "/supabase/migrations/1_a.sql": "",
    });
    expect(r).toEqual({
      ok: true,
      functions: [
        { name: "a-b_c", entry: "/supabase/functions/a-b_c/index.js", verifyJwt: true, importMap: { zod: "npm:zod" } },
        { name: "checkout", entry: "/supabase/functions/checkout/index.ts", verifyJwt: true, importMap: { zod: "npm:zod" } },
      ],
      sharedImportMap: { zod: "npm:zod" },
    });
  });

  it("config.toml manda: verify_jwt, entrypoint e import_map relativos a /supabase/", () => {
    const r = readFunctionsLayout({
      "/supabase/config.toml": `[functions.webhook]\nverify_jwt = false\nentrypoint = "./functions/webhook/main.ts"\nimport_map = "./functions/webhook/map.json"\n`,
      "/supabase/functions/webhook/main.ts": HOLA,
      "/supabase/functions/webhook/map.json": '{"imports":{"stripe":"npm:stripe@23"}}',
    });
    expect(r).toMatchObject({
      ok: true,
      functions: [{ name: "webhook", entry: "/supabase/functions/webhook/main.ts", verifyJwt: false, importMap: { stripe: "npm:stripe@23" } }],
    });
  });

  it("el deno.json de la función gana al mapa común", () => {
    const r = readFunctionsLayout({
      "/supabase/functions/a/index.ts": HOLA,
      "/supabase/functions/a/deno.json": '{"imports":{"zod":"npm:zod@3"}}',
      "/supabase/functions/import_map.json": '{"imports":{"zod":"npm:zod@4"}}',
    });
    expect(r.ok && r.functions[0]!.importMap).toEqual({ zod: "npm:zod@3" });
  });

  it("errores: nombre inválido, sin entrada, JSON roto, más de 25", () => {
    const malo = readFunctionsLayout({ "/supabase/functions/1mal/index.ts": HOLA });
    expect(malo).toEqual({
      ok: false,
      errors: [
        {
          path: "/supabase/functions/1mal/",
          line: null,
          message: "Invalid Function name: 1mal. Must start with at least one letter, and only include alphanumeric characters, underscores, and hyphens. (^[A-Za-z][A-Za-z0-9_-]*$)",
        },
      ],
    });
    const sinEntrada = readFunctionsLayout({ "/supabase/functions/a/util.ts": "" });
    expect(sinEntrada.ok === false && sinEntrada.errors[0]!.message).toBe("Function a has no entrypoint: write supabase/functions/a/index.ts.");
    const roto = readFunctionsLayout({ "/supabase/functions/a/index.ts": HOLA, "/supabase/functions/a/deno.json": "{" });
    expect(roto.ok === false && roto.errors[0]!.path).toBe("/supabase/functions/a/deno.json");
    const muchas = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`/supabase/functions/f${i}/index.ts`, HOLA]));
    expect(readFunctionsLayout(muchas)).toMatchObject({ ok: false, errors: [{ message: "This project has 26 Edge Functions; the limit is 25." }] });
  });

  it("sin funciones", () => {
    expect(readFunctionsLayout({ "/index.html": "" })).toEqual({ ok: true, functions: [], sharedImportMap: null });
  });
});

describe("isFunctionsInputPath / functionNamesIn", () => {
  it("las funciones y el config.toml, nada más", () => {
    expect(isFunctionsInputPath("/supabase/functions/a/index.ts")).toBe(true);
    expect(isFunctionsInputPath("/supabase/config.toml")).toBe(true);
    expect(isFunctionsInputPath("/supabase/migrations/1.sql")).toBe(false);
    expect(functionNamesIn({ "/supabase/functions/b/x.ts": "", "/supabase/functions/_s/y.ts": "", "/supabase/functions/a/index.ts": "" })).toEqual(["a", "b"]);
  });
});
