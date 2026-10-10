// Lo que publicar hace con los datos (spec local 2026-10-09), en tipos que
// comparten el servidor (lib/backend/publish-migrations.ts, data-changes.ts) y
// la interfaz (el modal de publicar y la tarjeta de Len). Sin `server-only` a
// propósito.

export type DestructiveChange =
  | { readonly kind: "drop_table"; readonly table: string; readonly count: number }
  | { readonly kind: "drop_column"; readonly table: string; readonly column: string; readonly count: number }
  | { readonly kind: "alter_type"; readonly table: string; readonly column: string; readonly from: string; readonly to: string; readonly count: number }
  | { readonly kind: "delete_rows"; readonly migration: string; readonly statement: string; readonly count: number };

export type DataChangesPreview =
  | { readonly kind: "none" }
  | { readonly kind: "first_publish"; readonly migrations: string[] }
  | { readonly kind: "pending"; readonly migrations: string[]; readonly destructive: DestructiveChange[] | null }
  | { readonly kind: "failed"; readonly migration: string; readonly statement: string; readonly message: string }
  | { readonly kind: "diverged"; readonly versions: string[] };

const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === "string");

function isDestructiveChange(x: unknown): x is DestructiveChange {
  const c = x as Record<string, unknown> | null;
  if (!c || typeof c !== "object" || typeof c.count !== "number") return false;
  switch (c.kind) {
    case "drop_table":
      return typeof c.table === "string";
    case "drop_column":
      return typeof c.table === "string" && typeof c.column === "string";
    case "alter_type":
      return typeof c.table === "string" && typeof c.column === "string" && typeof c.from === "string" && typeof c.to === "string";
    case "delete_rows":
      return typeof c.migration === "string" && typeof c.statement === "string";
    default:
      return false;
  }
}

/** Lo que la tarjeta de Len pinta de un `confirm` que llega por el stream: sólo
 *  lo que tiene la forma (la primera publicación o lo pendiente); lo demás, nada. */
export function dataChangesForCard(x: unknown): DataChangesPreview | undefined {
  const p = x as Record<string, unknown> | null;
  if (!p || typeof p !== "object" || !isStrings(p.migrations)) return undefined;
  if (p.kind === "first_publish") return { kind: "first_publish", migrations: p.migrations };
  if (p.kind !== "pending") return undefined;
  if (p.destructive === null) return { kind: "pending", migrations: p.migrations, destructive: null };
  if (!Array.isArray(p.destructive) || !p.destructive.every(isDestructiveChange)) return undefined;
  return { kind: "pending", migrations: p.migrations, destructive: p.destructive };
}
