import { describe, expect, it } from "vitest";
import { actorFromSession, rowOwnerKey } from "./actor";

const cuentas = { registro: "cerrado" as const, papeles: ["cajero"] };
const marta = { id: "m1", role: "cajero" };

describe("actorFromSession", () => {
  it("una sesión de miembro es una cuenta con su papel", () => {
    expect(
      actorFromSession({ accounts: cuentas, session: { memberId: "m1", ownerUserId: null }, projectOwnerId: "u1", account: marta }),
    ).toEqual({ tipo: "cuenta", id: "m1", papel: "cajero" });
  });

  it("la sesión del dueño es el dueño", () => {
    expect(
      actorFromSession({ accounts: cuentas, session: { memberId: null, ownerUserId: "u1" }, projectOwnerId: "u1", account: null }),
    ).toEqual({ tipo: "dueño" });
  });

  // 🔴 Quitar el bloque de la página cierra la puerta, aunque la cookie siga.
  it("sin data-ol-accounts publicado, ninguna sesión vale", () => {
    expect(
      actorFromSession({ accounts: null, session: { memberId: "m1", ownerUserId: null }, projectOwnerId: "u1", account: marta }),
    ).toBeNull();
    expect(
      actorFromSession({ accounts: null, session: { memberId: null, ownerUserId: "u1" }, projectOwnerId: "u1", account: null }),
    ).toBeNull();
  });

  // 🔴 El proyecto cambió de manos: la sesión del dueño anterior no abre nada.
  it("la sesión de dueño de quien ya no es el dueño no vale", () => {
    expect(
      actorFromSession({ accounts: cuentas, session: { memberId: null, ownerUserId: "u-viejo" }, projectOwnerId: "u1", account: null }),
    ).toBeNull();
  });

  it("una cuenta borrada, o que no es la de la sesión, no vale", () => {
    expect(
      actorFromSession({ accounts: cuentas, session: { memberId: "m1", ownerUserId: null }, projectOwnerId: "u1", account: null }),
    ).toBeNull();
    expect(
      actorFromSession({ accounts: cuentas, session: { memberId: "m1", ownerUserId: null }, projectOwnerId: "u1", account: { id: "m2", role: "cajero" } }),
    ).toBeNull();
  });

  it("un papel que la página ya no declara se queda en nada", () => {
    expect(
      actorFromSession({ accounts: { registro: "cerrado", papeles: ["gerente"] }, session: { memberId: "m1", ownerUserId: null }, projectOwnerId: "u1", account: marta }),
    ).toEqual({ tipo: "cuenta", id: "m1", papel: null });
  });
});

describe("rowOwnerKey", () => {
  it("el dueño escribe documentos del dueño; la cuenta, los suyos; el visitante, los de su cookie", () => {
    expect(rowOwnerKey({ tipo: "dueño" })).toBeNull();
    expect(rowOwnerKey({ tipo: "cuenta", id: "m1", papel: null })).toBe("cuenta:m1");
    expect(rowOwnerKey({ tipo: "visitante", id: "v1" })).toBe("v1");
  });
});
