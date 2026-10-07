// @vitest-environment node
// QUIÉN HIZO EL CAMBIO: lo que marca una ruta llega a quien guarda la
// versión, a través de los `await`, y no se mezcla entre peticiones.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { autorDelCambio, conAutor, conAutorDeLaPeticion } from "./autor-del-cambio";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Una «ruta» envuelta: sabe quién pide (tarda), espera algo y guarda. */
const ruta = conAutorDeLaPeticion(
  async (quien: string, retraso: number) => {
    await esperar(retraso);
    return quien;
  },
  async (_quien: string, retraso: number) => {
    await esperar(retraso);
    return guardar();
  },
);
async function guardar(): Promise<string | null> {
  await esperar(1);
  return autorDelCambio();
}

describe("el autor del cambio", () => {
  it("🔴 lo que marca la ruta llega al que guarda, y dos peticiones a la vez no se mezclan", async () => {
    const [ana, luis, dueno] = await Promise.all([ruta("ana", 5), ruta("luis", 2), ruta("dueno", 8)]);
    expect([ana, luis, dueno]).toEqual(["ana", "luis", "dueno"]);
  });

  it("fuera de una ruta marcada no hay autor; `conAutor` lo pone sólo dentro", async () => {
    expect(autorDelCambio()).toBeNull();
    expect(await conAutor("ana", () => guardar())).toBe("ana");
    expect(await conAutor(null, () => guardar())).toBeNull();
  });
});
