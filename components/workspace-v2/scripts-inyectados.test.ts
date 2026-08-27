// TODO SCRIPT QUE SE INYECTA EN EL LIENZO TIENE QUE PARSEAR.
//
// Los inyectores del taller son plantillas de texto: JavaScript de navegador
// escrito DENTRO de un template literal de TypeScript. `tsc` no mira ahí. Un
// backtick de más en un comentario, una llave desbalanceada, un `${` sin querer
// — y el `<script>` entero deja de parsear.
//
// Cuando eso pasa no falla una función: falla el EDITOR COMPLETO, en silencio.
// El usuario ve una página que ya no se deja tocar y no hay ni un error en
// ningún log del servidor. Es la peor forma de romperse que tiene este código.
//
// Medido el 2026-08-26: escribiendo el arreglo del scroll metí backticks dentro
// del template literal de `use-inline-edit.ts` TRES veces seguidas. Las tres
// las cazó un `node --check` a mano. Esto es ese chequeo, pero permanente.
//
// Cada inyector se ejecuta de verdad sobre un documento mínimo y se comprueba
// que (a) inyecta algo y (b) lo que inyecta es JavaScript válido. No se prueba
// qué HACE el script — eso es de las pruebas de cada inyector — sino que
// EXISTE y que el navegador podrá leerlo.
import { describe, expect, it } from "vitest";

import { injectDropPlace } from "./use-drop-place";
import { injectElementInspect } from "./use-element-inspect";
import { injectImageReplace } from "./use-image-replace";
import { injectInlineEdit } from "./use-inline-edit";
import { injectSectionInsert } from "./use-section-insert";
import { injectSectionReorder } from "./use-section-reorder";
import { injectSectionSelect } from "./use-section-select";

const DOC =
  "<!doctype html><html><head><title>t</title></head><body>" +
  "<header><h1>Titular</h1></header><main><section><p>x</p></section></main>" +
  "</body></html>";

/** Los `<script>` que un inyector añadió, por su marcador. */
function scriptsInyectados(antes: string, despues: string): string[] {
  const previos = new Set(antes.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? []);
  return (despues.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? [])
    .filter((b) => !previos.has(b))
    .map((b) => b.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>\s*$/i, ""))
    .filter((cuerpo) => cuerpo.trim().length > 0);
}

/**
 * ¿Parsea como JavaScript de navegador?
 *
 * `new Function(cuerpo)` compila sin ejecutar — es exactamente la pregunta que
 * importa y no necesita ni Node ni navegador. Un `SyntaxError` aquí es el
 * editor entero muerto en producción.
 */
function parsea(cuerpo: string): { ok: true } | { ok: false; error: string } {
  try {
    new Function(cuerpo);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const INYECTORES: ReadonlyArray<[string, (html: string) => string]> = [
  ["inline-edit", injectInlineEdit],
  ["element-inspect", injectElementInspect],
  ["image-replace", injectImageReplace],
  ["section-reorder", injectSectionReorder],
  ["section-insert", injectSectionInsert],
  ["section-select", injectSectionSelect],
  ["drop-place", (h) => injectDropPlace(h)],
];

describe("los scripts que el taller inyecta en el lienzo", () => {
  it.each(INYECTORES)("%s inyecta JavaScript que parsea", (nombre, inyectar) => {
    const salida = inyectar(DOC);
    const cuerpos = scriptsInyectados(DOC, salida);

    // La trampa de esta prueba: si un inyector dejara de inyectar, `cuerpos`
    // saldría vacío y el `for` de abajo no comprobaría nada — verde por no
    // mirar. Se exige que haya inyectado algo.
    expect(cuerpos.length, `${nombre} no inyectó ningún <script>`).toBeGreaterThan(0);

    for (const cuerpo of cuerpos) {
      const r = parsea(cuerpo);
      expect(
        r.ok ? "" : r.error,
        `${nombre} inyectó JavaScript que no parsea — el editor entero muere en silencio`,
      ).toBe("");
    }
  });

  /**
   * Y CADA FUNCIÓN QUE VIAJA LLEVA SUS DEPENDENCIAS.
   *
   * Serializar una función con `.toString()` manda su CUERPO, no lo que ese
   * cuerpo llama. `editChildTags` llama a `isEditorNode`, que lee
   * `EDITOR_NODE_ATTRS`: las tres cosas tienen que ir. Mandar una y olvidar las
   * otras compila, parsea, y revienta con un ReferenceError la primera vez que
   * el usuario toca algo — sin un error en ningún log del servidor.
   *
   * Pasó el 2026-08-27 en los cuatro inyectores a la vez. Lo cazó una prueba de
   * navegador; esto lo caza sin arrancar Chromium.
   */
  it.each(INYECTORES)("%s no deja ninguna función suelta", (nombre, inyectar) => {
    const cuerpos = scriptsInyectados(DOC, inyectar(DOC));
    for (const cuerpo of cuerpos) {
      // Los nombres que edit-path.ts exporta y que los scripts usan. Si uno
      // aparece LLAMADO pero no DECLARADO, viajó a medias.
      for (const nombreFn of ["buildEditPath", "editChildTags", "isEditorNode"]) {
        const usado = new RegExp("\\b" + nombreFn + "\\s*\\(").test(cuerpo);
        if (!usado) continue;
        const declarado = new RegExp(
          "\\b(var|function)\\s+" + nombreFn + "\\b",
        ).test(cuerpo);
        expect(
          declarado,
          `${nombre} llama a ${nombreFn} pero no lo declara — ReferenceError en cuanto el usuario toque algo`,
        ).toBe(true);
      }
      // `isEditorNode` lee esta constante; sin ella es el mismo fallo un nivel
      // más abajo, y más difícil de ver.
      if (/\bisEditorNode\b/.test(cuerpo)) {
        expect(
          /\bvar\s+EDITOR_NODE_ATTRS\b/.test(cuerpo),
          `${nombre} serializó isEditorNode sin EDITOR_NODE_ATTRS`,
        ).toBe(true);
      }
    }
  });

  /**
   * BRAZO DE CONTROL. Si `parsea` dejara de detectar un error de sintaxis, todo
   * lo de arriba pasaría en verde sin comprobar nada — que es exactamente lo
   * que le pasó esta noche a la primera versión de la prueba del scroll.
   */
  it("y el detector de sintaxis DETECTA de verdad", () => {
    expect(parsea("var a = 1;").ok).toBe(true);
    expect(parsea("function ( { unclosed").ok).toBe(false);
    // El fallo concreto que se cometió tres veces: un backtick suelto que en el
    // template literal de TypeScript cierra la cadena antes de tiempo y deja
    // JavaScript partido por la mitad.
    expect(parsea("var a = 1; ` var b = 2;").ok).toBe(false);
  });
});
