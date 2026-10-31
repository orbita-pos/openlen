// One line for what a publish gate (428) sent back: a finding, a destructive migration, a missing secret… Shared by
// Gestión → Publicar and its Len Watch block.
export function textoDelDetalle(valor: unknown): string {
  if (typeof valor === "string") return valor;
  if (!valor || typeof valor !== "object") return "";
  const d = valor as Record<string, unknown>;
  const campos = [d.description || d.kind || d.category, d.table, d.column, d.count, d.from, d.to, d.migration, d.statement, d.file, d.line, d.exploitScenario, d.recommendation];
  if (d.params && typeof d.params === "object") campos.push(...Object.entries(d.params).map(([k,v]) => `${k}: ${String(v)}`));
  return campos.filter(v => v !== undefined && v !== null && v !== "").map(String).join(" · ");
}
