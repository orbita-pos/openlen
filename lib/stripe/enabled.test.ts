import { describe, expect, it } from "vitest";

import { stripeEnabledIn } from "./enabled";

const WITH_FUNCTIONS = { OPENLEN_FUNCTIONS_ENGINE: "local", PAGES_DATABASE_URL: "postgres://x", PAGES_AUTHENTICATOR_PASSWORD: "p" };

describe("stripeEnabledIn", () => {
  it("is on when the functions engine is on", () => {
    expect(stripeEnabledIn(WITH_FUNCTIONS)).toBe(true);
  });

  it("needs the functions engine", () => {
    expect(stripeEnabledIn({})).toBe(false);
    expect(stripeEnabledIn({ ...WITH_FUNCTIONS, OPENLEN_FUNCTIONS: "0" })).toBe(false);
  });

  it("OPENLEN_STRIPE=0 turns it off", () => {
    expect(stripeEnabledIn({ ...WITH_FUNCTIONS, OPENLEN_STRIPE: "0" })).toBe(false);
    expect(stripeEnabledIn({ ...WITH_FUNCTIONS, OPENLEN_STRIPE: "1" })).toBe(true);
  });
});
