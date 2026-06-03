// Export every PUBLISHED template's HTML from R2 to local files so the
// photo-fit workflow agents can read them. Writes:
//   .photo-export/<id>.html
//   .photo-export/_index.json  → [{ id, name, family, mode }]
// Run: npm run templates:export
import { mkdir, writeFile } from "node:fs/promises";
import { listTemplates, getTemplateHtml } from "@/lib/templates/store";

const OUT = ".photo-export";

async function main() {
  await mkdir(OUT, { recursive: true });
  const templates = await listTemplates({ status: "published" });
  console.log(`exporting ${templates.length} published templates → ${OUT}/`);

  const index: { id: string; name: string; family: string; mode: string }[] = [];
  let ok = 0;
  let missing = 0;
  for (const t of templates) {
    const html = await getTemplateHtml(t.id);
    if (!html) {
      missing++;
      console.warn(`  ⚠ no html for ${t.id}`);
      continue;
    }
    await writeFile(`${OUT}/${t.id}.html`, html, "utf8");
    index.push({ id: t.id, name: t.name, family: t.family, mode: t.mode });
    ok++;
  }
  await writeFile(`${OUT}/_index.json`, JSON.stringify(index, null, 2));

  const byFamily: Record<string, number> = {};
  for (const r of index) byFamily[r.family] = (byFamily[r.family] || 0) + 1;
  console.log(`\nexported ${ok} (missing html: ${missing})`);
  console.log("by family:", Object.entries(byFamily).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}=${n}`).join("  "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
