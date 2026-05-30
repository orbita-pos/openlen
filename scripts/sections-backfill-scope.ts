// One-shot repair: fragments scoped by the pre-fix scoper keyed wrapper-class
// rules (.sec / .lc07 …) as pure descendant selectors (`[data-sec] .sec`), which
// never match the root element itself — so the wrapper's background + inherited
// text color dropped (dark sections rendered black-on-black headings). This adds
// the missing root-or-self variant to every stored fragment and re-uploads.
//
// Idempotent. Run:
//   npm run sections:backfill-scope -- --dry-run
//   npm run sections:backfill-scope
import {
  listAllSectionsForAdmin,
  getSectionHtml,
  upsertSection,
} from "../lib/sections/store";
import { backfillRootSelfVariants } from "../lib/sections/scope";

// Apply the backfill to every <style> block's CSS, preserving the rest verbatim.
function backfillFragment(html: string, slug: string): string {
  return html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_full, open: string, css: string, close: string) =>
      `${open}${backfillRootSelfVariants(css, slug)}${close}`,
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
    const next = backfillFragment(html, rec.id);
    if (next === html) {
      unchanged++;
      continue;
    }

    const addedSelfVariants =
      (next.match(/\[data-sec="[^"]+"\][^\s,{>+~]/g) ?? []).length -
      (html.match(/\[data-sec="[^"]+"\][^\s,{>+~]/g) ?? []).length;

    if (dry) {
      console.log(`  would fix ${rec.id.padEnd(18)} ${rec.mode.padEnd(5)} +${addedSelfVariants} self-variants`);
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
      console.log(`  fixed ${rec.id.padEnd(18)} ${rec.mode.padEnd(5)} +${addedSelfVariants} self-variants`);
      changed++;
    } catch (err) {
      failed.push({ id: rec.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  console.log(`\nDone. ${dry ? "would-change" : "changed"}=${changed} unchanged=${unchanged} failed=${failed.length}`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`  !! ${f.id} — ${f.reason}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
