import { describe, expect, it } from "vitest";
import {
  TOPE_CADENA,
  TOPE_DIARIO,
  TOPE_ENTRADAS,
  crearDiarioDelTurno,
  podarBulto,
} from "./diario-del-turno";

describe("podarBulto", () => {
  it("deja pasar entero un mensaje de error — que es lo que se viene a buscar", () => {
    const motivo = "no se encontró ningún token --ol-accent en el documento";
    expect(podarBulto({ ok: false, error: motivo })).toEqual({ ok: false, error: motivo });
  });

  it("vacía el documento y deja dicho cuánto había", () => {
    const documento = "x".repeat(42_000);
    const podado = podarBulto({ ok: true, documento }) as Record<string, unknown>;
    expect(podado.documento).toBe("[42000 bytes]");
    expect(podado.ok).toBe(true);
  });

  it("poda por TAMAÑO y no por nombre, así que una clave nueva no se escapa", () => {
    // La regla que caduca es la que nombra la interfaz: si mañana una
    // herramienta devuelve `maquetaCompleta`, esto la poda igual.
    const podado = podarBulto({ maquetaCompleta: "y".repeat(TOPE_CADENA + 1) }) as Record<
      string,
      unknown
    >;
    expect(podado.maquetaCompleta).toBe(`[${TOPE_CADENA + 1} bytes]`);
  });

  it("baja hasta los objetos anidados", () => {
    const podado = podarBulto({
      pagina_vista: { slug: "precios", documento: "z".repeat(9_000) },
    }) as { pagina_vista: Record<string, unknown> };
    expect(podado.pagina_vista.slug).toBe("precios");
    expect(podado.pagina_vista.documento).toBe("[9000 bytes]");
  });

  it("recorta las listas largas diciendo cuántas quedaron fuera", () => {
    const podado = podarBulto({ hallazgos: Array.from({ length: 30 }, (_, i) => `h${i}`) }) as {
      hallazgos: unknown[];
    };
    expect(podado.hallazgos).toHaveLength(13);
    expect(podado.hallazgos[12]).toBe("[+18 más]");
  });

  it("no toca números, booleanos ni null", () => {
    expect(podarBulto({ edits: 3, ok: false, versionPrevia: null })).toEqual({
      edits: 3,
      ok: false,
      versionPrevia: null,
    });
  });
});

describe("crearDiarioDelTurno", () => {
  it("devuelve null cuando el turno no llamó a ninguna herramienta", () => {
    expect(crearDiarioDelTurno().entradas()).toBeNull();
  });

  it("guarda el motivo del fallo — el caso que lo hizo existir", () => {
    // Producción, 2026-08-30 y 2026-09-01: `cambiar_tema` falló las dos veces
    // que un usuario pidió un color y sólo quedó `summary: "cambiar_tema"`.
    const diario = crearDiarioDelTurno();
    diario.anotar("cambiar_tema", { ok: false, error: "el acento no está cableado" });
    expect(diario.entradas()).toEqual([
      { tool: "cambiar_tema", ok: false, respuesta: { ok: false, error: "el acento no está cableado" } },
    ]);
  });

  it("no lanza con una respuesta que no se puede recorrer", () => {
    const ciclo: Record<string, unknown> = { ok: true };
    ciclo.yo = ciclo;
    const diario = crearDiarioDelTurno();
    expect(() => diario.anotar("leer_estado", ciclo)).not.toThrow();
    // Se anota que hubo llamada: perder la entrada sería perder el hecho.
    expect(diario.entradas()).toHaveLength(1);
  });

  it("corta en TOPE_ENTRADAS llamadas", () => {
    const diario = crearDiarioDelTurno();
    for (let i = 0; i < TOPE_ENTRADAS + 15; i++) diario.anotar("leer_estado", { ok: true, i });
    expect(diario.entradas()).toHaveLength(TOPE_ENTRADAS);
  });

  it("quita entradas por el FINAL hasta caber, nunca corta el JSON a medias", () => {
    const diario = crearDiarioDelTurno();
    // Tres notas al tope por entrada ≈ 1,3 KB × 40 = ~52 KB, muy por encima
    // del tope global. Con una sola nota (~450 B) las 40 caben y no hay nada
    // que podar — que es lo que este mismo test asertaba mal al escribirlo.
    for (let i = 0; i < TOPE_ENTRADAS; i++) {
      diario.anotar(`t${i}`, {
        ok: true,
        nota: "n".repeat(TOPE_CADENA),
        otra: "o".repeat(TOPE_CADENA),
        tercera: "t".repeat(TOPE_CADENA),
      });
    }
    const entradas = diario.entradas()!;
    expect(JSON.stringify(entradas).length).toBeLessThanOrEqual(TOPE_DIARIO);
    // Las PRIMERAS son las que explican cómo empezó a torcerse.
    expect(entradas[0].tool).toBe("t0");
    expect(entradas.length).toBeLessThan(TOPE_ENTRADAS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LO QUE LEN ENVIÓ, no sólo lo que le contestaron (2026-09-18).
//
// El diario nació guardando la RESPUESTA, que es la mitad que faltaba entonces.
// La otra mitad es el argumento: «`editar_texto` falló» no se puede leer sin
// saber a qué selector apuntaba. En la transcripción de Claude Code las dos
// viven juntas —el `tool_use` lleva su `input` entero y el `tool_result` va
// enlazado por `tool_use_id`—, y la poda que ellos hacen es del BLOQUE GRANDE
// (el contenido del fichero), nunca del desenlace.
// Aquí es la misma poda por tamaño que ya se le hace a la respuesta.
describe("crearDiarioDelTurno — lo que se envió", () => {
  it("🔴 guarda los argumentos junto a la respuesta", () => {
    const diario = crearDiarioDelTurno();
    diario.anotar(
      "editar_texto",
      { ok: false, error: "selector sin coincidencias" },
      { selector: "#hero h1", texto: "Hola" },
    );
    expect(diario.entradas()).toEqual([
      {
        tool: "editar_texto",
        args: { selector: "#hero h1", texto: "Hola" },
        ok: false,
        respuesta: { ok: false, error: "selector sin coincidencias" },
      },
    ]);
  });

  it("poda el bulto de los argumentos igual que el de la respuesta", () => {
    const diario = crearDiarioDelTurno();
    const documento = "x".repeat(TOPE_CADENA + 1);
    diario.anotar("editar_html", { ok: true }, { selector: "main", html: documento });
    const [entrada] = diario.entradas()!;
    expect(entrada.args).toEqual({
      selector: "main",
      html: `[${documento.length} bytes]`,
    });
  });

  // CONTRA-PRUEBA: sin argumentos la clave no aparece, para que una entrada
  // vieja y una llamada sin argumentos se lean igual y no ocupen de más.
  it("CONTRA-PRUEBA: sin argumentos, la entrada no lleva la clave", () => {
    const diario = crearDiarioDelTurno();
    diario.anotar("leer_estado", { ok: true });
    diario.anotar("mirar_pagina", { ok: true }, {});
    for (const entrada of diario.entradas()!) {
      expect("args" in entrada).toBe(false);
    }
  });

  it("unos argumentos que no se pueden recorrer no cuestan la entrada", () => {
    const ciclo: Record<string, unknown> = { selector: "main" };
    ciclo.yo = ciclo;
    const diario = crearDiarioDelTurno();
    expect(() => diario.anotar("editar_html", { ok: true }, ciclo)).not.toThrow();
    expect(diario.entradas()).toHaveLength(1);
  });
});
