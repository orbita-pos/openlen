/**
 * LOS <script> QUE EL NAVEGADOR NO PUEDE NI LEER, con su línea y columna del
 * fichero (H6, 2026-09-26).
 *
 * Un error de sintaxis tumba el `<script>` ENTERO: no corre ni una línea, y la
 * página se queda sin su interactividad sin que nada lo diga en pantalla. En
 * el control de Len-Bench (`encargo-grande` #3) un Edit metió un `+` delante
 * de un `?` y Len pasó ~90 pasos a ciegas: los ojos decían «la página lanzó:
 * SyntaxError…», sin dónde. En Claude Code eso lo dice el servidor de lenguaje
 * tras cada edición, `[Line L:C] message`.
 *
 * Se COMPILA con `node:vm`, sin ejecutar nada. Sólo los scripts clásicos: los
 * `type="module"` necesitarían una bandera experimental de `vm`, y los de datos
 * (`application/json`, `data-ol-*`) o con `src` no son código del modelo.
 *
 * Puro: sin navegador ni red.
 */
import vm from "node:vm";
import { posicionEnIndice } from "@/lib/agent/diagnosticos";

export interface JsQueNoCompila {
  /** Línea y columna desde 1, las del `cat -n` de Read. */
  readonly linea: number;
  readonly columna: number;
  /** El de V8, tal cual: «SyntaxError: Unexpected token '?'». */
  readonly mensaje: string;
}

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const CLASICOS = new Set(["", "text/javascript", "application/javascript", "javascript"]);

export function jsQueNoCompila(html: string): JsQueNoCompila[] {
  const fuera: JsQueNoCompila[] = [];
  for (const m of html.matchAll(SCRIPT)) {
    const atributos = m[1];
    const codigo = m[2];
    if (/\bsrc\s*=/i.test(atributos) || /\bdata-ol-/i.test(atributos) || !codigo.trim()) continue;
    const tipo = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(atributos)?.[1]?.toLowerCase() ?? "";
    if (!CLASICOS.has(tipo)) continue;
    let error: unknown = null;
    try {
      new vm.Script(codigo, { filename: "s" });
    } catch (e) {
      error = e;
    }
    // Por el nombre, no por `instanceof`: bajo jsdom el SyntaxError de `vm` es
    // de otro global.
    if (!error || (error as Error).name !== "SyntaxError") continue;
    const donde = dondeFallo(error as Error);
    const inicio = posicionEnIndice(html, (m.index ?? 0) + "<script".length + atributos.length + ">".length);
    fuera.push({
      linea: donde ? inicio.linea + donde.linea - 1 : inicio.linea,
      columna: donde ? (donde.linea === 1 ? inicio.columna + donde.columna - 1 : donde.columna) : inicio.columna,
      mensaje: `SyntaxError: ${(error as Error).message}`,
    });
  }
  return fuera;
}

/** V8 abre la pila de un SyntaxError de `vm` con `s:<línea>`, la línea de
 *  código y un `^` debajo de la columna. */
function dondeFallo(e: Error): { linea: number; columna: number } | null {
  const lineas = (e.stack ?? "").split("\n");
  const linea = /^s:(\d+)$/.exec(lineas[0] ?? "")?.[1];
  const caret = lineas.slice(1, 4).find((l) => /^\s*\^+\s*$/.test(l));
  if (!linea) return null;
  return { linea: Number(linea), columna: caret ? caret.indexOf("^") + 1 : 1 };
}
