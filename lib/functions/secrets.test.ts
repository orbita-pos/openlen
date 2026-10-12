// @vitest-environment node
//
// Las reglas de los secretos de las funciones (spec local 2026-10-11, Parte 4).
import { describe, expect, it } from "vitest";

import { secretNameMessage, secretNameProblem } from "./secret-names";
import { ENV_LIMIT_BYTES, envSizeBytes, envTooLargeMessage, fitEnv, literalEnvNames, missingSecrets, secretDigest } from "./secrets";

describe("secretNameProblem", () => {
  it("los nombres de siempre valen", () => {
    for (const n of ["STRIPE_SECRET_KEY", "Resend_Key", "OPENAI_API_KEY2", "MP"]) expect(secretNameProblem(n), n).toBeNull();
  });

  it("🔴 SUPABASE_, AWS_ y LAMBDA_ son del sistema", () => {
    expect(secretNameProblem("SUPABASE_URL")).toEqual({ kind: "reserved", prefix: "SUPABASE_" });
    expect(secretNameProblem("AWS_REGION")).toEqual({ kind: "reserved", prefix: "AWS_" });
    expect(secretNameProblem("LAMBDA_TASK_ROOT")).toEqual({ kind: "reserved", prefix: "LAMBDA_" });
  });

  it("lo que Lambda no aceptaría como variable", () => {
    for (const n of ["9KEY", "_X", "X", "my-key", "MI CLAVE", "Ñ_KEY", "A".repeat(257)]) expect(secretNameProblem(n), n).toEqual({ kind: "invalid" });
  });

  it("lo que lee Len, al estilo de la CLI de Supabase", () => {
    expect(secretNameMessage("SUPABASE_X", { kind: "reserved", prefix: "SUPABASE_" })).toBe("Env name cannot start with SUPABASE_: SUPABASE_X");
    expect(secretNameMessage("my-key", { kind: "invalid" })).toBe(
      "Invalid secret name: my-key. Must start with a letter, and only include letters, digits and underscores. (^[A-Za-z][A-Za-z0-9_]+$)",
    );
  });
});

describe("secretDigest", () => {
  it("sha256 en hex, como la columna DIGEST de `supabase secrets list`", () => {
    expect(secretDigest("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("los 4 KB de Lambda", () => {
  it("se mide el JSON entero, en bytes (lo que cita el error de AWS)", () => {
    expect(envSizeBytes({ A: "1" })).toBe(9);
    expect(envSizeBytes({ A: "ñ" })).toBe(10);
  });

  it("cabe o no CON lo que ya hay, y dice lo que queda", () => {
    const base = { SUPABASE_URL: "https://abcdefghijklmnopqrst.openlen.app" };
    expect(fitEnv(base, { K: "x" })).toEqual({ ok: true, usedBytes: envSizeBytes({ ...base, K: "x" }) });
    const f = fitEnv(base, { K: "x".repeat(ENV_LIMIT_BYTES) });
    expect(f.ok).toBe(false);
    if (f.ok) return;
    expect(f.baseBytes).toBe(envSizeBytes(base));
    expect(f.availableBytes).toBe(ENV_LIMIT_BYTES - envSizeBytes(base));
    expect(envTooLargeMessage(f)).toBe(
      `Edge Function secrets don't fit: a function gets 4096 bytes of environment variables and these would take ${f.usedBytes} (the project's own SUPABASE_* variables take ${f.baseBytes}). ${f.availableBytes} bytes are left for secrets: remove or shorten some.`,
    );
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
