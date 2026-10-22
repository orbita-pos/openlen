import { describe, expect, it } from "vitest";

import { emailEnabledIn } from "./enabled";

describe("emailEnabledIn", () => {
  it("needs the customers' Resend key, and OPENLEN_EMAIL=0 turns it off", () => {
    expect(emailEnabledIn({})).toBe(false);
    expect(emailEnabledIn({ RESEND_CLIENTS_API_KEY: "re_x" })).toBe(true);
    expect(emailEnabledIn({ RESEND_CLIENTS_API_KEY: "re_x", OPENLEN_EMAIL: "0" })).toBe(false);
    expect(emailEnabledIn({ RESEND_CLIENTS_API_KEY: "  " })).toBe(false);
  });

  it("OpenLen's own Resend key is not the customers' account", () => {
    expect(emailEnabledIn({ RESEND_API_KEY: "re_openlen" })).toBe(false);
  });
});
