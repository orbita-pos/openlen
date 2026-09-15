import { beforeEach, describe, expect, it } from "vitest";
import {
  CADUCIDAD_MS,
  TOPE_POR_USUARIO,
  guardarDocumento,
  leerDocumento,
  vaciarAlmacenParaPruebas,
} from "./almacen";

const base = { html: "<p>hola</p>", projectId: "p1", userId: "u1", pagina: null };

beforeEach(() => vaciarAlmacenParaPruebas());

describe("el almacén del lienzo", () => {
  it("devuelve lo guardado por su id, y el id no se adivina", () => {
    const id = guardarDocumento(base, 1_000);
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(leerDocumento(id, 1_000)?.html).toBe("<p>hola</p>");
    expect(leerDocumento("otro", 1_000)).toBeNull();
  });

  it("caduca a los 30 min SIN USO, y leer renueva", () => {
    const id = guardarDocumento(base, 0);
    expect(leerDocumento(id, CADUCIDAD_MS - 1)).not.toBeNull();
    expect(leerDocumento(id, 2 * CADUCIDAD_MS - 2)).not.toBeNull();
    expect(leerDocumento(id, 3 * CADUCIDAD_MS)).toBeNull();
  });

  it("al pasar el tope tira el menos usado DEL MISMO usuario", () => {
    const primero = guardarDocumento(base, 0);
    const ajeno = guardarDocumento({ ...base, userId: "u2" }, 0);
    const segundo = guardarDocumento(base, 1);
    for (let i = 2; i < TOPE_POR_USUARIO; i++) guardarDocumento(base, i);
    // LEER RENUEVA, y por eso este caso se escribe así: al tocar `primero`
    // pasa a ser el más RECIENTE, y el menos usado pasa a ser `segundo`. La
    // primera versión de esta prueba leía `primero` y luego esperaba que fuera
    // él quien se cayera, que es justo lo contrario de lo que significa
    // «menos usado».
    expect(leerDocumento(primero, TOPE_POR_USUARIO)).not.toBeNull();
    guardarDocumento(base, TOPE_POR_USUARIO + 1);
    expect(leerDocumento(segundo, TOPE_POR_USUARIO + 2)).toBeNull();
    expect(leerDocumento(primero, TOPE_POR_USUARIO + 2)).not.toBeNull();
    expect(leerDocumento(ajeno, TOPE_POR_USUARIO + 2)).not.toBeNull();
  });
});
