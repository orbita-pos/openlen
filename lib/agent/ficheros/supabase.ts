/**
 * LOS FICHEROS DE SUPABASE DEL PROYECTO (plans/pages-backend/design.md): las
 * migraciones de su backend, en `/supabase/migrations/<AAAAMMDDHHMMSS>_<nombre>.sql`,
 * como en cualquier proyecto con la CLI de Supabase. Len los escribe con Write,
 * Edit o la terminal, y los aplica con `supabase db push`.
 *
 * Viven en `projectFiles` (no en `project.data`): no son páginas, no se
 * publican, y no pasan por la puerta de la página.
 *
 * Sin imports: lo prueba vitest sin base.
 */

export const CARPETA_SUPABASE = "/supabase";

/** Lo que cabe en un fichero, y cuántos puede haber. Una migración de verdad
 *  ocupa unos pocos KB. */
export const MAX_BYTES_FICHERO_SUPABASE = 256 * 1024;
export const MAX_FICHEROS_SUPABASE = 200;

/** `/supabase/...` con nombres de fichero normales (letras, dígitos, `_`, `-`, `.`). */
export function esFicheroDeSupabase(ruta: string): boolean {
  if (!/^\/supabase\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(ruta)) return false;
  return !ruta.split("/").some((p) => p === "." || p === "..");
}

/** Lo que se le dice a quien intenta guardar algo que no cabe. `null` = cabe. */
export function motivoParaNoGuardar(ruta: string, contenido: string, existentes: number, crea: boolean): string | null {
  if (!esFicheroDeSupabase(ruta)) return `${ruta} is not a Supabase project file (they live under /supabase/).`;
  if (Buffer.byteLength(contenido, "utf8") > MAX_BYTES_FICHERO_SUPABASE) {
    return `${ruta} is larger than ${MAX_BYTES_FICHERO_SUPABASE / 1024} KB.`;
  }
  if (crea && existentes >= MAX_FICHEROS_SUPABASE) return `the project already has ${MAX_FICHEROS_SUPABASE} files under /supabase/.`;
  return null;
}
