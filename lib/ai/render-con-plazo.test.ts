// NINGÚN RENDER SIN TOPE, Y AL VENCER SE MATA EL NAVEGADOR.
//
// 🔴 EL CASO, medido en producción el 2026-09-15. Una página cuyo botón pedía
// el nombre con `prompt()` dejó la medición del turno colgada — no lenta: sin
// final (240 s y seguía dentro). Ese `prompt()` ya se descarta
// (`dialogos-nativos.browser.test.ts`), pero la causa de que costara el TURNO
// no fue el diálogo: fue que NADIE acotaba el render.
//
// Los tres sitios que comparten el navegador del turno —la medida que vuelve al
// modelo tras editar, `mirar_pagina` y los ojos— sólo tenían tope en uno.
//
// LO QUE ESTO SUJETA, y que es la mitad que se olvida: soltar la promesa NO
// BASTA. El pool encadena los renders en `tails[index]`, así que un render que
// no vuelve deja encolado detrás a todo el resto del proceso y `pool.close()`
// no vuelve nunca — por eso el turno del retry de producción tardó 247 s en
// cerrarse. Hay que MATAR el navegador.
//
// 🔴 CÓMO LO HACE CLAUDE CODE al correr un proceso largo:
//
//   · un vigía de SILENCIO que se reinicia con cada señal de avance y mata
//     cuando no la hay;
//   · un TECHO DURO sobre el total;
//   · el aborto de quien llamó;
//   · y en los tres casos `SIGTERM` → temporizador → `SIGKILL`, apuntando POR
//     QUÉ murió.
//
// Aquí el vigía de silencio es el plazo POR PASO (cada operación contra la
// página tiene que volver), y el techo duro es el plazo del render entero. Se
// copian los dos porque miden cosas distintas: una página de 4.096 px es LENTA
// —y no se la puede matar por eso— mientras que una bloqueada no avanza ni un
// paso.
import { describe, expect, it, vi } from "vitest";
import { createVisualQualityRendererPool, renderVisualQualityViewports } from "./visual-quality-renderer";

const HTML = "<!doctype html><html><head><title>t</title></head><body><h1>Hola</h1><p>Texto.</p></body></html>";

/** Plazos de juguete: lo que se prueba es el MECANISMO, no los números. */
const PLAZOS = { pasoMs: 60, topeMs: 200 } as const;

const nuncaVuelve = () => new Promise<never>(() => {});

/**
 * Un navegador de mentira cuya página se queda muda cuando se le pide.
 * `colgarse` decide si ESTE render se bloquea, para poder encadenar uno malo y
 * uno bueno sobre el mismo pool.
 */
function navegadorDoble(opciones: {
  colgarse: () => boolean;
  /** `close` que tampoco vuelve: obliga a escalar, como el SIGKILL de Claude Code. */
  cierreMudo?: boolean;
} = { colgarse: () => false }) {
  const cerrados: string[] = [];
  const matados: string[] = [];
  const lanzamientos: number[] = [];
  const launchBrowser = vi.fn(async () => {
    const id = `nav${lanzamientos.length}`;
    lanzamientos.push(1);
    return {
      newPage: async () => ({
        setViewport: async () => undefined,
        setContent: async () => undefined,
        evaluate: async () => (opciones.colgarse() ? nuncaVuelve() : ({} as unknown)),
        screenshot: async () => Buffer.from("jpeg"),
        on: () => undefined,
        removeAllListeners: () => undefined,
      }),
      close: async () => {
        cerrados.push(id);
        if (opciones.cierreMudo) await nuncaVuelve();
      },
      process: () => ({
        kill: () => {
          matados.push(id);
        },
      }),
    };
  });
  return { launchBrowser, cerrados, matados };
}

const internos = (launchBrowser: ReturnType<typeof navegadorDoble>["launchBrowser"]) => ({
  launchBrowser,
  installGuard: async () => undefined,
  settle: async () => undefined,
  plazos: PLAZOS,
});

describe("un render que no vuelve no puede costar el turno", () => {
  it("🔴 un paso que no vuelve NUNCA: el render vuelve igual, en null", async () => {
    const { launchBrowser } = navegadorDoble({ colgarse: () => true });
    const arranque = Date.now();

    // Sin el plazo esto no resuelve jamás y la prueba muere por timeout.
    await expect(renderVisualQualityViewports(HTML, internos(launchBrowser))).resolves.toBeNull();

    // Y vuelve POR EL PLAZO, no por casualidad: bastante antes del timeout de
    // vitest y en el orden de magnitud del tope, no del infinito.
    expect(Date.now() - arranque).toBeLessThan(3_000);
  });

  it("🔴 al vencer se MATA el navegador — soltar la promesa deja Chromium vivo", async () => {
    const { launchBrowser, cerrados } = navegadorDoble({ colgarse: () => true });

    await renderVisualQualityViewports(HTML, internos(launchBrowser));

    // Esto es lo que separa «el turno sobrevive» de «la caja se llena de
    // Chromium»: en producción quedaron 8 procesos vivos 212 s después.
    expect(cerrados, "el navegador colgado tiene que morir, no quedarse").toHaveLength(1);
  });

  it("si `close` tampoco vuelve, se ESCALA a matar el proceso", async () => {
    // El SIGTERM → temporizador → SIGKILL de Claude Code. Un `close()` educado
    // contra una página bloqueada puede no volver nunca, y entonces el cierre
    // es otro cuelgue con mejor nombre.
    const { launchBrowser, matados } = navegadorDoble({ colgarse: () => true, cierreMudo: true });

    await renderVisualQualityViewports(HTML, internos(launchBrowser));

    expect(matados, "close() mudo tiene que escalar a kill").toHaveLength(1);
  });

  it("🔴 el pool NO se queda envenenado: el render siguiente funciona", async () => {
    // El pool encadena en `tails[index]`. Si el render colgado se suelta sin
    // matar, TODO lo que venga detrás se encola tras él para siempre — el turno
    // se queda ciego aunque sólo una página fuera mala.
    let primero = true;
    const { launchBrowser } = navegadorDoble({
      colgarse: () => {
        const ahora = primero;
        primero = false;
        return ahora;
      },
    });
    const pool = await createVisualQualityRendererPool(1, internos(launchBrowser));

    await expect(pool.render(HTML)).resolves.toBeNull();
    await expect(pool.render(HTML), "el segundo render se quedó encolado tras el colgado").resolves.not.toBeNull();

    await pool.close();
  });

  it("🔴 `pool.close()` vuelve aunque un render se haya colgado", async () => {
    // `close()` hace `allSettled(tails)`, así que una cola envenenada lo deja
    // esperando para siempre — y quien lo espera es el `finally` del turno.
    // En producción eso fue un turno tardando 247 s en cerrarse.
    const { launchBrowser } = navegadorDoble({ colgarse: () => true });
    const pool = await createVisualQualityRendererPool(1, internos(launchBrowser));

    void pool.render(HTML);
    const arranque = Date.now();
    await pool.close();

    expect(Date.now() - arranque).toBeLessThan(3_000);
  });

  // ── lo que el plazo NO puede romper ──────────────────────────────────────

  it("CONTRA-PRUEBA: un render normal no se mata ni paga un arranque de más", async () => {
    const { launchBrowser, cerrados, matados } = navegadorDoble({ colgarse: () => false });
    const pool = await createVisualQualityRendererPool(1, internos(launchBrowser));

    for (let i = 0; i < 3; i += 1) {
      await expect(pool.render(`${HTML}${i}`)).resolves.not.toBeNull();
    }
    // Un solo navegador para los tres: el plazo no puede costar el ahorro que
    // el pool existe para dar (4,80 s en frío contra 2,16 s en caliente).
    expect(launchBrowser).toHaveBeenCalledTimes(1);
    expect(matados).toHaveLength(0);

    await pool.close();
    expect(cerrados).toHaveLength(1);
  });
});
