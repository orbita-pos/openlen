// Trae las migraciones REALES del esquema `auth` de GoTrue (supabase/auth, MIT)
// a `lib/backend/sql/gotrue-migrations.ts`, fijadas a un commit.
//
// Por qué un módulo .ts y no los .sql sueltos: el build standalone de Next sólo
// lleva lo que se importa; un `readFileSync` de `lib/…/*.sql` no viajaría.
//
// Uso: npx tsx scripts/backend-vendor-gotrue.ts [sha]
// Sin sha, el fijado abajo. Cambiarlo es actualizar GoTrue: hay que volver a
// correr las pruebas de `lib/backend`.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = "supabase/auth";
const PINNED_SHA = "ce9a8eee0cc042be8c7a42981a7ddae631e41d91";

async function main() {
  const sha = process.argv[2] ?? PINNED_SHA;
  const list = (await (
    await fetch(`https://api.github.com/repos/${REPO}/contents/migrations?ref=${sha}`, {
      headers: { "user-agent": "openlen-vendor" },
    })
  ).json()) as { name: string }[];
  const names = list.map((f) => f.name).filter((n) => n.endsWith(".up.sql")).sort();
  const migrations: { version: string; name: string; sql: string }[] = [];
  for (const name of names) {
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/migrations/${name}`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    migrations.push({ version: name.split("_")[0]!, name, sql: await res.text() });
  }
  const out = [
    "// GENERADO por scripts/backend-vendor-gotrue.ts — no editar a mano.",
    `// Las migraciones del esquema \`auth\` de GoTrue, tal cual: https://github.com/${REPO}/tree/${sha}/migrations`,
    "// Licencia MIT (Copyright (c) 2021-2025 Supabase <support@supabase.com>). `{{ index .Options \"Namespace\" }}` es el",
    "// esquema donde se aplican; lo sustituye lib/backend/schema.ts.",
    "",
    `export const GOTRUE_SHA = ${JSON.stringify(sha)};`,
    "",
    "export const GOTRUE_MIGRATIONS: ReadonlyArray<{ readonly version: string; readonly name: string; readonly sql: string }> = " +
      JSON.stringify(migrations, null, 1) +
      ";",
    "",
  ].join("\n");
  const target = join(process.cwd(), "lib", "backend", "sql", "gotrue-migrations.ts");
  writeFileSync(target, out, "utf8");
  console.log(`${migrations.length} migraciones → ${target}`);
}

void main();
