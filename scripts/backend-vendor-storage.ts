// Trae las migraciones REALES del esquema `storage` de Supabase Storage
// (supabase/storage, Apache-2.0) a `lib/backend/storage/migrations.ts`, fijadas
// a un commit. Como scripts/backend-vendor-gotrue.ts: un módulo .ts porque el
// build standalone de Next sólo lleva lo que se importa.
//
// `id` y `name` salen del nombre del fichero como en `postgres-migrations`, el
// corredor que usa Supabase (`0001-initialmigration.sql` → 1, "initialmigration";
// `00010-search-files-search-function.sql` → 10). Se guarda `fileName` porque su
// `hash` es sha1(fileName + sql) (dist/migration-file.js).
//
// Uso: npx tsx scripts/backend-vendor-storage.ts [sha]
// Sin sha, el fijado abajo. Cambiarlo es actualizar Supabase Storage: hay que
// volver a correr las pruebas de `lib/backend/storage`.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = "supabase/storage";
const PINNED_SHA = "eccef5e70a67fb4030e0646e5e22602c94f568bc";

async function main() {
  const sha = process.argv[2] ?? PINNED_SHA;
  const list = (await (
    await fetch(`https://api.github.com/repos/${REPO}/contents/migrations/tenant?ref=${sha}`, {
      headers: { "user-agent": "openlen-vendor" },
    })
  ).json()) as { name: string }[];
  const files = list
    .map((f) => f.name)
    .filter((n) => n.endsWith(".sql"))
    .map((fileName) => {
      const m = /^(\d+)[-_]?(.*)\.sql$/.exec(fileName);
      if (!m) throw new Error(`nombre inesperado: ${fileName}`);
      return { fileName, id: parseInt(m[1]!, 10), name: m[2]! };
    })
    .sort((a, b) => a.id - b.id);
  const migrations: { id: number; name: string; fileName: string; sql: string }[] = [];
  for (const f of files) {
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/migrations/tenant/${f.fileName}`);
    if (!res.ok) throw new Error(`${f.fileName}: HTTP ${res.status}`);
    migrations.push({ id: f.id, name: f.name, fileName: f.fileName, sql: await res.text() });
  }
  const out = [
    "// GENERADO por scripts/backend-vendor-storage.ts — no editar a mano.",
    `// Las migraciones del esquema \`storage\` de Supabase Storage, tal cual: https://github.com/${REPO}/tree/${sha}/migrations/tenant`,
    "// Licencia Apache-2.0 (Copyright Supabase; LICENSES/supabase-storage.Apache-2.0.txt). Las aplica",
    "// lib/backend/storage/schema.ts con las directivas de su corredor.",
    "",
    `export const STORAGE_SHA = ${JSON.stringify(sha)};`,
    "",
    "export const STORAGE_MIGRATIONS: ReadonlyArray<{ readonly id: number; readonly name: string; readonly fileName: string; readonly sql: string }> = " +
      JSON.stringify(migrations, null, 1) +
      ";",
    "",
  ].join("\n");
  const target = join(process.cwd(), "lib", "backend", "storage", "migrations.ts");
  writeFileSync(target, out, "utf8");
  console.log(`${migrations.length} migraciones → ${target}`);
}

void main();
