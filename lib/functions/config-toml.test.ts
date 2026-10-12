// @vitest-environment node
import { describe, expect, it } from "vitest";

import { readFunctionsToml } from "./config-toml";

describe("readFunctionsToml", () => {
  it("lee [functions.<nombre>] e ignora el resto del config.toml de Supabase", () => {
    const r = readFunctionsToml(`project_id = "tienda"

[api]
port = 54321
schemas = ["public",
  "graphql_public"]

[functions.stripe-webhook]
verify_jwt = false # Stripe no manda JWT

[functions."checkout"]
entrypoint = './functions/checkout/main.ts'
import_map = "./functions/checkout/import_map.json"
other = [1, 2]
`);
    expect(r).toEqual({
      ok: true,
      functions: {
        "stripe-webhook": { verify_jwt: false },
        checkout: { entrypoint: "./functions/checkout/main.ts", import_map: "./functions/checkout/import_map.json" },
      },
    });
  });

  it("un valor que no es del tipo dice la línea", () => {
    expect(readFunctionsToml(`[functions.a]\nverify_jwt = "no"\n`)).toEqual({
      ok: false,
      line: 2,
      message: "supabase/config.toml line 2: verify_jwt must be true or false.",
    });
    expect(readFunctionsToml(`[functions.a]\nentrypoint = 3\n`)).toMatchObject({ ok: false, line: 2 });
  });

  it("vacío o sin funciones", () => {
    expect(readFunctionsToml("")).toEqual({ ok: true, functions: {} });
  });
});
