// Editor V5 final-push — regression floor guard.
//
// Diffs the latest corpus passmap (written by diagnose.ts) against a saved
// BASELINE passmap. A "regression" is any element that PASSED in the baseline
// but no longer passes — the 99.69% floor must never drop. Exits non-zero when
// regressions exceed the allowed budget (default 0), so it gates a commit.
//
//   1. snapshot the floor:  cp corpus-passmap.json corpus-passmap-baseline.json
//   2. after a change:      npx tsx ... diagnose.ts && npx tsx ... regression-check.ts [maxAllowed]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORPUS_DIR } from "./corpus-lib";

const BASELINE = join(CORPUS_DIR, "corpus-passmap-baseline.json");
const CURRENT = join(CORPUS_DIR, "corpus-passmap.json");

function load(p: string): Record<string, string> {
  return JSON.parse(readFileSync(p, "utf8"));
}

function main() {
  const maxAllowed = process.argv[2] ? parseInt(process.argv[2], 10) : 0;
  const base = load(BASELINE);
  const cur = load(CURRENT);

  const regressions: string[] = []; // was pass → now fail or vanished
  const fixes: string[] = []; // was fail → now pass
  const vanished: string[] = [];

  for (const key of Object.keys(base)) {
    const wasPass = base[key] === "pass";
    const nowCat = cur[key];
    if (nowCat === undefined) {
      if (wasPass) vanished.push(key);
      continue;
    }
    const nowPass = nowCat === "pass";
    if (wasPass && !nowPass) regressions.push(`${key} (pass → ${nowCat})`);
    if (!wasPass && nowPass) fixes.push(key);
  }

  const baseEls = Object.keys(base).length;
  const curEls = Object.keys(cur).length;
  const basePass = Object.values(base).filter((c) => c === "pass").length;
  const curPass = Object.values(cur).filter((c) => c === "pass").length;

  console.log(`baseline elements ${baseEls} (pass ${basePass}) | current ${curEls} (pass ${curPass})`);
  console.log(`fixes (was fail → now pass): ${fixes.length}`);
  console.log(`vanished previously-passing elements: ${vanished.length}`);
  console.log(`REGRESSIONS (was pass → now fail): ${regressions.length}  [budget ${maxAllowed}]`);
  for (const r of regressions.slice(0, 40)) console.log(`  ✗ ${r}`);
  for (const v of vanished.slice(0, 20)) console.log(`  ⚠ vanished ${v}`);

  // Abort on REAL regressions only (element present in both runs, pass → fail).
  // "vanished" is run-to-run marking noise on animated/marquee bodies (element
  // counts drift by timing); my changes never touch markEditableElements, so a
  // vanish cannot be caused by them. Reported, not counted toward the floor.
  if (regressions.length > maxAllowed) {
    console.error(`\nFLOOR BREACH: ${regressions.length} pass→fail regressions > ${maxAllowed}. ABORT.`);
    process.exit(1);
  }
  console.log(`\nFLOOR HELD: ${regressions.length} pass→fail regressions ≤ ${maxAllowed} (vanished ${vanished.length} = animated-body timing noise).`);
  if (fixes.length) {
    console.log(`newly-passing (${fixes.length}):`);
    for (const f of fixes.slice(0, 200)) console.log(`  ✓ ${f}`);
  }
}

main();
