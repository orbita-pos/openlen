import { describe, expect, it } from "vitest";
import { findSecret } from "./secrets";

describe("credenciales en la memoria", () => {
  it("las reconoce", () => {
    expect(findSecret("la clave es sk-proj-abcdefghijklmnopqrstuv123")).toBe("API key");
    expect(findSecret("AKIAIOSFODNN7EXAMPLE")).toBe("AWS access key");
    expect(findSecret("ghp_" + "a".repeat(36))).toBe("GitHub token");
    expect(findSecret("-----BEGIN RSA PRIVATE KEY-----")).toBe("private key");
    expect(findSecret("password: hunter2hunter2")).toBe("password");
  });
  it("no confunde texto normal", () => {
    expect(findSecret("Nunca uses amarillo; el tono es formal.")).toBeNull();
    expect(findSecret("El formulario va a /api/f/contacto")).toBeNull();
  });
});
