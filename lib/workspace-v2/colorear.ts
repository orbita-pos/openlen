// LOS COLORES DE SINTAXIS DEL TALLER (la #15 de
// plans/len-agente-2026/notas/fase-5-taller.md), escritos aquí y sin librerías.
//
// Lo colorean Claude Code (con su propio coloreador), v0, la pestaña de revisión
// de DeepSeek y Cursor. Aquí sólo hace falta lo que hay en un sitio de OpenLen:
// HTML —con su `<style>` y su `<script>`—, CSS, JavaScript, JSON y Markdown. No
// es un analizador: es un escáner de una pasada que acierta en lo corriente y,
// cuando no, deja el texto sin color. Nunca cambia el texto: juntar los trozos
// da byte a byte lo de entrada (lo comprueba la prueba).
//
// Se colorea el DOCUMENTO ENTERO y después se parte en líneas: así una línea
// que está dentro de un `<script>` o de un comentario largo sabe dónde está, que
// es lo que le falta a colorear trozo a trozo. Puro: lo prueba vitest.

export type TipoDeColor =
  /** El nombre de una etiqueta HTML. */
  | "etq"
  /** El nombre de un atributo. */
  | "atr"
  /** Un valor: texto entre comillas, el valor de un atributo. */
  | "val"
  | "com"
  /** Palabra clave, `true`/`false`/`null`, `<!doctype>`, `@media`. */
  | "pal"
  /** Número, unidad, color en hex. */
  | "num"
  /** Propiedad CSS, clave de JSON. */
  | "pro"
  /** `<`, `>`, `=`, llaves y comas: atenuado. */
  | "pun"
  /** Un título de Markdown. */
  | "tit";

export interface Trozo {
  readonly texto: string;
  readonly tipo: TipoDeColor | null;
}

export type Lenguaje = "html" | "css" | "js" | "json" | "markdown";

/** Por encima de esto no se colorea: un fichero enorme se lee igual sin color. */
export const MAX_COLOREABLE = 400_000;

export function lenguajeDe(ruta: string): Lenguaje | null {
  const ext = ruta.slice(ruta.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "css") return "css";
  if (ext === "js" || ext === "mjs") return "js";
  if (ext === "json" || ext === "jsonl" || ext === "webmanifest") return "json";
  if (ext === "md" || ext === "markdown") return "markdown";
  return null;
}

/** El documento coloreado y partido en líneas (una por cada `\n`). */
export function colorearLineas(texto: string, lenguaje: Lenguaje | null): Trozo[][] {
  const trozos = lenguaje && texto.length <= MAX_COLOREABLE ? colorear(texto, lenguaje) : [{ texto, tipo: null }];
  const lineas: Trozo[][] = [[]];
  for (const t of trozos) {
    const partes = t.texto.split("\n");
    partes.forEach((p, i) => {
      if (i > 0) lineas.push([]);
      if (p) lineas[lineas.length - 1]!.push({ texto: p, tipo: t.tipo });
    });
  }
  return lineas;
}

export function colorear(texto: string, lenguaje: Lenguaje): Trozo[] {
  const out = new Salida();
  if (lenguaje === "html") html(texto, out);
  else if (lenguaje === "css") css(texto, out);
  else if (lenguaje === "js") js(texto, out);
  else if (lenguaje === "json") json(texto, out);
  else markdown(texto, out);
  return out.trozos;
}

/** Junta los trozos seguidos del mismo tipo (sobre todo el texto sin color). */
class Salida {
  readonly trozos: Trozo[] = [];
  push(texto: string, tipo: TipoDeColor | null): void {
    if (!texto) return;
    const ultimo = this.trozos[this.trozos.length - 1];
    if (ultimo && ultimo.tipo === tipo) this.trozos[this.trozos.length - 1] = { texto: ultimo.texto + texto, tipo };
    else this.trozos.push({ texto, tipo });
  }
}

/** Desde `i`, hasta justo después de `fin` (o hasta el final si no aparece). */
function hasta(texto: string, i: number, fin: string): number {
  const j = texto.indexOf(fin, i);
  return j < 0 ? texto.length : j + fin.length;
}

/** Una cadena entre comillas desde `i` (la comilla de apertura), con sus escapes. */
function cadena(texto: string, i: number): number {
  const q = texto[i]!;
  let j = i + 1;
  while (j < texto.length && texto[j] !== q) j += texto[j] === "\\" ? 2 : 1;
  return Math.min(j + 1, texto.length);
}

// ─── HTML ───────────────────────────────────────────────────────────────────

function html(texto: string, out: Salida): void {
  let i = 0;
  const n = texto.length;
  while (i < n) {
    if (texto.startsWith("<!--", i)) {
      const j = hasta(texto, i + 4, "-->");
      out.push(texto.slice(i, j), "com");
      i = j;
      continue;
    }
    if (texto.startsWith("<!", i)) {
      const j = hasta(texto, i, ">");
      out.push(texto.slice(i, j), "pal");
      i = j;
      continue;
    }
    if (texto[i] === "<" && /[a-zA-Z/]/.test(texto[i + 1] ?? "")) {
      i = etiqueta(texto, i, out);
      continue;
    }
    const j = texto.indexOf("<", i + 1);
    const fin = j < 0 ? n : j;
    out.push(texto.slice(i, fin), null);
    i = fin;
  }
}

/** Una etiqueta desde su `<`; si abre `<style>` o `<script>`, también su contenido. */
function etiqueta(texto: string, i: number, out: Salida): number {
  const cierra = texto[i + 1] === "/";
  out.push(cierra ? "</" : "<", "pun");
  i += cierra ? 2 : 1;
  const nombre = /^[a-zA-Z][\w:-]*/.exec(texto.slice(i, i + 64))?.[0] ?? "";
  out.push(nombre, "etq");
  i += nombre.length;
  const n = texto.length;
  while (i < n) {
    const c = texto[i]!;
    if (c === ">") {
      out.push(">", "pun");
      i += 1;
      break;
    }
    if (c === "/" && texto[i + 1] === ">") {
      out.push("/>", "pun");
      i += 2;
      break;
    }
    if (/\s/.test(c)) {
      const m = /^\s+/.exec(texto.slice(i, i + 256))![0];
      out.push(m, null);
      i += m.length;
      continue;
    }
    if (c === "=") {
      out.push("=", "pun");
      i += 1;
      const q = texto[i];
      if (q === '"' || q === "'") {
        const j = cadena(texto, i);
        out.push(texto.slice(i, j), "val");
        i = j;
      } else {
        const m = /^[^\s>]+/.exec(texto.slice(i, i + 512))?.[0] ?? "";
        out.push(m, "val");
        i += m.length;
      }
      continue;
    }
    const m = /^[^\s"'>/=]+/.exec(texto.slice(i, i + 256))?.[0];
    if (m) {
      out.push(m, "atr");
      i += m.length;
    } else {
      out.push(c, null);
      i += 1;
    }
  }
  const dentro = nombre.toLowerCase();
  if (!cierra && (dentro === "script" || dentro === "style")) {
    const k = texto.toLowerCase().indexOf(`</${dentro}`, i);
    const fin = k < 0 ? n : k;
    const contenido = texto.slice(i, fin);
    if (dentro === "style") css(contenido, out);
    else js(contenido, out);
    return fin;
  }
  return i;
}

// ─── CSS ────────────────────────────────────────────────────────────────────

function css(texto: string, out: Salida): void {
  let i = 0;
  const n = texto.length;
  let profundidad = 0;
  let parentesis = 0;
  while (i < n) {
    const c = texto[i]!;
    const resto = texto.slice(i, i + 256);
    const empiezaNombre = /[\w-]/.test(c) && !/[\w-]/.test(texto[i - 1] ?? "");
    if (texto.startsWith("/*", i)) {
      const j = hasta(texto, i + 2, "*/");
      out.push(texto.slice(i, j), "com");
      i = j;
    } else if (c === '"' || c === "'") {
      const j = cadena(texto, i);
      out.push(texto.slice(i, j), "val");
      i = j;
    } else if (c === "@") {
      const m = /^@[\w-]+/.exec(resto)?.[0] ?? "@";
      out.push(m, "pal");
      i += m.length;
    } else if (c === "{" || c === "}") {
      profundidad += c === "{" ? 1 : -1;
      out.push(c, "pun");
      i += 1;
    } else if (
      empiezaNombre &&
      ((profundidad > 0 && /^[\w-]+\s*:[^;{}]*(?:[;}]|$)/.test(resto)) ||
        (parentesis > 0 && /^[\w-]+\s*:[^;{}()]*\)/.test(resto)))
    ) {
      // Una propiedad: un nombre, dos puntos y un valor que acaba antes de abrir
      // un bloque (`a:hover {` no lo es); o, dentro de `@media (…)`, antes del
      // paréntesis.
      const m = /^[\w-]+/.exec(resto)![0];
      out.push(m, "pro");
      i += m.length;
    } else if (c === "#" && /^#[0-9a-fA-F]{3,8}\b/.test(resto) && profundidad > 0) {
      const m = /^#[0-9a-fA-F]{3,8}/.exec(resto)![0];
      out.push(m, "num");
      i += m.length;
    } else if (/[\d.]/.test(c) && !/[\w-]/.test(texto[i - 1] ?? "") && /^\.?\d/.test(resto)) {
      const m = /^\d*\.?\d+(?:%|[a-zA-Z]+)?/.exec(resto)![0];
      out.push(m, "num");
      i += m.length;
    } else if (":;,()>".includes(c)) {
      if (c === "(") parentesis += 1;
      if (c === ")") parentesis = Math.max(0, parentesis - 1);
      out.push(c, "pun");
      i += 1;
    } else {
      const m = /^[^/"'@{}#\d.:;,()>\s]+|^\s+|^./.exec(resto)![0];
      out.push(m, null);
      i += m.length;
    }
  }
}

// ─── JavaScript ─────────────────────────────────────────────────────────────

const PALABRAS_JS = new Set(
  (
    "const let var function return if else for while do switch case break continue default new delete typeof instanceof " +
    "in of class extends super this import export from as async await try catch finally throw yield void true false null undefined"
  ).split(" "),
);

function js(texto: string, out: Salida): void {
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i]!;
    if (texto.startsWith("//", i)) {
      const j = texto.indexOf("\n", i);
      const fin = j < 0 ? n : j;
      out.push(texto.slice(i, fin), "com");
      i = fin;
    } else if (texto.startsWith("/*", i)) {
      const j = hasta(texto, i + 2, "*/");
      out.push(texto.slice(i, j), "com");
      i = j;
    } else if (c === '"' || c === "'" || c === "`") {
      const j = cadena(texto, i);
      out.push(texto.slice(i, j), "val");
      i = j;
    } else if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(texto.slice(i, i + 128))![0];
      out.push(m, PALABRAS_JS.has(m) ? "pal" : null);
      i += m.length;
    } else if (/\d/.test(c) && !/[\w$]/.test(texto[i - 1] ?? "")) {
      const m = /^0[xX][\da-fA-F]+|^\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(texto.slice(i, i + 64))?.[0] ?? c;
      out.push(m, "num");
      i += m.length;
    } else {
      const m = /^[^A-Za-z_$\d"'`/]+|^./.exec(texto.slice(i, i + 256))![0];
      out.push(m, null);
      i += m.length;
    }
  }
}

// ─── JSON ───────────────────────────────────────────────────────────────────

function json(texto: string, out: Salida): void {
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i]!;
    if (c === '"') {
      const j = cadena(texto, i);
      // Una clave es una cadena seguida de dos puntos.
      const clave = /^\s*:/.test(texto.slice(j, j + 64));
      out.push(texto.slice(i, j), clave ? "pro" : "val");
      i = j;
    } else if ("{}[],:".includes(c)) {
      out.push(c, "pun");
      i += 1;
    } else if (/[-\d]/.test(c)) {
      const m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(texto.slice(i, i + 64))?.[0] || c;
      out.push(m, m === c && c === "-" ? null : "num");
      i += m.length;
    } else if (/[a-z]/.test(c)) {
      const m = /^[a-z]+/.exec(texto.slice(i, i + 16))![0];
      out.push(m, m === "true" || m === "false" || m === "null" ? "pal" : null);
      i += m.length;
    } else {
      const m = /^[^"{}[\],:\-\da-z]+/.exec(texto.slice(i, i + 256))?.[0] || c;
      out.push(m, null);
      i += m.length;
    }
  }
}

// ─── Markdown ───────────────────────────────────────────────────────────────

function markdown(texto: string, out: Salida): void {
  texto.split("\n").forEach((linea, k) => {
    if (k > 0) out.push("\n", null);
    if (/^#{1,6}\s/.test(linea)) {
      out.push(linea, "tit");
      return;
    }
    const marca = /^(\s*)([-*+]|\d+\.|>)(\s)/.exec(linea);
    let i = 0;
    if (marca) {
      out.push(marca[1]!, null);
      out.push(marca[2]!, "pun");
      out.push(marca[3]!, null);
      i = marca[0].length;
    }
    while (i < linea.length) {
      const c = linea[i]!;
      if (c === "`") {
        const j = linea.indexOf("`", i + 1);
        const fin = j < 0 ? linea.length : j + 1;
        out.push(linea.slice(i, fin), "val");
        i = fin;
      } else if (c === "]" && linea[i + 1] === "(") {
        const j = linea.indexOf(")", i + 2);
        const fin = j < 0 ? linea.length : j + 1;
        out.push("](", "pun");
        out.push(linea.slice(i + 2, fin - (j < 0 ? 0 : 1)), "atr");
        if (j >= 0) out.push(")", "pun");
        i = fin;
      } else {
        const m = /^[^`\]]+|^./.exec(linea.slice(i))![0];
        out.push(m, null);
        i += m.length;
      }
    }
  });
}
