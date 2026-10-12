// @vitest-environment node
//
// request_secrets (spec local 2026-10-11, Parte 4): lo que Len manda, la
// pregunta que pinta la tarjeta y lo que vuelve al turno (sólo nombres).
import { describe, expect, it } from "vitest";

import { secretsQuestion, secretsResult, validateSecretRequests } from "./request-secrets";

describe("validateSecretRequests", () => {
  it("lo bien formado pasa, sin campos de más", () => {
    expect(validateSecretRequests([{ name: "STRIPE_SECRET_KEY", description: " Para cobrar ", url: "https://dashboard.stripe.com/test/apikeys", value: "sk_test_NO" }])).toEqual({
      ok: true,
      secrets: [{ name: "STRIPE_SECRET_KEY", description: "Para cobrar", url: "https://dashboard.stripe.com/test/apikeys" }],
    });
  });

  it("lo mal formado le dice al modelo qué cambiar", () => {
    expect(validateSecretRequests([])).toEqual({ ok: false, error: '"secrets" must be a non-empty array of { name, description, url? }.' });
    expect(validateSecretRequests(Array.from({ length: 6 }, (_, i) => ({ name: `K${i}X`, description: "d" })))).toEqual({ ok: false, error: "Ask for at most 5 secrets at a time; ask for the rest after these." });
    expect(validateSecretRequests([{ name: "SUPABASE_KEY", description: "d" }])).toEqual({ ok: false, error: "secrets[0].name: Env name cannot start with SUPABASE_: SUPABASE_KEY" });
    expect(validateSecretRequests([{ name: "A_KEY", description: "d" }, { name: "A_KEY", description: "d" }])).toEqual({ ok: false, error: 'secrets[1].name "A_KEY" is repeated.' });
    expect(validateSecretRequests([{ name: "A_KEY" }])).toEqual({ ok: false, error: 'secrets[0] ("A_KEY") needs a "description": what it is for, as the user will read it.' });
    expect(validateSecretRequests([{ name: "A_KEY", description: "d", url: "http://x.com" }])).toEqual({ ok: false, error: "secrets[0].url must be an https:// URL." });
  });
});

describe("secretsQuestion y secretsResult", () => {
  it("la pregunta lleva la intención (su texto es nuestro: el chat pinta la tarjeta)", () => {
    const s = [{ name: "STRIPE_SECRET_KEY", description: "Para cobrar" }];
    expect(secretsQuestion(s)).toEqual({ id: "secrets", question: "Enter the secret values for: STRIPE_SECRET_KEY.", intent: { kind: "secrets", secrets: s } });
  });

  it("🔴 lo que vuelve al turno: dónde quedó CADA nombre (de lo guardado de verdad), y que producción es del usuario", () => {
    expect(secretsResult(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], { draft: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], live: ["STRIPE_SECRET_KEY"] })).toBe(
      "STRIPE_SECRET_KEY saved in: draft, production\nSTRIPE_WEBHOOK_SECRET saved in: draft\nProduction values are set by the user (you can't): the publish card asks for any that are missing.",
    );
    expect(secretsResult(["A_KEY"], { draft: [], live: [] })).toBe("A_KEY skipped");
    expect(secretsResult(["A_KEY"], { draft: ["A_KEY"], live: ["A_KEY"] })).toBe("A_KEY saved in: draft, production");
  });
});
