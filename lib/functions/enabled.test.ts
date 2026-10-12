// @vitest-environment node
import { describe, expect, it } from "vitest";

import { cloudflareConfigFrom, functionsEnabledIn } from "./enabled";

describe("functionsEnabledIn", () => {
  it("motor Y backend de las páginas; sin uno de los dos, o apagadas, no", () => {
    const backend = { PAGES_DATABASE_URL: "postgres://x", PAGES_AUTHENTICATOR_PASSWORD: "y" };
    expect(functionsEnabledIn({ OPENLEN_FUNCTIONS_ENGINE: "local", ...backend })).toBe(true);
    expect(functionsEnabledIn({ OPENLEN_FUNCTIONS_ENGINE: "local" })).toBe(false);
    expect(functionsEnabledIn(backend)).toBe(false);
    expect(functionsEnabledIn({ OPENLEN_FUNCTIONS_ENGINE: "local", OPENLEN_FUNCTIONS: "0", ...backend })).toBe(false);
  });

  it("la configuración de Cloudflare: las cinco variables, recortadas; si falta una, null", () => {
    const CF = { OPENLEN_CF_ACCOUNT_ID: " a ", OPENLEN_CF_API_TOKEN: "t", OPENLEN_CF_NAMESPACE: "n", OPENLEN_CF_DISPATCH_URL: "https://d", OPENLEN_CF_DISPATCH_KEY: "k" };
    expect(cloudflareConfigFrom(CF)).toEqual({ accountId: "a", apiToken: "t", namespace: "n", dispatchUrl: "https://d", dispatchKey: "k" });
    expect(cloudflareConfigFrom({ ...CF, OPENLEN_CF_NAMESPACE: "" })).toBeNull();
    const backend = { PAGES_DATABASE_URL: "postgres://x", PAGES_AUTHENTICATOR_PASSWORD: "y" };
    expect(functionsEnabledIn({ OPENLEN_FUNCTIONS_ENGINE: "cloudflare", ...CF, ...backend })).toBe(true);
  });
});
