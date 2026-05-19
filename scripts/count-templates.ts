// Quick dev tool: count templates by family. Used to verify uploads.
import { db, schema } from "../lib/db";

async function main() {
  const rows = await db
    .select({ id: schema.templates.id, family: schema.templates.family })
    .from(schema.templates);
  const fams: Record<string, string[]> = {};
  for (const r of rows) (fams[r.family] ??= []).push(r.id);
  console.log(`TOTAL: ${rows.length}\n`);
  for (const f of Object.keys(fams).sort()) {
    console.log(`${f.padEnd(20)} (${fams[f].length}): ${fams[f].join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
