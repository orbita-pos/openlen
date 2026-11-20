// lib/agent/terminal/formato.ts — LOS FORMATOS DEL `Bash` DE CLAUDE CODE
// (2026-10-09; plan 04 de las apps, tarea 7): cómo dice
// un tiempo («Command timed out after 2m 0s»), un tamaño y la salida que no
// cabe (`<persisted-output>`). Puro.

/** Como Claude Code: bajo un minuto, segundos enteros; si no, `Xm Ys` (y horas y días). */
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

/** La vista previa: hasta 2.000 caracteres al principio y 1.200 al final cuando se corta (Head + Tail). */
const VISTA = 2000;
const HEAD_CHARS = 1200;
const TAIL_CHARS = 1200;

/** ¿El corte en `i` caería entre las dos mitades de un par sustituto UTF-16 (un emoji)? */
function partiriaUnPar(text: string, i: number): boolean {
  if (i <= 0 || i >= text.length) return false;
  const antes = text.charCodeAt(i - 1);
  const despues = text.charCodeAt(i);
  return antes >= 0xd800 && antes <= 0xdbff && despues >= 0xdc00 && despues <= 0xdfff;
}

/**
 * El principio y el final de un texto que no cabe, cortados en un salto de línea
 * mientras eso conserve más de la mitad del principio y al menos el 40 % del
 * final. Dos cuidados de los bordes: un corte nunca cae en medio de un par sustituto (se
 * mueve un carácter hacia dentro: la mitad de un emoji llegaría al modelo como
 * un carácter roto), y un corte que ya cae justo en el principio de una línea
 * la conserva entera (buscar el siguiente salto desde ahí la tiraba).
 */
export function headAndTail(text: string, headChars: number, tailChars: number): { readonly head: string; readonly tail: string } {
  let headEnd = text.slice(0, headChars).lastIndexOf("\n");
  if (!(headEnd > headChars * 0.5)) headEnd = headChars;
  if (partiriaUnPar(text, headEnd)) headEnd -= 1;
  const head = text.slice(0, headEnd);
  const tailStartMin = Math.max(head.length, text.length - tailChars);
  // Desde el carácter ANTERIOR al corte: si es un salto, el corte está en el principio de una línea y se queda.
  const corteTail = text.indexOf("\n", Math.max(0, tailStartMin - 1));
  let tailStart =
    corteTail !== -1 && corteTail < text.length - 1 && text.length - (corteTail + 1) >= tailChars * 0.4 ? corteTail + 1 : tailStartMin;
  if (partiriaUnPar(text, tailStart)) tailStart += 1;
  return { head, tail: text.slice(tailStart) };
}

/** El bloque que recibe el modelo cuando la salida se guardó entera en `path`.
 *  Conserva principio Y final (Head + Tail) para que el error/resumen final de builds y tests
 *  quede visible sin gastar una vuelta extra leyendo `/tmp/tool-results/`. */
export function persistedOutput(o: { readonly path: string; readonly text: string }): string {
  const masDe = o.text.length > VISTA;
  if (!masDe) {
    return (
      `<persisted-output>\nOutput too large (${formatFileSize(o.text.length)}). Full output saved to: ${o.path}\n\n` +
      `Preview (first ${formatFileSize(VISTA)}):\n${o.text}\n</persisted-output>`
    );
  }
  const { head, tail } = headAndTail(o.text, HEAD_CHARS, TAIL_CHARS);
  const omitted = Math.max(0, o.text.length - head.length - tail.length);
  return (
    `<persisted-output>\nOutput too large (${formatFileSize(o.text.length)}). Full output saved to: ${o.path}\n\n` +
    `Preview (head + tail, omitted ${formatFileSize(omitted)}):\n${head}\n...\n${tail}\n</persisted-output>`
  );
}
