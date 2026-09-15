// UN `prompt()` EN UN MANEJADOR COLGABA LA MEDICIÓN PARA SIEMPRE.
//
// 🔴 EL CASO, medido en producción el 2026-09-15 sobre la página de decks de
// Yu-Gi-Oh de un usuario (proyecto `1cebbe4d`). El modelo escribió lo correcto
// —«Nuevo deck» pide el nombre con `prompt()`, «Borrar» pregunta con
// `confirm()`— y nosotros pulsamos TODOS los controles para comprobar el
// comportamiento (`PULSAR_CONTROLES`). El diálogo nativo salió, Chromium se
// quedó esperando a que alguien lo cerrase, y nadie lo cerraba:
//
//   · la misma página SIN `prompt()`  → 7,2 s, con medida
//   · la misma página CON `prompt()`  → seguía colgada a los 240 s
//
// No es lento: NO TERMINA. Ni siquiera el `protocolTimeout` de puppeteer lo
// acota. Aguas arriba eso dejó al turno del Agente sin emitir un solo byte, y a
// los 90 s exactos Caddy cortó la respuesta a medias (`read_timeout 90s`) — que
// es lo que el navegador del usuario llamó «network error».
//
// 🔴 Y LA CAUSA ES UNA REGLA ESCRITA EN UNO DE LOS DOS RENDERIZADORES.
// `inline-image.ts` descarta los diálogos desde siempre, con un comentario que
// describe este fallo palabra por palabra («deja la página colgada esperando a
// nadie»). `visual-quality-renderer.ts` —que es el que PULSA— no lo hacía. Es
// exactamente la asimetría que ya nos costó una vez entre estos dos mismos
// ficheros (el origen de medida, siete días de diferencia) y que CLAUDE.md
// documenta como trampa conocida.
//
// ⚠️ ESTAS PRUEBAS TIENEN QUE SER DE NAVEGADOR: las de
// `visual-quality-renderer.test.ts` mockean `page.evaluate`, así que jamás
// abren un diálogo de verdad y este fallo vivía ahí con la suite en verde.
import { describe, expect, it } from "vitest";
import { renderVisualQualityViewports } from "./visual-quality-renderer";

const marco = (cuerpo: string) => `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;font:16px/1.4 system-ui;background:#fff;color:#111}</style>
</head><body>${cuerpo}</body></html>`;

/** La página real, reducida a lo que importa: un botón que pide algo. */
const conDialogo = (llamada: string) =>
  marco(`
    <h1>Mis decks</h1>
    <p>Texto suficiente para que la medida tenga algo que mirar.</p>
    <button id="btn-nuevo-deck">Nuevo deck</button>
    <script>
      document.getElementById('btn-nuevo-deck').addEventListener('click', function () {
        window.__respuesta = ${llamada};
      });
    </script>`);

describe("un diálogo nativo no puede colgar la medición", () => {
  // Los tres verbos que bloquean el hilo de la página. El de producción fue
  // `prompt()`; los otros dos cuelgan igual y por lo mismo, así que se sujetan
  // aquí en vez de esperar a que uno de ellos vuelva a tumbar un turno.
  for (const [nombre, llamada] of [
    ["prompt", "prompt('Nombre del nuevo deck:', 'Deck 1')"],
    ["confirm", "confirm('¿Borrar el deck?')"],
    ["alert", "alert('Deck creado')"],
  ] as const) {
    it(`🔴 ${nombre}() en un manejador: la medida VUELVE`, async () => {
      const medida = await renderVisualQualityViewports(conDialogo(llamada));
      // Volver es TODO lo que se pide aquí. Que vuelva con foto es la prueba de
      // que además siguió midiendo — un `null` sería «no se pudo medir», que es
      // honesto pero deja ciego al modelo.
      expect(medida).not.toBeNull();
      expect(medida?.desktop).toBeTruthy();
    }, 60_000);
  }

  // ── lo que el descarte NO puede romper ───────────────────────────────────

  it("se DESCARTA, no se acepta: la página recorre su camino de cancelar", async () => {
    // `dismiss()` hace que `prompt()` devuelva null y `confirm()` devuelva
    // false, que es la rama «el usuario le dio a Cancelar». Aceptar sería
    // inventarnos una respuesta y medir una página que nadie va a ver: un deck
    // creado con el nombre por defecto, filas que el visitante no pidió.
    const medida = await renderVisualQualityViewports(
      marco(`
        <h1>Mis decks</h1>
        <p id="salida">sin tocar</p>
        <button id="btn-nuevo-deck">Nuevo deck</button>
        <script>
          document.getElementById('btn-nuevo-deck').addEventListener('click', function () {
            var nombre = prompt('Nombre del nuevo deck:', 'Deck 1');
            document.getElementById('salida').textContent =
              nombre === null ? 'cancelado' : 'creado ' + nombre;
          });
        </script>`),
    );
    expect(medida).not.toBeNull();
    // Y el turno no se lleva un grito inventado: cancelar no es un error.
    expect(medida?.runtimeErrors ?? []).toEqual([]);
  }, 60_000);

  it("CONTRA-PRUEBA: una página sin diálogos mide igual que siempre", async () => {
    const medida = await renderVisualQualityViewports(
      marco(`<h1>Mis decks</h1><p>Texto normal.</p><button>Nuevo deck</button>`),
    );
    expect(medida).not.toBeNull();
    expect(medida?.runtimeErrors ?? []).toEqual([]);
  }, 60_000);
});
