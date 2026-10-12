// lib/functions/invocation-report.ts — LAS LLAMADAS A LAS FUNCIONES DURANTE UNA
// VISITA DE LOS OJOS (`use_page`, `view_page`), en el texto que lee Len (spec
// local 2026-10-11, Parte 1): cada una con su estado, su error ya traducido a
// SU fichero y línea, y sus registros (ya tapados por la puerta). En inglés:
// lo lee Len. Puro.

import type { InvocationRecord } from "./gateway";

const MAX_LLAMADAS = 10;
const MAX_REGISTROS = 5;
const MAX_LINEAS_DE_ERROR = 4;

export function functionCallsReport(calls: readonly InvocationRecord[]): string | null {
  if (calls.length === 0) return null;
  const lineas = ["Edge Function calls during this visit (draft):"];
  if (calls.length > MAX_LLAMADAS) lineas.push(`(${calls.length - MAX_LLAMADAS} earlier calls not shown)`);
  for (const c of calls.slice(-MAX_LLAMADAS)) {
    lineas.push(`- ${c.name} → ${c.errorCode ? `${c.status} ${c.errorCode}` : c.status} (${c.ms} ms)`);
    if (c.error) lineas.push(`  error: ${c.error.split("\n").slice(0, MAX_LINEAS_DE_ERROR).join("\n  ")}`);
    for (const l of c.logs.slice(0, MAX_REGISTROS)) lineas.push(`  ${l.level}: ${l.msg.slice(0, 300)}`);
  }
  return lineas.join("\n");
}
