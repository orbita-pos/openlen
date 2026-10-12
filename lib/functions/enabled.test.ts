// @vitest-environment node
import { describe, expect, it } from "vitest";

import { functionsEnabledIn } from "./enabled";

describe("functionsEnabledIn", () => {
  it("motor Y backend de las páginas; sin uno de los dos, o apagadas, no", () => {
    const backend = { PAGES_DATABASE_URL: "postgres://x", PAGES_AUTHENTICATOR_PASSWORD: "y" };
    expect(functionsEnabledIn({ OPENLEN_FUNCTIONS_ENGINE: "local", ...backend })).toBe(true);
    expect(functionsEnabledIn({ OPENLEN_FUNCTIONS_ENGINE: "local" })).toBe(false);
    expect(functionsEnabledIn(backend)).toBe(false);
    expect(functionsEnabledIn({ OPENLEN_FUNCTIONS_ENGINE: "local", OPENLEN_FUNCTIONS: "0", ...backend })).toBe(false);
  });
});
