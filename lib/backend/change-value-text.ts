// HOW A COLUMN'S VALUE READS IN A CONFIRMATION — a tool's production write (option B, spec local
// 2026-11-04-herramientas-hechas-por-len, §4.4) on the web and on the phone, and «Hazlo»'s data change. The person can
// only accept what they can read: a jsonb value is JSON, never `[object Object]`; nothing is ∅. Pure, client-safe.
export function changeValueText(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
