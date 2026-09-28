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

describe("la postura se traduce a un presupuesto, y el defecto deja decidir al modelo", () => {
  // 🔴 H5 (2026-09-26). El defecto mandaba 100 y ataba SIEMPRE: en los 1.473
  // pasos del control de Len-Bench el razonamiento dio p50 100 y máximo 113, y
  // en 17 peticiones el modelo siguió razonando dentro del texto del dueño.
  // Claude Code manda `{type:"adaptive"}` en el nivel que sea: el modelo decide.
  it("🔴 `auto` y `high` no mandan presupuesto: el modelo decide cuánto pensar", () => {
    expect(presupuestoDeEsfuerzo("auto", 32_768)).toBeUndefined();
    expect(presupuestoDeEsfuerzo(NIVEL_POR_DEFECTO, 32_768)).toBeUndefined();
  });

  // BRAZO DE CONTROL: los niveles bajos SÍ atan, que es lo único que este dial
  // hace de verdad (medido el 11/09: exacto hasta 225).
  it("`low` y `medium` siguen siendo números pequeños, y en orden", () => {
    expect(presupuestoDeEsfuerzo("low", 32_768)).toBe(25);
    expect(presupuestoDeEsfuerzo("medium", 32_768)).toBe(60);
  });

  it("resolver: `auto` da el defecto, y un nivel se da a sí mismo", () => {
    expect(resolverEsfuerzo("auto")).toBe(NIVEL_POR_DEFECTO);
    for (const n of NIVELES) expect(resolverEsfuerzo(n)).toBe(n);
  });

  // Los de arriba, con los números de Claude Code: 1024 es el suelo de todo
  // presupuesto suyo, y su presupuesto por defecto es el techo de salida
  // menos uno. Quedan por encima de la banda del modelo sin campo (hasta 691).
  it("`xhigh` es el suelo de Claude Code y `max` el techo de salida menos uno", () => {
    expect(presupuestoDeEsfuerzo("xhigh", 32_768)).toBe(1024);
    expect(presupuestoDeEsfuerzo("max", 32_768)).toBe(32_767);
    expect(presupuestoDeEsfuerzo("xhigh", 32_768)!).toBeGreaterThan(691);
  });

  it("el número se recorta contra el techo de salida (regla de Claude Code)", () => {
    expect(presupuestoDeEsfuerzo("max", 50)).toBe(49);
    expect(presupuestoDeEsfuerzo("xhigh", 2_048)).toBe(1024);
    expect(presupuestoDeEsfuerzo("max", 2_048)).toBe(2_047);
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

  // 🔴 V4.1 Flash llega hasta `high` y no más (2026-09-26): en DeepSeek el
  // campo sólo pone un TECHO, y con `high` adaptativo (H5) `xhigh` pensaba
  // MENOS que `high` y `max` era `high` con otro nombre. El porqué entero, en
  // `DIAL_MEDIDO`.
  it("un modelo MEDIDO ofrece hasta su tope comprobado — V4.1 Flash, hasta `high`", () => {
    const c = capacidadDeEsfuerzo(MEDIDO);
    expect(c.medido).toBe(true);
    expect(c.niveles).toEqual(["low", "medium", "high"]);
    expect(c.niveles).not.toContain("xhigh");
    expect(c.niveles).not.toContain("max");
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

  // BRAZO DE CONTROL de las dos de arriba. ⚰️ Aquí comparaba el LARGO de las
  // dos listas; desde que V4.1 Flash llega sólo a `high`, su lista es la misma
  // que la reserva, y lo que distingue a la tabla es que dice MEDIDO. Si la
  // tabla se vaciara, la primera dejaría de estar medida y ésta caería.
  it("las dos ramas se DISTINGUEN — si no, la tabla no hace nada", () => {
    expect(capacidadDeEsfuerzo(MEDIDO).medido).toBe(true);
    expect(capacidadDeEsfuerzo("modelo-inventado").medido).toBe(false);
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
    expect(caparEsfuerzo("medium", MEDIDO)).toBe("medium");
    expect(caparEsfuerzo("high", MEDIDO)).toBe("high");
  });

  // Quien guardó `xhigh` o `max` con V4.1 Flash no pierde nada: baja a `high`,
  // que en este modelo es el adaptativo — lo más que el modelo piensa.
  it("en V4.1 Flash, `xhigh` y `max` guardados bajan a `high`", () => {
    expect(caparEsfuerzo("xhigh", MEDIDO)).toBe("high");
    expect(caparEsfuerzo("max", MEDIDO)).toBe("high");
  });

  // `auto` no es un peldano: es la instruccion de elegir peldano, y lo que
  // elige ya sale de la capacidad de este modelo.
  it("`auto` no se recorta", () => {
    expect(caparEsfuerzo("auto", SIN_MEDIR)).toBe("auto");
  });
});
