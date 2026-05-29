// Editor V5 hardening — corpus fetcher.
//
// Pulls every PUBLISHED curated template + section body from object storage
// (R2 in prod, reachable read-only via the public templates host) and writes
// them to tests/visual/corpus/{templates,sections}/<id>.html plus a manifest.
// These are the REAL Gemini/Claude-generated bodies the editor must handle in
// production — a far larger, more representative sample than synthetic fixtures.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json \
//     scripts/editor-v5/fetch-corpus.ts
//
// Network only touches the public storage URLs already exposed to every visitor
// (the live preview iframe loads the same bodies); the DB read is the published
// list. Idempotent — re-running overwrites the local corpus.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { listTemplates } from "@/lib/templates/store";
import { listSections } from "@/lib/sections/store";

const OUT = join(process.cwd(), "tests", "visual", "corpus");

interface ManifestEntry {
  id: string;
  kind: "template" | "section";
  group: string; // family (template) | type (section)
  mode: string;
  accent?: string;
  rootTag?: string;
  needsJs?: boolean;
  hasPlaceholders?: boolean;
  storageUrl: string;
  bytes: number;
  file: string; // relative path under corpus/
}

async function fetchWithRetry(url: string, tries = 4): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw new Error(`fetch failed after ${tries}: ${url} :: ${String(lastErr)}`);
}

// Bounded-concurrency map (no external dep).
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function main() {
  await mkdir(join(OUT, "templates"), { recursive: true });
  await mkdir(join(OUT, "sections"), { recursive: true });

  const [templates, sections] = await Promise.all([
    listTemplates(),
    listSections(),
  ]);
  console.log(`DB: ${templates.length} templates, ${sections.length} sections`);

  const manifest: ManifestEntry[] = [];
  let failed = 0;

  await mapLimit(templates, 8, async (t) => {
    try {
      const html = await fetchWithRetry(t.storageUrl);
      const file = join("templates", `${t.id}.html`);
      await writeFile(join(OUT, file), html, "utf8");
      manifest.push({
        id: t.id,
        kind: "template",
        group: t.family,
        mode: t.mode,
        accent: t.accent,
        storageUrl: t.storageUrl,
        bytes: Buffer.byteLength(html),
        file: file.replace(/\\/g, "/"),
      });
    } catch (e) {
      failed++;
      console.warn(`  ✗ template ${t.id}: ${String(e)}`);
    }
  });

  await mapLimit(sections, 8, async (s) => {
    try {
      const html = await fetchWithRetry(s.storageUrl);
      const file = join("sections", `${s.id}.html`);
      await writeFile(join(OUT, file), html, "utf8");
      manifest.push({
        id: s.id,
        kind: "section",
        group: s.type,
        mode: s.mode,
        rootTag: s.rootTag,
        needsJs: s.needsJs,
        hasPlaceholders: s.hasPlaceholders,
        storageUrl: s.storageUrl,
        bytes: Buffer.byteLength(html),
        file: file.replace(/\\/g, "/"),
      });
    } catch (e) {
      failed++;
      console.warn(`  ✗ section ${s.id}: ${String(e)}`);
    }
  });

  manifest.sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id));
  await writeFile(
    join(OUT, "manifest.json"),
    JSON.stringify(
      {
        generatedFrom: "prod DB + public storage",
        templates: manifest.filter((m) => m.kind === "template").length,
        sections: manifest.filter((m) => m.kind === "section").length,
        failed,
        entries: manifest,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(
    `Wrote ${manifest.length} bodies to ${OUT} (${failed} failed). manifest.json updated.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
