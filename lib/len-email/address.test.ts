// @vitest-environment node
import { describe, expect, it } from "vitest";

import { lenEmailAddress, projectIdFromAddress } from "./address";

const env = { LEN_EMAIL_DOMAIN: "reply.openlen.com", NEXTAUTH_SECRET: "s3cr3t" };
const id = "0b6f4c1e-2a3d-4e5f-8a9b-1c2d3e4f5a6b";

describe("la dirección de Len en un proyecto", () => {
  it("🔴 ida y vuelta: la dirección lleva al proyecto, y cabe en la parte local de un correo (≤ 64)", () => {
    const addr = lenEmailAddress(id, env)!;
    expect(addr).toMatch(/^len-[0-9a-f]{32}-[0-9a-f]{12}@reply\.openlen\.com$/);
    expect(addr.split("@")[0]!.length).toBeLessThanOrEqual(64);
    expect(projectIdFromAddress(addr, env)).toBe(id);
    // Los clientes de correo cambian mayúsculas: da igual.
    expect(projectIdFromAddress(addr.toUpperCase(), env)).toBe(id);
  });

  it("🔴 sin la firma no se entra: el id solo (que enseña la analítica) no basta", () => {
    const addr = lenEmailAddress(id, env)!;
    const forjada = addr.replace(/-[0-9a-f]{12}@/, "-000000000000@");
    expect(projectIdFromAddress(forjada, env)).toBeNull();
    expect(projectIdFromAddress(addr, { ...env, NEXTAUTH_SECRET: "otro" })).toBeNull();
  });

  it("otro dominio, o la función apagada, no es nuestra", () => {
    const addr = lenEmailAddress(id, env)!;
    expect(projectIdFromAddress(addr.replace("reply.openlen.com", "evil.com"), env)).toBeNull();
    expect(lenEmailAddress(id, { NEXTAUTH_SECRET: "s3cr3t" })).toBeNull();
    expect(projectIdFromAddress(addr, { NEXTAUTH_SECRET: "s3cr3t" })).toBeNull();
    expect(lenEmailAddress("no-es-un-uuid", env)).toBeNull();
  });
});
