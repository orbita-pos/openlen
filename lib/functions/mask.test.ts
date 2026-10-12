// @vitest-environment node
import { describe, expect, it } from "vitest";

import { maskBody, maskSecrets } from "./mask";

describe("maskSecrets", () => {
  it("tapa cada valor con su nombre, el más largo primero, y deja los cortos", () => {
    const s = { SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abcdefghijklmnop", CORTO: "abc", PREFIJO: "sb_secret_abcdefgh" };
    expect(maskSecrets("clave=sb_secret_abcdefghijklmnop y abc", s)).toBe("clave=[SUPABASE_SERVICE_ROLE_KEY] y abc");
    expect(maskSecrets("nada", {})).toBe("nada");
  });
});

describe("maskBody", () => {
  it("un cuerpo de texto sale tapado; uno binario, tal cual (tapar bytes lo rompería)", () => {
    const s = { STRIPE_SECRET_KEY: "sk_test_abcdefgh123" };
    expect(maskBody(Buffer.from('{"k":"sk_test_abcdefgh123"}'), s).toString()).toBe('{"k":"[STRIPE_SECRET_KEY]"}');
    const binario = Buffer.from([0xff, 0xfe, 0x00, 0x41]);
    expect(maskBody(binario, s).equals(binario)).toBe(true);
  });
});
