// One-off, READ-ONLY economics measurement for the assembly-vs-generation
// decision. Replaces the MODELED cost numbers with what the DB can actually
// show, and states plainly what it cannot.
//
// CRITICAL: real per-generation token counts + per-generation cost are NOT
// persisted anywhere — /api/generate and /api/templates/ai-design only
// console.log them, then discard. There is no usage/tokens/cost table and no
// append-only credit ledger. So those two metrics are USER-RUN / log-scrape
// only (see the banner + Section G). Everything else here is DB-only and real.
//
// Run: npm run cost:measure   (needs DATABASE_URL in .env.local; Neon is
// reachable locally — no Gemini/R2 egress needed for any section below.)

import { db, schema } from "../lib/db";
import { listAllForAdmin } from "../lib/templates/store";
import { listAllSectionsForAdmin } from "../lib/sections/store";
import { SECTION_TYPES, SECTION_TYPE_META } from "../lib/sections/types";
import { CREDITS_BY_PLAN, creditsForUsage } from "../lib/credits";

// Gemini USD per 1M tokens. RATES is module-private in lib/credits.ts, so we
// re-declare it (keep in sync with lib/credits.ts:68). lib/credits.ts itself
// flags these as UNVERIFIED Gemini-2.5 placeholders — verify against
// ai.google.dev/pricing before trusting absolute dollars.
const RATES = {
  "gemini-pro": { input: 1.25, output: 10 },
  "gemini-flash": { input: 0.3, output: 2.5 },
} as const;
const TEMPLATE_FAMILY_COUNT = 32;

function costUSD(model: keyof typeof RATES, inT: number, outT: number): number {
  const r = RATES[model];
  return (inT * r.input + outT * r.output) / 1_000_000;
}

function hr(title: string): void {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

function pct(n: number, d: number): string {
  return `${((n / d) * 100).toFixed(0)}%`;
}

async function main() {
  hr("[!] CRITICAL FINDING — what this script CANNOT measure");
  console.log(
    [
      "Real per-generation OUTPUT TOKENS and per-generation COST are NOT stored.",
      "They are only console.log'd by /api/generate (route.ts:359) and",
      "/api/templates/ai-design (route.ts:865), then discarded. There is no",
      "usage/tokens/cost table and no append-only credit ledger (debitCredits",
      "does an in-place UPDATE on users.credits, rounded up + floored at 1).",
      "",
      "  => token + cost metrics are USER-RUN (run generations and read",
      "     generateHtmlStream(...).done.usage) or log-scrape (journald on the",
      "     Hetzner box, unit openlen-app). The formula is in Section G.",
      "",
      "Everything below is DB-only and real.",
    ].join("\n"),
  );

  // ── A. Template census ────────────────────────────────────────────────
  hr("A . TEMPLATE LIBRARY CENSUS (by family)");
  const templates = await listAllForAdmin();
  const tByFamily: Record<string, string[]> = {};
  for (const t of templates) (tByFamily[t.family] ??= []).push(t.id);
  const tStatus = (s: string) => templates.filter((t) => t.status === s).length;
  console.log(
    `TOTAL templates: ${templates.length}  ` +
      `(published=${tStatus("published")}, draft=${tStatus("draft")}, ` +
      `archived=${tStatus("archived")})`,
  );
  console.log(
    `families populated: ${Object.keys(tByFamily).length} / ${TEMPLATE_FAMILY_COUNT}\n`,
  );
  for (const f of Object.keys(tByFamily).sort()) {
    console.log(`  ${f.padEnd(20)} ${String(tByFamily[f].length).padStart(3)}`);
  }

  // ── B. Section census ─────────────────────────────────────────────────
  hr("B . SECTION LIBRARY CENSUS (by type)");
  const sections = await listAllSectionsForAdmin();
  const sPublished = sections.filter((s) => s.status === "published").length;
  console.log(`TOTAL sections: ${sections.length}  (published=${sPublished})`);
  const typesPopulated = new Set(
    sections.filter((s) => s.status === "published").map((s) => s.type),
  );
  console.log(
    `types populated: ${typesPopulated.size} / ${SECTION_TYPES.length}\n`,
  );
  for (const type of [...SECTION_TYPES].sort(
    (a, b) => SECTION_TYPE_META[a].order - SECTION_TYPE_META[b].order,
  )) {
    const n = sections.filter((s) => s.type === type).length;
    if (n) console.log(`  ${type.padEnd(14)} ${String(n).padStart(3)}`);
  }

  // ── C+D. Project origin + clones per template ─────────────────────────
  // Origin lives only in projects.tags (no FK): template clone =>
  // [templateId,'template',family]; paste => ['paste']; AI-gen => [].
  hr("C . PROJECT-ORIGIN MIX + CLONES PER TEMPLATE");
  const projects = await db
    .select({ tags: schema.projects.tags })
    .from(schema.projects);
  let templateClones = 0;
  let pastes = 0;
  let aiGen = 0;
  const clonesByTemplate: Record<string, number> = {};
  for (const p of projects) {
    const tags = p.tags ?? [];
    if (tags.includes("template")) {
      templateClones++;
      const id = tags[0];
      if (id && id !== "template") {
        clonesByTemplate[id] = (clonesByTemplate[id] ?? 0) + 1;
      }
    } else if (tags.includes("paste")) {
      pastes++;
    } else if (tags.length === 0) {
      aiGen++;
    }
  }
  console.log(`TOTAL projects: ${projects.length}`);
  console.log(`  template clones : ${templateClones}`);
  console.log(`  paste           : ${pastes}`);
  console.log(`  AI-generated    : ${aiGen}`);
  const other = projects.length - templateClones - pastes - aiGen;
  if (other) console.log(`  other/untagged  : ${other}`);
  console.log(
    "\nCAVEAT: clones = CURRENT-STATE snapshot (deleted projects vanish), " +
      "inflated by\nduplicateProject() copying tags forward; tags is a " +
      "heuristic, not an FK.",
  );

  const cloneRows = Object.entries(clonesByTemplate).sort((a, b) => b[1] - a[1]);
  if (cloneRows.length) {
    console.log("\ntop templates by surviving clones:");
    for (const [id, n] of cloneRows.slice(0, 20)) {
      const fam = templates.find((t) => t.id === id)?.family ?? "?";
      console.log(`  ${id.padEnd(24)} ${String(n).padStart(4)}  (${fam})`);
    }
    const zero = templates.filter((t) => !clonesByTemplate[t.id]).length;
    console.log(
      `\ntemplates with ZERO surviving clones: ${zero} / ${templates.length}`,
    );
    const byFam: Record<string, number> = {};
    for (const [id, n] of cloneRows) {
      const fam = templates.find((t) => t.id === id)?.family ?? "?";
      byFam[fam] = (byFam[fam] ?? 0) + n;
    }
    console.log("\nclones rolled up by family:");
    for (const [fam, n] of Object.entries(byFam).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${fam.padEnd(20)} ${String(n).padStart(4)}`);
    }
  } else {
    console.log("\n(no template-clone projects found yet)");
  }
  console.log(
    "\nNOTE: section INSERTS are not separate projects and leave no tag — " +
      "section\nadoption is NOT measurable from the DB.",
  );

  // ── E. Hit-rate coverage heuristic (offline proxy) ────────────────────
  hr("E . LIBRARY COVERAGE HEURISTIC (offline proxy for hit-rate)");
  const famCov = Object.keys(tByFamily).length;
  console.log(
    `template family coverage: ${famCov} / ${TEMPLATE_FAMILY_COUNT} ` +
      `(${pct(famCov, TEMPLATE_FAMILY_COUNT)})`,
  );
  console.log(
    `section type coverage   : ${typesPopulated.size} / ${SECTION_TYPES.length} ` +
      `(${pct(typesPopulated.size, SECTION_TYPES.length)})`,
  );
  const avgVariants = sPublished / Math.max(1, typesPopulated.size);
  console.log(
    `avg published variants / populated type: ${avgVariants.toFixed(1)}`,
  );
  console.log(
    "\nThis is a COVERAGE PROXY, not a semantic hit-rate. The true 'can the " +
      "library\nsatisfy brief X' question needs an AI judge (Gemini) => " +
      "USER-RUN (Section G).",
  );

  // ── F. Credit-spend aggregate (lossy) ─────────────────────────────────
  hr("F . CURRENT-MONTH NET CREDIT SPEND (lossy aggregate)");
  const users = await db
    .select({ plan: schema.users.plan, credits: schema.users.credits })
    .from(schema.users);
  let totalSpent = 0;
  const byPlan: Record<string, { spent: number; n: number }> = {};
  for (const u of users) {
    const allot = CREDITS_BY_PLAN[u.plan as keyof typeof CREDITS_BY_PLAN] ?? 0;
    const spent = Math.max(0, allot - (u.credits ?? 0));
    totalSpent += spent;
    const e = (byPlan[u.plan] ??= { spent: 0, n: 0 });
    e.spent += spent;
    e.n++;
  }
  console.log(
    `users: ${users.length}   total credits spent (net): ${totalSpent}`,
  );
  for (const [plan, v] of Object.entries(byPlan)) {
    console.log(
      `  ${plan.padEnd(8)} n=${v.n}  spent=${v.spent}  ` +
        `avg=${(v.spent / Math.max(1, v.n)).toFixed(1)}`,
    );
  }
  console.log(
    "\nCAVEAT: clamped at 0, resets every 30 days, mixes generate+chat+autofill, " +
      "rounded\nup + floored at 1 credit — NOT attributable to a model or a " +
      "single generation.",
  );

  // ── G. Cost formula + USER-RUN instructions ───────────────────────────
  hr("G . COST FORMULA + USER-RUN INSTRUCTIONS (the real numbers live here)");
  console.log("Gemini USD per 1M tokens (verify against ai.google.dev/pricing):");
  console.log(
    `  gemini-pro  : input $${RATES["gemini-pro"].input}  output $${RATES["gemini-pro"].output}`,
  );
  console.log(
    `  gemini-flash: input $${RATES["gemini-flash"].input}  output $${RATES["gemini-flash"].output}`,
  );
  console.log("\ncost = (inputTokens*rate.input + outputTokens*rate.output) / 1e6");

  const exIn = 2000;
  const exFullOut = 8000;
  const exRecipeOut = 300;
  console.log("\nMODELED example (REPLACE exFullOut/exRecipeOut with REAL tokens):");
  console.log(
    `  full HTML (~${exFullOut} out)  pro=$${costUSD("gemini-pro", exIn, exFullOut).toFixed(4)}` +
      `  flash=$${costUSD("gemini-flash", exIn, exFullOut).toFixed(4)}`,
  );
  console.log(
    `  recipe    (~${exRecipeOut} out)  flash=$${costUSD("gemini-flash", exIn, exRecipeOut).toFixed(4)}`,
  );
  const delta =
    costUSD("gemini-pro", exIn, exFullOut) /
    costUSD("gemini-flash", exIn, exRecipeOut);
  console.log(
    `  => assembly (recipe-flash) vs full-HTML-pro = ${delta.toFixed(0)}x cheaper`,
  );
  const billed = creditsForUsage(exIn, exFullOut, "gemini-pro");
  console.log(
    `  billed to user (full-HTML pro): ${billed} credits (~$${(billed * 0.01).toFixed(2)} at $0.01/cr)`,
  );

  console.log(
    [
      "",
      "To get REAL token counts (Gemini egress is blocked in the sandbox — run",
      "where Gemini is reachable: locally via `npx next dev`, or on the box):",
      "  1) Run representative briefs through /api/generate.",
      "  2) Read generateHtmlStream(...).done -> summary.usage.{inputTokens,",
      "     outputTokens} (lib/ai-stream/generate.ts) — the real, exact count.",
      "  3) Feed them into the formula above for pro vs flash.",
      "  Worst case = 2 metered passes (vision critic capped at 1; retry bills both).",
      "  Or scrape journald on the box for '[generate] tokens' lines for history.",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
