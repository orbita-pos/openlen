// @vitest-environment node
//
// `supabase functions …` en la terminal de Len (spec local 2026-10-11, Parte 1):
// los textos de la CLI de Supabase sobre lo nuestro (el borrador es el «local»).
import { describe, expect, it } from "vitest";

import { NEW_FUNCTION_SOURCE, runCli, withVerifyJwtOff, type CliBackend, type FunctionsCli } from "./cli-core";

const nada = () => {
  throw new Error("no en esta prueba");
};

function backend(fx: Partial<FunctionsCli> | null): CliBackend & { desplegados: Record<string, string>[] } {
  const desplegados: Record<string, string>[] = [];
  return {
    desplegados,
    status: nada,
    remoteMigrations: nada,
    liveMigrations: nada,
    applyMigration: nada,
    reset: nada,
    query: nada,
    functions:
      fx === null
        ? null
        : {
            ref: "abcdefghijklmnopqrst",
            deploy: async (f) => (desplegados.push({ ...f }), { ok: true, functions: Object.keys(f).filter((r) => r.endsWith("/index.ts")).map((r) => r.split("/")[3]!) }),
            deployedAt: async () => ({ draft: { hola: new Date("2026-10-11T10:00:00Z") }, live: {} }),
            draftBaseUrl: async () => "https://zyxwvutsrqponmlkjihg.openlen.app/functions/v1/",
            ...fx,
          },
  };
}

const HOLA = { "/supabase/functions/hola/index.ts": 'Deno.serve(() => new Response("hola"));\n' };

describe("supabase functions", () => {
  it("new: crea index.ts con la plantilla de Supabase; nombre inválido y repetido, no", async () => {
    const r = await runCli(["functions", "new", "checkout"], {}, backend({}));
    expect(r).toEqual({ stdout: "Created new Function at supabase/functions/checkout\n", stderr: "", exitCode: 0, escribir: { "/supabase/functions/checkout/index.ts": NEW_FUNCTION_SOURCE } });
    expect(NEW_FUNCTION_SOURCE).toContain('import "jsr:@supabase/functions-js/edge-runtime.d.ts";');
    expect(NEW_FUNCTION_SOURCE).toContain("Deno.serve(async (req) => {");
    expect((await runCli(["functions", "new", "9x"], {}, backend({}))).stderr).toMatch(/^Invalid Function name: 9x\./);
    expect((await runCli(["functions", "new", "hola"], HOLA, backend({}))).exitCode).toBe(1);
    expect((await runCli(["functions", "new"], {}, backend({}))).stderr).toMatch(/accepts 1 arg\(s\), received 0/);
  });

  it("deploy: con los ficheros DE LA TERMINAL, y su salida", async () => {
    const b = backend({});
    const r = await runCli(["functions", "deploy"], HOLA, b);
    expect(r).toMatchObject({ exitCode: 0, stdout: "Deployed Functions on project abcdefghijklmnopqrst: hola\n" });
    expect(b.desplegados[0]).toEqual(HOLA);
    expect((await runCli(["functions", "deploy", "otra"], HOLA, b)).stderr).toBe("Error: Function otra does not exist in supabase/functions\n");
    expect((await runCli(["functions", "deploy"], {}, b)).stdout).toBe("No Functions specified or found in supabase/functions\n");
  });

  it("deploy --no-verify-jwt: lo deja escrito en config.toml, como hace falta para un webhook", async () => {
    const b = backend({});
    const r = await runCli(["functions", "deploy", "hola", "--no-verify-jwt"], HOLA, b);
    expect(r.exitCode).toBe(0);
    expect(r.escribir?.["/supabase/config.toml"]).toBe("[functions.hola]\nverify_jwt = false\n");
    expect(r.stdout).toContain("verify_jwt = false for hola in supabase/config.toml");
    expect(b.desplegados[0]!["/supabase/config.toml"]).toBe("[functions.hola]\nverify_jwt = false\n");
  });

  it("deploy que no compila: el error con fichero y línea, código 1", async () => {
    const r = await runCli(["functions", "deploy"], HOLA, backend({ deploy: async () => ({ ok: false, message: "Error: failed to bundle the Edge Functions:\nsupabase/functions/hola/index.ts:2:8: x\n" }) }));
    expect(r).toEqual({ stdout: "", stderr: "Error: failed to bundle the Edge Functions:\nsupabase/functions/hola/index.ts:2:8: x\n", exitCode: 1 });
  });

  it("list, delete y serve", async () => {
    const lista = await runCli(["functions", "list"], HOLA, backend({}));
    expect(lista.stdout).toContain("NAME");
    expect(lista.stdout).toMatch(/hola\s+\| 2026-10-11 10:00:00 \|/);
    const del = await runCli(["functions", "delete", "hola"], { ...HOLA, "/supabase/functions/hola/deno.json": "{}" }, backend({}));
    expect(del).toEqual({ stdout: "Deleted Function hola from project abcdefghijklmnopqrst.\n", stderr: "", exitCode: 0, borrar: ["/supabase/functions/hola/index.ts", "/supabase/functions/hola/deno.json"] });
    expect((await runCli(["functions", "delete", "nada"], HOLA, backend({}))).exitCode).toBe(1);
    expect((await runCli(["functions", "serve"], HOLA, backend({}))).stdout).toContain("https://zyxwvutsrqponmlkjihg.openlen.app/functions/v1/<function name>");
  });

  it("sin motor en el servidor lo dice (no lo finge); `new` sí funciona", async () => {
    expect((await runCli(["functions", "deploy"], HOLA, backend(null))).stderr).toBe("Error: Edge Functions are not available on this server.\n");
    expect((await runCli(["functions", "new", "a"], {}, backend(null))).exitCode).toBe(0);
  });
});

describe("withVerifyJwtOff", () => {
  it("añade la sección, cambia el valor o mete la línea, sin tocar lo demás", () => {
    expect(withVerifyJwtOff("", ["a"])).toBe("[functions.a]\nverify_jwt = false\n");
    expect(withVerifyJwtOff('project_id = "x"\n\n[functions.a]\nverify_jwt = true\n', ["a"])).toBe('project_id = "x"\n\n[functions.a]\nverify_jwt = false\n');
    expect(withVerifyJwtOff('[functions.a]\nentrypoint = "./x.ts"\n', ["a"])).toBe('[functions.a]\nverify_jwt = false\nentrypoint = "./x.ts"\n');
  });
});
