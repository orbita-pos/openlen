import { describe, expect, it } from "vitest";
import {
  ESFUERZOS,
  NIVELES,
  NIVEL_POR_DEFECTO,
  capacidadDeEsfuerzo,
  caparEsfuerzo,
  presupuestoDeEsfuerzo,
  resolverEsfuerzo,
  type EsfuerzoAgente,
} from "./esfuerzo";

describe("la postura se traduce a un número, y `auto` resuelve a un nivel", () => {
  // 🔴 ESTA REGLA SE INVIRTIÓ el 2026-09-11, y la prueba anterior afirmaba lo
  // contrario («`auto` NO produce número — el campo no se manda»). Aquella era
  // fiel a una lectura EQUIVOCADA de Claude Code: se tomó el `{type:"adaptive"}`
  // del eje de PRESUPUESTO por el `auto` del eje de NIVEL. Aquél lo decide el
  // modelo, no la elección de la persona. En el eje del nivel Claude Code
  // resuelve (al defecto del modelo, o `high` si no lo tiene) y manda.
  it("`auto` SÍ produce número: el del nivel al que resuelve", () => {
    expect(presupuestoDeEsfuerzo("auto", 32_768)).toBe(
      presupuestoDeEsfuerzo(NIVEL_POR_DEFECTO, 32_768),
    );
  });

  it("resolver: `auto` da el defecto, y un nivel se da a sí mismo", () => {
    expect(resolverEsfuerzo("auto")).toBe(NIVEL_POR_DEFECTO);
    for (const n of NIVELES) expect(resolverEsfuerzo(n)).toBe(n);
  });

  it("los cinco niveles suben en orden", () => {
    const n = (e: EsfuerzoAgente) => presupuestoDeEsfuerzo(e, 32_768);
    expect(n("low")).toBeLessThan(n("medium"));
    expect(n("medium")).toBeLessThan(n("high"));
    expect(n("high")).toBeLessThan(n("xhigh"));
    expect(n("xhigh")).toBeLessThan(n("max"));
  });

  // El tope de la escalera es el tope MEDIDO del dial. Por encima de 225 el
  // proveedor deja de devolver lo que se le pide (desvío −31 y rango 142 en
  // 300), así que un número mayor no compraría pensamiento sino varianza.
  it("ningún nivel se sale de la banda medida como fiable (1..225)", () => {
    for (const n of NIVELES) {
      const v = presupuestoDeEsfuerzo(n, 32_768);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(225);
    }
  });

  it("el número se recorta contra el techo de salida (regla de Claude Code)", () => {
    expect(presupuestoDeEsfuerzo("max", 50)).toBe(49);
  });

  it("BRAZO DE CONTROL: con techo amplio NO se recorta", () => {
    expect(presupuestoDeEsfuerzo("max", 32_768)).toBe(225);
  });

  it("el suelo es 1 aunque el techo de salida sea absurdo", () => {
    expect(presupuestoDeEsfuerzo("low", 1)).toBe(1);
  });

  it("el vocabulario lleva `auto` delante y no incluye `none`", () => {
    expect(ESFUERZOS[0]).toBe("auto");
    expect(ESFUERZOS).not.toContain("none");
  });

  // `NIVELES` es la escalera de Claude Code y `auto` se añade aparte, no es un peldaño.
  it("BRAZO DE CONTROL: `auto` NO está entre los niveles", () => {
    expect(NIVELES).not.toContain("auto");
    expect(ESFUERZOS).toHaveLength(NIVELES.length + 1);
  });

  // El defecto tiene que tener niveles POR ENCIMA: si `auto` resolviera al tope,
  // subir de nivel no significaría nada y volveríamos a la etiqueta falsa.
  it("el defecto deja niveles por encima (3 de 5, como Claude Code)", () => {
    const i = NIVELES.indexOf(NIVEL_POR_DEFECTO);
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(NIVELES.length - 1);
  });
});

// ─── LA ESCALERA POR MODELO ─────────────────────────────────────────────────
//
// De Claude Code se copia DÓNDE VIVE LA DECISIÓN: la escalera sale de la
// entrada de catálogo de ESE modelo, no de una constante.
//
// ⚰️ Aquí decía que su reserva para un modelo desconocido es
// `["low","medium","high"]`. Es falso (comprobado el 2026-09-13): la suya es
// permisiva. La de abajo es NUESTRA y es más estricta a propósito — el porqué
// entero está en el bloque de `NIVELES_SIN_MEDIR` en `esfuerzo.ts`.
describe("la capacidad de esfuerzo la dice el modelo", () => {
  const MEDIDO = "accounts/fireworks/models/deepseek-v4p1-flash";

  it("un modelo MEDIDO ofrece hasta su tope comprobado", () => {
    const c = capacidadDeEsfuerzo(MEDIDO);
    expect(c.medido).toBe(true);
    expect(c.niveles).toEqual(NIVELES);
    expect(c.defecto).toBe("high");
  });

  // 🔴 NUESTRA RESERVA. Es la mitad que importa: sin ella un modelo nuevo
  // heredaria un dial de 225 que nadie ha comprobado que exista.
  it("un modelo SIN medir cae a `low, medium, high` — xhigh y max se ganan", () => {
    const c = capacidadDeEsfuerzo("accounts/fireworks/models/lo-que-sea-nuevo");
    expect(c.medido).toBe(false);
    expect(c.niveles).toEqual(["low", "medium", "high"]);
    expect(c.niveles).not.toContain("xhigh");
    expect(c.niveles).not.toContain("max");
    // El defecto sigue siendo alcanzable: `auto` no puede resolver a un peldaño
    // que este modelo no ofrece.
    expect(c.niveles).toContain(c.defecto);
  });

  // BRAZO DE CONTROL de las dos de arriba: si la tabla se vaciara, la primera
  // pasaria a dar la reserva y su assert de NIVELES fallaria — pero si alguien
  // "arreglara" eso devolviendo siempre los cinco, la segunda es la que cae.
  it("las dos ramas dan LISTAS DISTINTAS — si no, la tabla no hace nada", () => {
    expect(capacidadDeEsfuerzo(MEDIDO).niveles.length).toBeGreaterThan(
      capacidadDeEsfuerzo("modelo-inventado").niveles.length,
    );
  });
});

describe("el recorte al techo del modelo", () => {
  const SIN_MEDIR = capacidadDeEsfuerzo("modelo-inventado");
  const MEDIDO = capacidadDeEsfuerzo("accounts/fireworks/models/deepseek-v4p1-flash");

  // Sin esto la tabla seria decorativa: la postura se GUARDA, asi que un `max`
  // elegido con un modelo medido seguiria viajando al cambiar de modelo.
  it("un nivel que el modelo no ofrece baja al mas alto que SI ofrece", () => {
    expect(caparEsfuerzo("max", SIN_MEDIR)).toBe("high");
    expect(caparEsfuerzo("xhigh", SIN_MEDIR)).toBe("high");
  });

  it("nunca manda al suelo: quien pidio el techo se queda en el techo que haya", () => {
    expect(caparEsfuerzo("max", SIN_MEDIR)).not.toBe("low");
  });

  it("lo que el modelo SI ofrece pasa intacto", () => {
    expect(caparEsfuerzo("low", SIN_MEDIR)).toBe("low");
    expect(caparEsfuerzo("max", MEDIDO)).toBe("max");
  });

  // `auto` no es un peldano: es la instruccion de elegir peldano, y lo que
  // elige ya sale de la capacidad de este modelo.
  it("`auto` no se recorta", () => {
    expect(caparEsfuerzo("auto", SIN_MEDIR)).toBe("auto");
  });
});
