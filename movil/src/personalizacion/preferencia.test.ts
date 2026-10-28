import { afterEach, describe, expect, it, vi } from "vitest";
import { aplicarLook, leerLook, sanearLook } from "./preferencia";

const catalogo = { HEAD: { chef: "Chef", michi: "Gato" }, FACE: { lentes: "Lentes", gato: "Bigotes" } };
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("preferencia de Tu Len", () => {
  it("conserva sólo accesorios existentes en su ranura", () => {
    expect(sanearLook({ cabeza: "chef", cara: "lentes", extra: true }, catalogo)).toEqual({ cabeza: "chef", cara: "lentes" });
    expect(sanearLook({ cabeza: "lentes", cara: "chef" }, catalogo)).toEqual({ cabeza: "", cara: "" });
    expect(sanearLook({ cabeza: "__proto__", cara: "constructor" }, catalogo)).toEqual({ cabeza: "", cara: "" });
    expect(sanearLook(null, catalogo)).toEqual({ cabeza: "", cara: "" });
  });
  it("guarda la elección aplicada para una nueva lectura", () => {
    aplicarLook({ cabeza: "michi", cara: "gato" }, catalogo);
    expect(leerLook(catalogo)).toEqual({ cabeza: "michi", cara: "gato" });
  });
  it("recupera el aspecto clásico de un JSON corrupto", () => {
    localStorage.setItem("len-movil-look", "{mal");
    expect(leerLook(catalogo)).toEqual({ cabeza: "", cara: "" });
  });
  it("no anuncia cambios cuando el almacenamiento falla", () => {
    const aviso = vi.fn(); window.addEventListener("len-look", aviso);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("sin espacio"); });
    expect(() => aplicarLook({ cabeza: "chef", cara: "" }, catalogo)).toThrow();
    expect(aviso).not.toHaveBeenCalled();
    window.removeEventListener("len-look", aviso);
  });
});
