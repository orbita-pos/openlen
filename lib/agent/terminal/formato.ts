// lib/agent/terminal/formato.ts — LOS FORMATOS DEL `Bash` DE CLAUDE CODE (leídos
// en su binario 2.1.293, 2026-10-09; plan 04 de las apps, tarea 7): cómo dice
// un tiempo («Command timed out after 2m 0s»), un tamaño y la salida que no
// cabe (`<persisted-output>`). Puro.

/** Su `Zt`: bajo un minuto, segundos enteros; si no, `Xm Ys` (y horas y días). */
export function formatDuration(ms: number): string {
  if (ms < 60_000) {
    if (ms === 0) return "0s";
    if (ms < 1) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 1000)}s`;
  }
  let d = Math.floor(ms / 86_400_000);
  let h = Math.floor((ms % 86_400_000) / 3_600_000);
  let m = Math.floor((ms % 3_600_000) / 60_000);
  let s = Math.round((ms % 60_000) / 1000);
  if (s === 60) (s = 0), m++;
  if (m === 60) (m = 0), h++;
  if (h === 24) (h = 0), d++;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Su `formatFileSize`: `1023 bytes`, `2KB`, `45.2KB`, `2MB`. */
export function formatFileSize(n: number): string {
  const kb = n / 1024;
  if (kb < 1) return `${n} bytes`;
  if (kb < 1024) return `${kb.toFixed(1).replace(/\.0$/, "")}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1).replace(/\.0$/, "")}MB`;
  return `${(mb / 1024).toFixed(1).replace(/\.0$/, "")}GB`;
}

/** La vista previa: 2.000 caracteres, cortados en el último salto de línea si cae pasada la mitad. */
const VISTA = 2000;

/** El bloque que recibe el modelo cuando la salida se guardó entera en `path`. */
export function persistedOutput(o: { readonly path: string; readonly text: string }): string {
  const masDe = o.text.length > VISTA;
  let vista = o.text;
  if (masDe) {
    const corte = o.text.slice(0, VISTA).lastIndexOf("\n");
    vista = o.text.slice(0, corte > VISTA * 0.5 ? corte : VISTA);
  }
  return (
    `<persisted-output>\nOutput too large (${formatFileSize(o.text.length)}). Full output saved to: ${o.path}\n\n` +
    `Preview (first ${formatFileSize(VISTA)}):\n${vista}${masDe ? "\n...\n" : "\n"}</persisted-output>`
  );
}
