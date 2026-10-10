// lib/apps/checker/format.mjs — la salida de `tsc` y de `eslint` como la
// imprimen ellos (plan 03). Aparte de `checker-core.mjs` para que el hilo de la
// app (la terminal de Len) formatee sin cargar TypeScript ni ESLint.

/** Como `tsc --noEmit` sin TTY: una línea por error, sin resumen. */
export function formatTsc(ds) {
  return ds.map((d) => `${d.ruta.slice(1)}(${d.linea},${d.columna}): error ${d.codigo}: ${d.mensaje}\n`).join("");
}

/** Como el formateador `stylish` de ESLint (no se exporta: se reproduce). */
export function formatStylish(ds) {
  if (ds.length === 0) return "";
  const porFichero = new Map();
  for (const d of ds) porFichero.set(d.ruta, [...(porFichero.get(d.ruta) ?? []), d]);
  let s = "";
  for (const [ruta, lista] of porFichero) {
    s += `\n${ruta}\n`;
    for (const d of lista) {
      s += `  ${`${d.linea}:${d.columna}`.padEnd(6)} ${(d.gravedad === "Error" ? "error" : "warning").padEnd(7)}  ${d.mensaje}  ${d.codigo}\n`;
    }
  }
  const errores = ds.filter((d) => d.gravedad === "Error").length;
  const avisos = ds.length - errores;
  const plural = (n, p) => `${n} ${p}${n === 1 ? "" : "s"}`;
  return `${s}\n✖ ${plural(ds.length, "problem")} (${plural(errores, "error")}, ${plural(avisos, "warning")})\n`;
}
