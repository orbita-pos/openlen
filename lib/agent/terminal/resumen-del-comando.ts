/**
 * LO QUE LA TARJETA DEL CHAT ENSEÑA DE UN COMANDO (la #5 de
 * plans/len-agente-2026/notas/fase-5-taller.md): una línea, como mucho 60.
 *
 * Es también la ÚNICA huella del comando que se guarda en la tarjeta
 * (`action.summary`), así que el chat la usa para casar cada tarjeta con su
 * salida (`lib/workspace-v2/salida-de-la-tarjeta.ts`). Una sola función para las
 * dos cosas: si se escribieran aparte, dejarían de casar en silencio.
 *
 * Puro y sin imports: lo usan el servidor (la herramienta y el bucle) y el
 * navegador.
 */

export const MAX_RESUMEN_DEL_COMANDO = 60;

export function resumenDelComando(command: string): string {
  const una = command.replace(/\s+/g, " ").trim();
  return una.length > MAX_RESUMEN_DEL_COMANDO ? `${una.slice(0, MAX_RESUMEN_DEL_COMANDO)}…` : una;
}
