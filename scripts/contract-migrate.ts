// Codemod: migrate the existing template library to the canonical
// OpenLen contract TOKEN VOCABULARY (docs/openlen-contract.md).
//
// This is a pure NAME RENAME (e.g. --ink→--fg, --hair→--border, --bg-2→--surface)
// — SAFE because it rewrites BOTH the token definition and every var() usage in
// the same self-contained document; values are untouched. This is the rename
// the research/HOST_VAR_ALIASES described, NOT the value-swap that "nunca salió
// bien". It does NOT tokenize hardcoded hex (that needs semantic judgment) — the
// linter still flags those as a separate follow-up.
//
//   npm run contract:migrate -- --dry-run             # report only (DEFAULT-SAFE)
//   npm run contract:migrate -- --dry-run --limit=5   # first N per kind
//   npm run contract:migrate -- --apply               # RE-UPLOADS to R2 + DB
//
// Reads HTML from storage (R2 in prod / FS in dev). --apply MUTATES the live
// library — run a --dry-run first and review. Re-lints each ingredient after the
// rename and prints the remaining violation tally (mostly hardcoded-hex).

import {
  listAllForAdmin,
  getTemplateHtml,
  upsertTemplate,
} from "../lib/templates/store";
import { lintContract, type ContractKind } from "../lib/contract/lint";

// old dialect token → canonical. Longest/most-specific keys first.
const RENAME: [string, string][] = [
  ["--ink-soft", "--fg-muted"],
  ["--ink-2", "--fg-muted"],
  ["--ink-3", "--fg-faint"],
  ["--fg-dim", "--fg-muted"],
  ["--rule-soft", "--border"],
  ["--hair-2", "--border-strong"],
  ["--bg-2", "--surface"],
  ["--paper", "--surface"],
  ["--muted", "--fg-muted"],
  ["--hair", "--border"],
  ["--rule", "--border"],
  ["--line", "--border"],
  ["--ink", "--fg"],
];

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renameTokens(html: string): { next: string; renames: number } {
  let next = html;
  let renames = 0;
  for (const [from, to] of RENAME) {
    // full custom-property name only — no [\w-] may follow, so --ink does NOT
    // match inside --ink-soft / --ink-2 (those have their own mappings).
    const re = new RegExp(escapeReg(from) + "(?![\\w-])", "g");
    next = next.replace(re, () => {
      renames++;
      return to;
    });
  }
  return { next, renames };
}

function lintTally(html: string, kind: ContractKind): string {
  const res = lintContract(html, { kind });
  const e = res.violations.filter((v) => v.level === "error").length;
  return `${e}e/${res.violations.length - e}w`;
}

function parseLimit(args: string[]): number {
  const a = args.find((x) => x.startsWith("--limit="))?.slice("--limit=".length);
  const n = a ? parseInt(a, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dry = !apply; // dry-run is the default; only --apply mutates
  const onlyTemplates = args.includes("--templates");
  const doTemplates = true;
  const limit = parseLimit(args);

  console.log(
    `Contract token migration — ${apply ? "APPLY (re-uploads to R2 + DB!)" : "DRY RUN (no writes)"}` +
      `${limit !== Infinity ? ` [limit ${limit}/kind]` : ""}\n`,
  );

  let changed = 0;
  let unchanged = 0;
  const failed: { id: string; reason: string }[] = [];

  if (doTemplates) {
    const recs = (await listAllForAdmin()).slice(0, limit);
    console.log(`Templates (${recs.length}):`);
    for (const rec of recs) {
      const html = await getTemplateHtml(rec.id);
      if (html === null) {
        failed.push({ id: rec.id, reason: "no stored HTML (storage unreachable?)" });
        continue;
      }
      const { next, renames } = renameTokens(html);
      if (renames === 0) {
        unchanged++;
        continue;
      }
      console.log(
        `  ${dry ? "would " : "migrate"} ${rec.id.padEnd(24)} ${String(renames).padStart(4)} renames → lint ${lintTally(next, "document")}`,
      );
      changed++;
      if (apply) {
        try {
          await upsertTemplate({
            id: rec.id,
            name: rec.name,
            family: rec.family,
            accent: rec.accent,
            pitch: rec.pitch,
            description: rec.description,
            mode: rec.mode,
            html: next,
            status: rec.status,
          });
        } catch (err) {
          failed.push({ id: rec.id, reason: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  }

  console.log(
    `\nDone. ${dry ? "would-change" : "changed"}=${changed} unchanged=${unchanged} failed=${failed.length}`,
  );
  if (failed.length > 0) {
    for (const f of failed.slice(0, 30)) console.log(`  !! ${f.id} — ${f.reason}`);
    if (failed.length > 30) console.log(`  …and ${failed.length - 30} more`);
    if (!dry) process.exit(1);
  }
  if (dry) {
    console.log(
      "\nDRY RUN — nothing written. Review the renames, then re-run with --apply " +
        "(re-uploads to R2 + DB). Hardcoded-hex errors remain a separate pass.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
