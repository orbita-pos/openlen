import { describe, expect, it } from "vitest";

import { authConfigFor } from "./auth-config-for";
import { storageScopeOf } from "./storage/blob-store";

describe("el backend por entorno", () => {
  it("el borrador confirma solo las cuentas nuevas aunque el dueño lo apagara", () => {
    const c = authConfigFor({ ref: "abcdefghijklmnopqrst", pageSub: "tienda", overrides: { mailerAutoconfirm: false }, environment: "draft" });
    expect(c.mailerAutoconfirm).toBe(true);
  });

  it("producción respeta lo que puso el dueño", () => {
    const c = authConfigFor({ ref: "abcdefghijklmnopqrst", pageSub: "tienda", overrides: { mailerAutoconfirm: false }, environment: "live" });
    expect(c.mailerAutoconfirm).toBe(false);
    expect(c.siteUrl).toMatch(/^https:\/\/tienda\./);
  });

  it("Storage guarda bajo el scope del entorno, y sin scope bajo el ref de siempre", () => {
    expect(storageScopeOf({ ref: "abcdefghijklmnopqrst", scope: "abcdefghijklmnopqrst_d" })).toBe("abcdefghijklmnopqrst_d");
    expect(storageScopeOf({ ref: "abcdefghijklmnopqrst" })).toBe("abcdefghijklmnopqrst");
  });
});
