// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), usuarioDeLaLlave: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("./llaves", () => ({ usuarioDeLaLlave: mocks.usuarioDeLaLlave }));

import { usuarioDeLaPeticion } from "./quien";

const LLAVE = "L".repeat(43);
const pide = (h: Record<string, string> = {}) => new Request("http://x/api/y", { headers: h });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "u-web" } });
  mocks.usuarioDeLaLlave.mockResolvedValue("u-tel");
});

describe("quién hace la petición", () => {
  it("sin cabecera, la sesión de la web", async () => {
    expect(await usuarioDeLaPeticion(pide())).toBe("u-web");
    expect(mocks.usuarioDeLaLlave).not.toHaveBeenCalled();
  });

  it("con «Bearer <llave>», el dueño de la llave, sin mirar la cookie", async () => {
    expect(await usuarioDeLaPeticion(pide({ authorization: `Bearer ${LLAVE}` }))).toBe("u-tel");
    expect(mocks.usuarioDeLaLlave).toHaveBeenCalledWith(LLAVE);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("una llave que no vale es nadie: no cae a la cookie", async () => {
    mocks.usuarioDeLaLlave.mockResolvedValue(null);
    expect(await usuarioDeLaPeticion(pide({ authorization: `Bearer ${LLAVE}` }))).toBeNull();
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("una cabecera mal formada es nadie", async () => {
    expect(await usuarioDeLaPeticion(pide({ authorization: "Basic abc" }))).toBeNull();
    expect(mocks.usuarioDeLaLlave).not.toHaveBeenCalled();
  });

  it("sin sesión ni llave, nadie", async () => {
    mocks.auth.mockResolvedValue(null);
    expect(await usuarioDeLaPeticion(pide())).toBeNull();
  });
});
