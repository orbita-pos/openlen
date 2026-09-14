import { describe, expect, it } from "vitest";

import { MAX_EN_COLA, MAX_POR_LOTE, RETRASO_MS, crearCola } from "./cliente";

function montar(noRastrear = false) {
  const enviados: { eventos: { nombre: string; sesion: string; datos: unknown }[] }[] = [];
  const programados: { fn: () => void; ms: number }[] = [];
  const cola = crearCola({
    enviar: (cuerpo) => enviados.push(JSON.parse(cuerpo)),
    programar: (fn, ms) => programados.push({ fn, ms }),
    noRastrear: () => noRastrear,
    sesion: "sesion-de-prueba",
  });
  return { cola, enviados, programados };
}

describe("la cola de eventos de uso del navegador", () => {
  it("no manda nada al registrar: espera el retraso del lote, como el binario", () => {
    const { cola, enviados, programados } = montar();
    cola.registrar("crear_vista", {});
    expect(enviados).toHaveLength(0);
    expect(programados).toHaveLength(1);
    expect(programados[0].ms).toBe(RETRASO_MS);

    programados[0].fn();
    expect(enviados).toEqual([
      { eventos: [{ nombre: "crear_vista", sesion: "sesion-de-prueba", datos: {} }] },
    ]);
  });

  it("programa UNA vez por ventana, no una por evento", () => {
    const { cola, programados } = montar();
    cola.registrar("crear_vista", {});
    cola.registrar("crear_escribio", {});
    cola.registrar("crear_envio", { imagenes: 1, referencia: false });
    expect(programados).toHaveLength(1);
  });

  it("con «No rastrear» o el GPC puestos no se encola nada", () => {
    const { cola, enviados, programados } = montar(true);
    cola.registrar("crear_vista", {});
    cola.vaciar();
    expect(programados).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  it("parte los envíos en lotes del tope que acepta la ruta", () => {
    const { cola, enviados } = montar();
    for (let i = 0; i < MAX_POR_LOTE + 5; i++) cola.registrar("crear_vista", {});
    cola.vaciar();
    expect(enviados.map((e) => e.eventos.length)).toEqual([MAX_POR_LOTE, 5]);
  });

  it("vaciar al irse manda lo pendiente sin esperar al temporizador", () => {
    const { cola, enviados } = montar();
    cola.registrar("crear_envio", { imagenes: 0, referencia: true });
    cola.vaciar();
    expect(enviados).toHaveLength(1);
    cola.vaciar();
    expect(enviados).toHaveLength(1);
  });

  it("con la cola llena se pierde el evento más viejo, no el nuevo", () => {
    const { cola, enviados } = montar();
    cola.registrar("crear_plantilla", { plantilla: "la-primera" });
    for (let i = 0; i < MAX_EN_COLA; i++) cola.registrar("crear_vista", {});
    cola.vaciar();
    const todos = enviados.flatMap((e) => e.eventos);
    expect(todos).toHaveLength(MAX_EN_COLA);
    expect(todos.some((e) => e.nombre === "crear_plantilla")).toBe(false);
  });
});
