import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelarVuelo,
  soltarVuelo,
  tomarVuelo,
  vuelosEnCurso,
  type Vuelo,
} from "./miniatura-en-vuelo";

/**
 * LA CONTABILIDAD DE MINIATURAS EN VUELO.
 *
 * Estas pruebas no levantan Chrome, y ése es el motivo de que el registro viva
 * en su propio módulo: dentro de `thumbnail.ts` todo pasa por Puppeteer, así
 * que comprobar un `Map` costaría un navegador y en la práctica no se
 * comprobaría.
 */

beforeEach(() => {
  // El registro es de módulo. Sin esto una prueba se lleva estado a la
  // siguiente y `vuelosEnCurso` deja de significar nada.
  for (const id of ["a", "b"]) cancelarVuelo(id);
});

describe("tomar y soltar", () => {
  it("un vuelo nuevo nace sin cancelar", () => {
    const v = tomarVuelo("a");
    expect(v.cancelado).toBe(false);
    expect(vuelosEnCurso()).toBe(1);
  });

  it("soltarlo lo saca del registro", () => {
    const v = tomarVuelo("a");
    soltarVuelo("a", v);
    expect(vuelosEnCurso()).toBe(0);
  });

  it("cada proyecto lleva el suyo", () => {
    tomarVuelo("a");
    tomarVuelo("b");
    expect(vuelosEnCurso()).toBe(2);
    // Y cancelar uno no toca al otro: el choque que esto arregla es del MISMO
    // proyecto republicándose, no de dos usuarios a la vez.
    cancelarVuelo("a");
    expect(vuelosEnCurso()).toBe(1);
  });
});

describe("una publicación nueva cancela la anterior", () => {
  it("tomar el vuelo del mismo proyecto cancela el que había", () => {
    const primero = tomarVuelo("a");
    const segundo = tomarVuelo("a");
    expect(primero.cancelado).toBe(true);
    expect(segundo.cancelado).toBe(false);
    // Y no se acumulan: uno por proyecto.
    expect(vuelosEnCurso()).toBe(1);
  });

  it("cancelar CIERRA el navegador del que estaba corriendo", () => {
    const v = tomarVuelo("a");
    const cerrar = vi.fn();
    // Es lo que hace `doRender` en cuanto tiene navegador.
    v.cerrar = cerrar;
    expect(cancelarVuelo("a")).toBe(true);
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it("cancelar sin nada en vuelo no hace nada y lo dice", () => {
    expect(cancelarVuelo("a")).toBe(false);
  });

  // 🔴 LA CARRERA QUE HACE ESTO CORRECTO, y la razón de que `soltarVuelo`
  // compare la identidad del vuelo en vez de borrar por clave.
  //
  // Sin la comprobación: la publicación #1 es cancelada por la #2, la #1
  // termina de rendirse y su `finally` borra la entrada — que ya es la de la
  // #2. A partir de ahí la #2 está en vuelo y NO FIGURA, así que una #3 no
  // podría cancelarla y volveríamos al choque de origen, sólo que más raro.
  it("el rezagado NO borra la entrada del que le sustituyó", () => {
    const primero = tomarVuelo("a");
    const segundo = tomarVuelo("a");
    soltarVuelo("a", primero); // el rezagado se rinde AHORA
    expect(vuelosEnCurso()).toBe(1);
    // y el vigente sigue siendo cancelable, que es lo que se estaba perdiendo
    const cerrar = vi.fn();
    segundo.cerrar = cerrar;
    expect(cancelarVuelo("a")).toBe(true);
    expect(cerrar).toHaveBeenCalledTimes(1);
  });
});

describe("la forma que espera quien lo usa", () => {
  // `doRender` mira `cancelado` en TRES puntos: al salir de la cola, al abrir
  // el navegador y antes de ESCRIBIR EN LA BASE. El tercero es el que protege
  // el dato: un render cancelado que alcanzara a terminar escribiría su
  // miniatura vieja encima de la nueva.
  it("`cancelado` se queda en true — no se rearma solo", () => {
    const v: Vuelo = tomarVuelo("a");
    cancelarVuelo("a");
    expect(v.cancelado).toBe(true);
    // Otra publicación entra y sale; el vuelo viejo sigue cancelado.
    tomarVuelo("a");
    expect(v.cancelado).toBe(true);
  });

  it("`cerrar` es un no-op mientras no haya navegador", () => {
    const v = tomarVuelo("a");
    expect(() => v.cerrar()).not.toThrow();
  });
});
