// lib/apps/code-frame.ts — EL TROZO DE CÓDIGO DE UN ERROR, como lo enseña la
// capa de Vite (es el `codeFrame` de Babel): dos líneas antes, tres después,
// `>` en la del error y `^` bajo su columna. Lo usa la capa de error del lienzo
// (`error-overlay.ts`). Puro.

const ANTES = 2;
const DESPUES = 3;

/** `linea` y `columna` desde 1. `null` si la línea no está en el fuente. */
export function codeFrame(source: string, line: number, column: number | null): string | null {
  const lineas = source.split(/\r?\n/);
  if (line < 1 || line > lineas.length) return null;
  const desde = Math.max(1, line - ANTES);
  const hasta = Math.min(lineas.length, line + DESPUES);
  const ancho = String(hasta).length;
  const salida: string[] = [];
  for (let n = desde; n <= hasta; n++) {
    const numero = String(n).padStart(ancho);
    const texto = lineas[n - 1]!;
    salida.push(`${n === line ? ">" : " "} ${numero} |${texto ? ` ${texto}` : ""}`);
    if (n === line && column !== null && column >= 1) salida.push(`  ${" ".repeat(ancho)} | ${" ".repeat(column - 1)}^`);
  }
  return salida.join("\n");
}
