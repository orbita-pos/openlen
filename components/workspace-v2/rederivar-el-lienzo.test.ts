// Lo que protege cada `if`, dicho una vez.
//
// Re-derivar recarga el lienzo, y con él se va todo lo que sólo vive en el DOM
// vivo. Con el «Aplicar» explícito eso incluye los cambios que el usuario ha
// hecho y todavía no ha aplicado — que es trabajo suyo, visible en pantalla, y
// que el documento guardado no tiene.
import { describe, expect, it } from "vitest";

import { motivoParaNoRederivar, type EstadoDelLienzo } from "./rederivar-el-lienzo";

const QUIETO: EstadoDelLienzo = {
  saltarPorInsercion: false,
  pendientes: 0,
  editando: false,
  veniaDeEditar: false,
};

describe("cuándo se vuelve a pintar el lienzo", () => {
  it("en reposo, sí", () => {
    expect(motivoParaNoRederivar(QUIETO)).toBeNull();
  });

  it.each([
    ["saltarPorInsercion", { saltarPorInsercion: true }, "insercion"],
    ["pendientes", { pendientes: 1 }, "pendientes"],
    ["editando", { editando: true }, "editando"],
    ["veniaDeEditar", { veniaDeEditar: true }, "salio-de-editar"],
  ] as const)("con %s, no — y dice por qué", (_n, parche, motivo) => {
    expect(motivoParaNoRederivar({ ...QUIETO, ...parche })).toBe(motivo);
  });
});

describe("el orden, que es donde está el peligro", () => {
  /**
   * LA QUE IMPORTA. Los pendientes SOBREVIVEN a cerrar el modo edición: el
   * usuario puede editar, salir de edición y dejarlos ahí una hora. Si
   * `editando` se comprobara antes, cerrar el modo con cambios sin aplicar
   * devolvería «salio-de-editar», esa bandera se consumiría, y la siguiente
   * pasada re-derivaría — borrando de la pantalla un trabajo que el documento
   * guardado no tiene. Sin un error, sin un aviso.
   */
  it("los pendientes ganan a editar, y a haber dejado de editar", () => {
    expect(
      motivoParaNoRederivar({ ...QUIETO, pendientes: 3, editando: true }),
    ).toBe("pendientes");
    expect(
      motivoParaNoRederivar({ ...QUIETO, pendientes: 3, veniaDeEditar: true }),
    ).toBe("pendientes");
  });

  /**
   * Y la inserción gana a todo, porque es una bandera de un solo uso: quien
   * llama la apaga al consumirla. Si otra razón se colara delante, la bandera
   * seguiría puesta y taparía la SIGUIENTE recarga, que sí hacía falta.
   */
  it("la inserción se consume primero, incluso con pendientes", () => {
    expect(
      motivoParaNoRederivar({
        ...QUIETO,
        saltarPorInsercion: true,
        pendientes: 2,
        editando: true,
      }),
    ).toBe("insercion");
  });

  it("y sin nada pendiente, editar sigue mandando sobre haber editado", () => {
    expect(
      motivoParaNoRederivar({ ...QUIETO, editando: true, veniaDeEditar: true }),
    ).toBe("editando");
  });
});

describe("los pendientes no se cuentan a ojo", () => {
  it("cero es cero — un montón vacío no bloquea nada", () => {
    expect(motivoParaNoRederivar({ ...QUIETO, pendientes: 0 })).toBeNull();
  });

  it("y uno solo ya basta", () => {
    expect(motivoParaNoRederivar({ ...QUIETO, pendientes: 1 })).toBe("pendientes");
  });
});
