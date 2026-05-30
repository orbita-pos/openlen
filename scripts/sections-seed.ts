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
import {
  SECTION_TYPES,
  SECTION_TYPE_META,
  type SectionType,
} from "../lib/sections/types";

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

// Recursively collect .html files under dir, skipping screenshot/asset dirs
// (the claude.ai download folders carry a screenshots/ sibling).
async function listHtmlRec(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      if (/^(screenshots?|assets|images?|img|thumbs?)$/i.test(e.name)) continue;
      out.push(...(await listHtmlRec(join(dir, e.name))));
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".html")) {
      out.push(join(dir, e.name));
    }
  }
  return out.sort();
}

// Section types in gallery order — position i (1-based) ↔ folder "section{i}".
const ORDERED_TYPES = [...SECTION_TYPES].sort(
  (a, b) => SECTION_TYPE_META[a].order - SECTION_TYPE_META[b].order,
);

type Group = { type: SectionType; files: string[] };

// Numbered layout: a root holding section1/ … sectionN/ subfolders (one per
// ordered type, variants possibly nested in a variants/ subfolder). Maps
// section1 → ORDERED_TYPES[0], section2 → [1], … Returns null when absent so
// the caller falls back to the legacy FOLDERS map.
async function detectNumbered(rootAbs: string): Promise<Group[] | null> {
  let entries;
  try {
    entries = await readdir(rootAbs, { withFileTypes: true });
  } catch {
    return null;
  }
  const nums = entries
    .filter((e) => e.isDirectory() && /^section\d+$/i.test(e.name))
    .map((e) => ({ name: e.name, n: parseInt(e.name.replace(/\D/g, ""), 10) }))
    .sort((a, b) => a.n - b.n);
  if (nums.length === 0) return null;

  const groups: Group[] = [];
  for (const { name, n } of nums) {
    const type = ORDERED_TYPES[n - 1];
    if (!type) {
      console.warn(`  !!  ${name}: no section type at position ${n} (have ${ORDERED_TYPES.length}) — skipped`);
      continue;
    }
    groups.push({ type, files: await listHtmlRec(join(rootAbs, name)) });
  }
  return groups;
}

// Infer the section's mode from its variant label (the filenames encode it,
// e.g. "Variant 08 - Cream Premium"); default light when no keyword.
function modeOf(label: string): "dark" | "light" | "cream" {
  const s = label.toLowerCase();
  if (/\bdark\b/.test(s)) return "dark";
  if (/\bcream\b/.test(s)) return "cream";
  return "light";
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const root = args.find((a) => !a.startsWith("--"));
  if (!root) {
    console.error('Usage: npm run sections:seed -- "<library root dir>" [--dry-run]');
    process.exit(2);
  }
  const rootAbs = resolve(root);

  // Two layouts: numbered (section1..N/, one per ordered type) or the legacy
  // FOLDERS map. Numbered wins when present.
  const numbered = await detectNumbered(rootAbs);
  let groups: Group[];
  if (numbered) {
    groups = numbered;
  } else {
    groups = [];
    for (const folder of FOLDERS) {
      const dir = folder.rel === "." ? rootAbs : join(rootAbs, ...folder.rel.split("/"));
      const names = await listHtml(dir, folder.match);
      groups.push({ type: folder.type, files: names.map((n) => join(dir, n)) });
    }
  }

  console.log(
    `Seeding sections from ${rootAbs} (${numbered ? "numbered" : "legacy"} layout)` +
      `${dry ? " [DRY RUN — no DB writes]" : ""}\n`,
  );

  let ok = 0;
  const seenSlugs = new Set<string>();
  const failed: { file: string; reason: string }[] = [];

  for (const { type, files } of groups) {
    if (files.length === 0) {
      console.log(`  --  ${type.padEnd(13)} (no files)`);
      continue;
    }

    let counter = 0;
    for (const abs of files) {
      counter++;
      const file = basename(abs);
      const { idx, label } = parseVariant(file, type);
      const n = idx > 0 ? idx : counter;
      let slug = `${type}-${String(n).padStart(2, "0")}`;
      while (seenSlugs.has(slug)) slug = `${slug}x`; // dedupe guard
      seenSlugs.add(slug);

      try {
        const raw = await readFile(abs, "utf8");
        if (!raw.trim()) {
          failed.push({ file, reason: "empty file" });
          continue;
        }
        const scoped = scopeSectionDocument(raw, slug);
        const payload = {
          id: slug,
          type,
          name: `${SECTION_TYPE_META[type].label} — ${label}`,
          variantLabel: label,
          rootTag: scoped.rootTag,
          mode: modeOf(label),
          html: scoped.html,
          designTokens: scoped.designTokens,
          fonts: scoped.fonts,
          needsJs: scoped.needsJs,
          hasPlaceholders: type === "gallery",
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

        if (dry) {
          console.log(
            `  dry ${slug.padEnd(18)} ${scoped.rootTag.padEnd(7)} ${parsed.data.html.length}b` +
              ` ${payload.mode.padEnd(5)}${scoped.needsJs ? " [js]" : ""}`,
          );
          ok++;
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

  console.log(`\nDone. ${dry ? "validated" : "seeded"}=${ok} failed=${failed.length}`);
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
