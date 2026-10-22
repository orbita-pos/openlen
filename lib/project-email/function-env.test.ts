import { describe, expect, it } from "vitest";

import { emailFunctionEnv } from "./function-env";

const base = { enabled: true, envUrl: "https://iolmg.openlen.app", secretKey: "sb_secret_x", userSecrets: {} };

describe("emailFunctionEnv (spec 5)", () => {
  it("off, nothing", () => {
    expect(emailFunctionEnv({ ...base, enabled: false, domain: null })).toEqual({});
  });

  it("on: the SDK's key and base URL point at the gateway; the from only with a ready domain", () => {
    expect(emailFunctionEnv({ ...base, domain: null })).toEqual({ RESEND_API_KEY: "sb_secret_x", RESEND_BASE_URL: "https://iolmg.openlen.app/email/v1" });
    expect(emailFunctionEnv({ ...base, domain: { status: "verifying", sendingHost: "notify.taller.mx" } })).not.toHaveProperty("OPENLEN_EMAIL_FROM");
    expect(emailFunctionEnv({ ...base, domain: { status: "ready", sendingHost: "notify.taller.mx" } })).toEqual({
      RESEND_API_KEY: "sb_secret_x",
      RESEND_BASE_URL: "https://iolmg.openlen.app/email/v1",
      OPENLEN_EMAIL_FROM: "noreply@notify.taller.mx",
    });
  });

  it("🔴 a user's own RESEND_API_KEY wins: no key nor base URL from OpenLen", () => {
    expect(emailFunctionEnv({ ...base, userSecrets: { RESEND_API_KEY: "re_suya" }, domain: { status: "ready", sendingHost: "notify.taller.mx" } })).toEqual({});
  });
});
