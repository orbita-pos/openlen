import { describe, expect, it, vi } from "vitest";

import { refreshTokenIdentity } from "./session";

const token = { sub: "u-ana", name: "Ana vieja", picture: "https://g/vieja.jpg", email: "ana@x" };

describe("el nombre y la foto del token", () => {
  it("🔴 al entrar salen de la base (la foto subida gana a la de Google)", async () => {
    const read = vi.fn(async () => ({ name: "Ana", picture: "https://u/avatars/u-ana-0123456789abcdef.webp" }));
    const t = await refreshTokenIdentity(token, { signingIn: true, read });
    expect(read).toHaveBeenCalledWith("u-ana");
    expect(t).toEqual({ ...token, name: "Ana", picture: "https://u/avatars/u-ana-0123456789abcdef.webp" });
  });

  it("en una petición normal no se toca la base", async () => {
    const read = vi.fn();
    expect(await refreshTokenIdentity(token, { signingIn: false, read })).toBe(token);
    expect(read).not.toHaveBeenCalled();
  });

  it("🔴 con update() (el perfil al guardar) se vuelve a leer", async () => {
    const read = vi.fn(async () => ({ name: "Ana", picture: null }));
    expect(await refreshTokenIdentity(token, { signingIn: false, trigger: "update", read })).toMatchObject({ picture: null });
  });

  it("🔴 si la base falla, el login sigue con el token de antes", async () => {
    const warn = vi.fn();
    const t = await refreshTokenIdentity(token, {
      signingIn: true,
      read: async () => {
        throw new Error("db caída");
      },
      warn,
    });
    expect(t).toBe(token);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("sin usuario, nada", async () => {
    const read = vi.fn();
    const sinSub = { name: "x" };
    expect(await refreshTokenIdentity(sinSub, { signingIn: true, read })).toBe(sinSub);
    expect(read).not.toHaveBeenCalled();
  });
});
