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
