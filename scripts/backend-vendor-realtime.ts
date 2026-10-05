// Trae el esquema `realtime` REAL de Supabase Realtime (supabase/realtime,
// Apache-2.0) a `lib/backend/realtime/schema-dump.ts`, fijado a un commit. No
// sus 88 migraciones de Ecto (varias son su DSL, no SQL), sino el volcado que
// ellos mismos generan de ellas y cargan en cada base nueva
// (`priv/repo/tenant_db_dump_17.sql`, `Realtime.Tenants.Migrations.load_db_dump`).
// Un módulo .ts porque el build standalone de Next sólo lleva lo que se importa.
//
// Uso: npx tsx scripts/backend-vendor-realtime.ts [sha]
// Sin sha, el fijado abajo. Cambiarlo es actualizar Supabase Realtime: hay que
// volver a correr las pruebas de `lib/backend/realtime`.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = "supabase/realtime";
const PINNED_SHA = "f86df8c33ef0d014d009e4ff55e3ba18a546cb07";
const DUMP = "priv/repo/tenant_db_dump_17.sql";

async function main() {
  const sha = process.argv[2] ?? PINNED_SHA;
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/${DUMP}`);
  if (!res.ok) throw new Error(`${DUMP}: HTTP ${res.status}`);
  const sql = await res.text();
  const out = [
    "// GENERADO por scripts/backend-vendor-realtime.ts — no editar a mano.",
    `// El esquema \`realtime\` de Supabase Realtime, tal cual: https://github.com/${REPO}/blob/${sha}/${DUMP}`,
    "// Licencia Apache-2.0 (Copyright Supabase; LICENSES/supabase-realtime.Apache-2.0.txt). Lo aplica",
    "// lib/backend/realtime/schema.ts con la adaptación de roles.",
    "",
    `export const REALTIME_SHA = ${JSON.stringify(sha)};`,
    "",
    `export const REALTIME_DUMP_SQL: string = ${JSON.stringify(sql)};`,
    "",
  ].join("\n");
  const target = join(process.cwd(), "lib", "backend", "realtime", "schema-dump.ts");
  writeFileSync(target, out, "utf8");
  console.log(`${sql.length} bytes → ${target}`);

  const lic = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/LICENSE`);
  if (!lic.ok) throw new Error(`LICENSE: HTTP ${lic.status}`);
  const header = `Origen: https://github.com/${REPO}/blob/${sha}/LICENSE — usado en lib/backend/realtime/ (esquema vendido y servidor portado).\n\n`;
  writeFileSync(join(process.cwd(), "LICENSES", "supabase-realtime.Apache-2.0.txt"), header + (await lic.text()), "utf8");
}

void main();
