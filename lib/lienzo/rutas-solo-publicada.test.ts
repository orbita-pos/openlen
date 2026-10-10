import { describe, expect, it } from "vitest";
import { rutaSoloPublicada } from "./rutas-solo-publicada";

const ORIGEN = "http://127.0.0.1:56043";

describe("rutaSoloPublicada", () => {
  it("una ruta de la lista en el origen de la página se apunta", () => {
    expect(rutaSoloPublicada(`${ORIGEN}/rest/v1/productos?select=id`, ORIGEN)).toBe("/rest/v1/productos");
    expect(rutaSoloPublicada(`${ORIGEN}/api/f/mi-negocio`, ORIGEN)).toBe("/api/f/mi-negocio");
  });

  it("🔴 la misma ruta en OTRO host no: es la URL absoluta del proyecto, que sí contesta", () => {
    expect(rutaSoloPublicada("https://cqpxuakaetqckgiwzush.openlen.app/rest/v1/productos", ORIGEN)).toBeNull();
  });

  it("una ruta fuera de la lista, o algo que no es URL, no", () => {
    expect(rutaSoloPublicada(`${ORIGEN}/otra.json`, ORIGEN)).toBeNull();
    expect(rutaSoloPublicada("no es una url", ORIGEN)).toBeNull();
  });
});
