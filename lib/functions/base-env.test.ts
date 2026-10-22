// @vitest-environment node
//
// Las `SUPABASE_*` con las que se miden los 4 KB de los secretos (spec local
// 2026-10-11, Parte 4): un proyecto sin backend no lo gana por guardar uno.
import { describe, expect, it } from "vitest";

import { functionBaseEnv } from "./base-env";

const REAL = { url: "https://abcdefghijklmnopqrst.openlen.app", publishableKey: "sb_publishable_real", secretKey: "sb_secret_real" };

describe("functionBaseEnv", () => {
  it("🔴 sin backend no lo crea: mide con unas de la misma forma (los mismos largos)", async () => {
    let pedido = false;
    const env = await functionBaseEnv("p1", "draft", { hasBackend: async () => false, target: async () => ((pedido = true), REAL) });
    expect(pedido).toBe(false);
    expect(env.SUPABASE_URL).toMatch(/^https:\/\/[a-z]{20}\.[^/]+$/);
    expect(env.SUPABASE_ANON_KEY).toMatch(/^sb_publishable_[A-Za-z0-9]{32}$/);
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toMatch(/^sb_secret_[A-Za-z0-9]{32}$/);
    expect(Object.keys(env).sort()).toEqual(["SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"]);
  });

  it("with project email on, its three variables count too (spec local 2026-10-22-email-integration, 5)", async () => {
    const env = await functionBaseEnv("p1", "draft", { hasBackend: async () => true, target: async () => REAL, email: true });
    expect(env).toMatchObject({ RESEND_API_KEY: "sb_secret_real", RESEND_BASE_URL: `${REAL.url}/email/v1` });
    expect(env.OPENLEN_EMAIL_FROM).toMatch(/^noreply@/);
  });

  it("con backend, las de verdad de ese entorno", async () => {
    const env = await functionBaseEnv("p1", "live", { hasBackend: async () => true, target: async () => REAL });
    expect(env.SUPABASE_URL).toBe(REAL.url);
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("sb_secret_real");
  });
});
