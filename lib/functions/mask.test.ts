// @vitest-environment node
import { describe, expect, it } from "vitest";

import { maskSecrets } from "./mask";

describe("maskSecrets", () => {
  it("tapa cada valor con su nombre, el más largo primero, y deja los cortos", () => {
    const s = { SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abcdefghijklmnop", CORTO: "abc", PREFIJO: "sb_secret_abcdefgh" };
    expect(maskSecrets("clave=sb_secret_abcdefghijklmnop y abc", s)).toBe("clave=[SUPABASE_SERVICE_ROLE_KEY] y abc");
    expect(maskSecrets("nada", {})).toBe("nada");
  });
});
