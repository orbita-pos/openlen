// @vitest-environment node
//
// Las reglas de los secretos de las funciones (spec local 2026-10-11, Parte 4).
import { describe, expect, it } from "vitest";

import { secretNameMessage, secretNameProblem } from "./secret-names";
import { ENV_VARS_MAX, envTooLargeMessage, fitEnv, literalEnvNames, MAX_SECRET_VALUE_BYTES, missingSecrets, secretDigest } from "./secrets";

describe("secretNameProblem", () => {
  it("los nombres de siempre valen, también los de una letra y los AWS_/LAMBDA_ (eran reglas de Lambda)", () => {
    for (const n of ["STRIPE_SECRET_KEY", "Resend_Key", "OPENAI_API_KEY2", "MP", "X", "AWS_ACCESS_KEY_ID", "LAMBDA_X"]) expect(secretNameProblem(n), n).toBeNull();
  });

  it("🔴 SUPABASE_ es del sistema", () => {
    expect(secretNameProblem("SUPABASE_URL")).toEqual({ kind: "reserved", prefix: "SUPABASE_" });
  });

  it("lo que no es un nombre de variable", () => {
    for (const n of ["9KEY", "_X", "my-key", "MI CLAVE", "Ñ_KEY", "A".repeat(257)]) expect(secretNameProblem(n), n).toEqual({ kind: "invalid" });
  });

  it("lo que lee Len, al estilo de la CLI de Supabase", () => {
    expect(secretNameMessage("SUPABASE_X", { kind: "reserved", prefix: "SUPABASE_" })).toBe("Env name cannot start with SUPABASE_: SUPABASE_X");
    expect(secretNameMessage("my-key", { kind: "invalid" })).toBe(
      "Invalid secret name: my-key. Must start with a letter, and only include letters, digits and underscores. (^[A-Za-z][A-Za-z0-9_]*$)",
    );
  });
});

describe("secretDigest", () => {
  it("sha256 en hex, como la columna DIGEST de `supabase secrets list`", () => {
    expect(secretDigest("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("las 128 variables de Cloudflare", () => {
  it("🔴 cuentan las variables, con las SUPABASE_* de la base, y dicen cuántas quedan", () => {
    const base = { SUPABASE_URL: "u", SUPABASE_ANON_KEY: "a" };
    const muchas = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`K${i}`, "v"]));
    expect(fitEnv(base, muchas(126))).toEqual({ ok: true, used: 128 });
    const f = fitEnv(base, muchas(127));
    expect(f).toEqual({ ok: false, used: 129, base: 2, available: 126 });
    if (f.ok) return;
    expect(envTooLargeMessage(f)).toBe(
      "Edge Function secrets don't fit: a function gets 128 environment variables and these would be 129 (the project's own SUPABASE_* variables are 2). 126 are left for secrets: remove some.",
    );
  });

  it("los topes, los de Cloudflare", () => {
    expect(ENV_VARS_MAX).toBe(128);
    expect(MAX_SECRET_VALUE_BYTES).toBe(5120);
  });
});

describe("literalEnvNames y missingSecrets", () => {
  it("🔴 los Deno.env.get con nombre LITERAL de las funciones (también _shared); ni SUPABASE_*, ni nombres calculados, ni fuera de supabase/functions", () => {
    const files = {
      "/supabase/functions/checkout/index.ts":
        'const k = Deno.env.get("STRIPE_SECRET_KEY")!;\nconst u = Deno.env.get(\'SUPABASE_URL\');\nconst w = Deno.env.get(`STRIPE_WEBHOOK_SECRET`);\nconst d = Deno.env.get(`X_${n}`);\nconst v = Deno.env.get(nombre);\n',
      "/supabase/functions/_shared/ia.ts": 'export const key = Deno.env.get( "OPENAI_API_KEY" );\n',
      "/supabase/config.toml": 'x = "Deno.env.get(\\"NO\\")"\n',
      "/src/App.tsx": 'Deno.env.get("TAMPOCO")\n',
    };
    expect(literalEnvNames(files)).toEqual(["OPENAI_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
    expect(missingSecrets(["OPENAI_API_KEY", "STRIPE_SECRET_KEY"], ["STRIPE_SECRET_KEY"])).toEqual(["OPENAI_API_KEY"]);
  });
});
