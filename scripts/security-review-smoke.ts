// Runs the security review of ONE project against the LOCAL dev database, with
// the real model, and prints what it found and what it cost. Paid: a few cents.
//
// Run from the worktree, with the main checkout's .env.local plus the pages
// cluster of the local test (see the memory ia-de-las-apps, "CÓMO se prueba en
// local una app con backend"):
//   node ../../../node_modules/tsx/dist/cli.mjs --require ../security-review-shim.cjs \
//     --env-file=../../../.env.local --env-file=<scratchpad>/app-ai-local/app-ai.env \
//     --tsconfig tsconfig.eval.json scripts/security-review-smoke.ts <projectId> [locale]

import { exigirBaseLocal } from "../lib/len-bench/entorno";
import { securityReviewer } from "../lib/security-review/real";
import { pgSecurityReviewStore } from "../lib/security-review/store-pg";

async function main() {
  const [projectId, locale = "es"] = process.argv.slice(2);
  if (!projectId) throw new Error("usage: security-review-smoke.ts <projectId> [locale]");
  await exigirBaseLocal();
  const started = Date.now();
  const first = await securityReviewer().start(projectId, locale);
  if (!first) throw new Error("no review: switched off, or no such project");
  const view = await securityReviewer().wait(projectId, first.fingerprint, 200_000);
  const record = await pgSecurityReviewStore.get(projectId, first.fingerprint);
  console.log(
    JSON.stringify(
      {
        seconds: Math.round((Date.now() - started) / 1000),
        status: view?.status,
        failReason: record?.failReason,
        costCentiCredits: record?.costCentiCredits,
        blocking: view?.blocking,
        medium: view?.medium,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
