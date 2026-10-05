/**
 * CUÁNDO UN CÓDIGO DISTINTO DE 0 NO ES UN FALLO (F1 de plans/len-agente-2026).
 *
 * Un `grep` que no encuentra nada, un `diff` que encuentra diferencias o un
 * `[ -f x ]` que da falso salen con 1, y eso es una RESPUESTA, no un fallo. La
 * regla es la de Claude Code:
 * para `grep`, `egrep`, `fgrep`, `rg`, `find`, `diff`, `test` y `[`, el 1 es
 * respuesta y del 2 en adelante, fallo; para todo lo demás, cualquier código
 * distinto de 0 es fallo. Allí también `git diff` y `git grep`; aquí no, porque
 * en la terminal de Len no hay `git` (127).
 *
 * Cuenta el ÚLTIMO comando de la línea, que es el que pone el código. Y si su
 * tubería va detrás de `&&`, el 1 puede ser del de antes (`cd x && grep y`:
 * ¿falló el `cd`?): no se sabe, así que es fallo, como allí. Lo que no se sabe
 * leer (comillas sin cerrar, un `case`) también es fallo: equivocarse hacia el
 * rojo sólo pinta una tarjeta de más; hacia el verde taparía un fallo de verdad.
 *
 * Decide el color de la tarjeta y el contador de fallos repetidos del bucle.
 * Lo que lee el modelo no cambia: la línea de DeepSeek
 * `[Command finished with exit code N]` va siempre. Puro, sin imports.
 */

const RESPONDEN_CON_1 = new Set(["grep", "egrep", "fgrep", "rg", "find", "diff", "test", "["]);

export function esFalloDeLaTerminal(command: string, exitCode: number): boolean {
  if (exitCode === 0) return false;
  if (exitCode !== 1) return true;
  const ultimo = ultimoComando(command);
  if (!ultimo || ultimo.trasY) return true;
  return !RESPONDEN_CON_1.has(ultimo.palabra);
}

interface Trozo {
  readonly texto: string;
  /** El separador que lo precede: `;`, `&`, salto de línea, `&&`, `||` o `|`. */
  readonly antes: string | null;
}

/** La primera palabra del último comando y si su tubería va detrás de `&&`. */
function ultimoComando(linea: string): { palabra: string; trasY: boolean } | null {
  const ts = trozos(linea)?.filter((t) => t.texto.trim() !== "");
  if (!ts || ts.length === 0) return null;
  let inicio = ts.length - 1;
  while (inicio > 0 && ts[inicio]!.antes === "|") inicio--;
  return { palabra: ts.at(-1)!.texto.trim().split(/\s+/)[0]!, trasY: ts[inicio]!.antes === "&&" };
}

/**
 * La línea partida por sus separadores de arriba: fuera de comillas, de
 * `$(…)`, `(…)`, `${…}` y de comentarios. `null` si algo no cierra.
 */
function trozos(linea: string): Trozo[] | null {
  const out: Trozo[] = [];
  const pila: string[] = [];
  let texto = "";
  let antes: string | null = null;
  const corta = (sep: string) => {
    // Un salto de línea justo después de `&&`, `||` o `|` continúa el comando.
    if (sep === "\n" && texto.trim() === "" && (antes === "&&" || antes === "||" || antes === "|")) return;
    out.push({ texto, antes });
    texto = "";
    antes = sep;
  };
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]!;
    const arriba = pila.at(-1);
    if (arriba === "'") {
      texto += c;
      if (c === "'") pila.pop();
      continue;
    }
    if (c === "\\") {
      texto += c + (linea[i + 1] ?? "");
      i++;
      continue;
    }
    if (c === "$" && (linea[i + 1] === "(" || linea[i + 1] === "{")) {
      pila.push(`$${linea[i + 1]}`);
      texto += c + linea[i + 1];
      i++;
      continue;
    }
    if (arriba === '"' || arriba === "`") {
      texto += c;
      if (c === arriba) pila.pop();
      else if (c === "`") pila.push(c);
      continue;
    }
    if (c === "#" && (texto === "" || /\s/.test(texto.at(-1)!))) {
      while (i + 1 < linea.length && linea[i + 1] !== "\n") i++;
      continue;
    }
    if (c === "'" || c === '"' || c === "`" || c === "(") {
      pila.push(c);
      texto += c;
      continue;
    }
    if (c === ")") {
      if (arriba !== "(" && arriba !== "$(") return null;
      pila.pop();
      texto += c;
      continue;
    }
    if (c === "}" && arriba === "${") {
      pila.pop();
      texto += c;
      continue;
    }
    if (pila.length > 0) {
      texto += c;
      continue;
    }
    const dos = linea.slice(i, i + 2);
    if (dos === "&&" || dos === "||") {
      corta(dos);
      i++;
    } else if (dos === "|&") {
      corta("|");
      i++;
    } else if (c === "|") {
      corta("|");
    } else if (dos === ";;") {
      return null;
    } else if (c === ";" || c === "\n") {
      corta(c);
    } else if (c === "&" && !/[<>]$/.test(texto) && linea[i + 1] !== ">") {
      corta(c);
    } else {
      texto += c;
    }
  }
  if (pila.length > 0) return null;
  out.push({ texto, antes });
  return out;
}
