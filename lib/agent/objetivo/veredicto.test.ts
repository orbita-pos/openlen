// El veredicto del objetivo, y quién lo da por TERMINADO.
//
// 🔴 ESTA REGLA LA NECESITAN DOS SITIOS: la ruta, que borra `settings.objetivo`
// de la base cuando el objetivo acabó, y el cliente, que tiene que quitar la
// ficha del compositor en el mismo momento — si no, la ficha se queda en
// pantalla anunciando un objetivo que el servidor ya borró.
//
// Escribirla dos veces es el patrón que este repo ya ha pagado ocho veces: la
// misma decisión en N sitios y una se queda atrás. Vive una vez, aquí, sin
// importar nada — para que el cliente pueda leerla sin arrastrar el servidor.
import { describe, expect, it } from "vitest";
import { elObjetivoTermino, type VeredictoDeTurno } from "./veredicto";

describe("elObjetivoTermino", () => {
  it("cumplida termina: se logró y el objetivo se borra", () => {
    expect(elObjetivoTermino("cumplida")).toBe(true);
  });

  it("imposible termina: no se puede, y perseguirlo más es quemar créditos", () => {
    expect(elObjetivoTermino("imposible")).toBe(true);
  });

  // 🔴 LOS DOS QUE NO. Y no son lo mismo:
  //   · `no_cumplida` es «todavía»: el turno se quedó sin vueltas y el objetivo
  //     SIGUE siendo del dueño. Borrarlo sería tirárselo por nuestro tope.
  //   · `sin_evaluador` es una avería NUESTRA. Perder el objetivo del dueño
  //     porque nuestro juez falló sería castigarle por nuestro fallo.
  it("no_cumplida NO termina: sigue pendiente y sigue puesto", () => {
    expect(elObjetivoTermino("no_cumplida")).toBe(false);
  });

  it("sin_evaluador NO termina: la avería es nuestra, el objetivo es suyo", () => {
    expect(elObjetivoTermino("sin_evaluador")).toBe(false);
  });

  // Brazo de control: la lista es CERRADA. Si mañana alguien añade un veredicto
  // y no lo clasifica aquí, que caiga del lado de NO borrar — perder el objetivo
  // del dueño es el error caro; dejarlo puesto de más sólo cuesta una lectura.
  it("un veredicto que no conoce NO borra nada", () => {
    expect(elObjetivoTermino("loQueSea" as VeredictoDeTurno)).toBe(false);
  });
});
