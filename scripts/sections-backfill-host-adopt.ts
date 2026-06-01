// One-shot repair: stored section fragments were authored as standalone docs —
// each carries its OWN palette (`[data-sec]{--surface;--ink;--accent}`), a
// full-bleed page-gutter background + 100vh "preview shell" on the root, and a
// page-level sticky header. Dropped into a contrasting page they clash: a light
// section stays light on a dark page, the shell adds a tall white block at the
// bottom, and the sticky bar fights the host navbar. applyHostAdoption
// (lib/sections/scope.ts) remaps the section's surface/text tokens to the host's
// (--bg/--fg/--fg-dim/--border), neutralizes the shell on the root, and adds a
// utility shim so bespoke classes (bg-surface/text-ink/…) resolve host-aware.
//
// Idempotent (the marker comment + value guards make re-runs no-ops). Run:
//   npm run sections:backfill-host-adopt -- --dry-run
//   npm run sections:backfill-host-adopt
import {
  listAllSectionsForAdmin,
  getSectionHtml,
  upsertSection,
} from "../lib/sections/store";
import { applyHostAdoption } from "../lib/sections/scope";

// Apply host-adoption to every <style> block's CSS, preserving the rest verbatim.
function adoptFragment(html: string, slug: string): string {
  return html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_full, open: string, css: string, close: string) =>
      `${open}${applyHostAdoption(css, slug)}${close}`,
  );
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const recs = await listAllSectionsForAdmin();
  console.log(`Scanning ${recs.length} sections${dry ? " [DRY RUN]" : ""}\n`);

  let changed = 0;
  let unchanged = 0;
  const failed: { id: string; reason: string }[] = [];

  for (const rec of recs) {
    const html = await getSectionHtml(rec.id);
    if (html === null) {
      failed.push({ id: rec.id, reason: "no stored HTML" });
      continue;
    }
    const next = adoptFragment(html, rec.id);
    if (next === html) {
      unchanged++;
      continue;
    }

    if (dry) {
      console.log(`  would adopt ${rec.id.padEnd(18)} ${rec.mode.padEnd(5)}`);
      changed++;
      continue;
    }

    try {
      await upsertSection({
        id: rec.id,
        type: rec.type,
        name: rec.name,
        variantLabel: rec.variantLabel,
        rootTag: rec.rootTag,
        mode: rec.mode,
        html: next,
        designTokens: rec.designTokens ?? undefined,
        fonts: rec.fonts ?? undefined,
        needsJs: rec.needsJs,
        hasPlaceholders: rec.hasPlaceholders,
        status: rec.status,
      });
      console.log(`  adopted ${rec.id.padEnd(18)} ${rec.mode.padEnd(5)}`);
      changed++;
    } catch (err) {
      failed.push({ id: rec.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  console.log(
    `\nDone. ${dry ? "would-change" : "changed"}=${changed} unchanged=${unchanged} failed=${failed.length}`,
  );
  if (failed.length > 0) {
    for (const f of failed) console.log(`  !! ${f.id} — ${f.reason}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
