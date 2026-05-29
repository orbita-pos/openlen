// Bulk-ingest a directory of generated section HTMLs into the section library.
// Reads the OpenLen "library" folder convention (one subfolder per section
// type — see FOLDERS below), scopes each file to a host-safe fragment, and
// upserts it into the DB + object storage. Idempotent (same input → same hash
// → same row).
//
// Run:
//   npm run sections:seed -- "C:\path\to\library"
//
// Validates each scoped fragment against the same Zod schema as the (future)
// admin path before dispatching to upsertSection().

import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  CreateSectionSchema,
  htmlContainsEditorMarker,
} from "../lib/sections/admin-schemas";
import { scopeSectionDocument } from "../lib/sections/scope";
import { upsertSection } from "../lib/sections/store";
import { SECTION_TYPE_META, type SectionType } from "../lib/sections/types";

// type → folder relative to the library root. `match` (hero only) filters
// top-level files, since the root also contains the other type subfolders.
const FOLDERS: { type: SectionType; rel: string; match?: RegExp }[] = [
  { type: "hero", rel: ".", match: /hero/i },
  { type: "pricing", rel: "library2/pricing" },
  { type: "features", rel: "library3" },
  { type: "testimonials", rel: "library4/testimonials" },
  { type: "faq", rel: "library5/faq" },
  { type: "cta", rel: "library6" },
  { type: "logos", rel: "library7" },
  { type: "footer", rel: "library8" },
  { type: "navbar", rel: "library9/navbars" },
  { type: "stats", rel: "library10/stats" },
  { type: "how-it-works", rel: "library11/how-it-works" },
  { type: "contact", rel: "library12/sections" },
  { type: "about", rel: "library13" },
  { type: "team", rel: "library14" },
  { type: "comparison", rel: "library15/comparison-sections" },
  { type: "integrations", rel: "library16" },
  { type: "gallery", rel: "library17" },
];

function parseVariant(file: string, type: SectionType): { idx: number; label: string } {
  const base = basename(file, ".html");
  const numMatch = /\b(?:variant|v)\s*[-_]?\s*0*(\d+)/i.exec(base);
  const idx = numMatch ? parseInt(numMatch[1], 10) : 0;

  let label = base
    .replace(/\b(?:variant|v)\s*[-_]?\s*0*\d+\b/i, " ") // drop the vNN token
    .replace(new RegExp(`\\b${escapeReg(type)}\\b`, "ig"), " ") // drop the type word
    .replace(/\bsections?\b/gi, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  label = label
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .trim();
  if (!label) label = `Variant ${idx || ""}`.trim();
  return { idx, label };
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function listHtml(dir: string, match?: RegExp): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".html"))
    .map((e) => e.name)
    .filter((n) => (match ? match.test(n) : true))
    .sort();
}

async function main() {
  const root = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!root) {
    console.error('Usage: npm run sections:seed -- "<library root dir>"');
    process.exit(2);
  }
  const rootAbs = resolve(root);
  console.log(`Seeding sections from ${rootAbs}\n`);

  let ok = 0;
  const seenSlugs = new Set<string>();
  const failed: { file: string; reason: string }[] = [];

  for (const folder of FOLDERS) {
    const dir = folder.rel === "." ? rootAbs : join(rootAbs, ...folder.rel.split("/"));
    const files = await listHtml(dir, folder.match);
    if (files.length === 0) {
      console.log(`  --  ${folder.type.padEnd(13)} (no files in ${folder.rel})`);
      continue;
    }

    let counter = 0;
    for (const file of files) {
      counter++;
      const { idx, label } = parseVariant(file, folder.type);
      const n = idx > 0 ? idx : counter;
      let slug = `${folder.type}-${String(n).padStart(2, "0")}`;
      while (seenSlugs.has(slug)) slug = `${slug}x`; // dedupe guard
      seenSlugs.add(slug);

      const abs = join(dir, file);
      try {
        const raw = await readFile(abs, "utf8");
        if (!raw.trim()) {
          failed.push({ file, reason: "empty file" });
          continue;
        }
        const scoped = scopeSectionDocument(raw, slug);
        const payload = {
          id: slug,
          type: folder.type,
          name: `${SECTION_TYPE_META[folder.type].label} — ${label}`,
          variantLabel: label,
          rootTag: scoped.rootTag,
          mode: "light" as const,
          html: scoped.html,
          designTokens: scoped.designTokens,
          fonts: scoped.fonts,
          needsJs: scoped.needsJs,
          hasPlaceholders: folder.type === "gallery",
          status: "published" as const,
        };

        const parsed = CreateSectionSchema.safeParse(payload);
        if (!parsed.success) {
          failed.push({ file, reason: `validation: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` });
          continue;
        }
        if (htmlContainsEditorMarker(parsed.data.html)) {
          failed.push({ file, reason: "contains data-slot-path marker" });
          continue;
        }

        const rec = await upsertSection(parsed.data);
        console.log(
          `  ok  ${slug.padEnd(18)} ${rec.rootTag.padEnd(7)} ${rec.size}b` +
            `${rec.needsJs ? " [js]" : ""}${rec.hasPlaceholders ? " [ph]" : ""}`,
        );
        ok++;
      } catch (err) {
        failed.push({ file, reason: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  console.log(`\nDone. seeded=${ok} failed=${failed.length}`);
  if (failed.length > 0) {
    console.log("\nFailures:");
    for (const f of failed) console.log(`  ${f.file} — ${f.reason}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
