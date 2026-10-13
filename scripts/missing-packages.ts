// scripts/missing-packages.ts
// Which packages Len asked for that its catalog doesn't have, read from the
// transcripts of its turns (lib/apps/missing-packages.ts says where each one
// comes from). It is the list the next catalog grows from: more projects,
// higher up.
//
// It only reads, in a read-only transaction capped at 60 s, and only prints
// package names and counts.
//
// Run: npm run apps:missing-packages            (last 90 days)
//      npm run apps:missing-packages -- --days=30

import { sql } from "drizzle-orm";
import { CATALOGO_ACTUAL, catalogo } from "../lib/apps/dependencias";
import { tallyMissingPackages, type TurnForTally } from "../lib/apps/missing-packages";
import { db } from "../lib/db";

// The four messages (lib/apps/missing-packages.ts; "npm-install" and "import"
// in their old and new wording), so Postgres only returns the turns that have one.
const ANY_MESSAGE = "npm error |isn't available here — there is no npm|is not available in this app|is not installed in this app|imports from URLs or|packages can only be imported in an app";

async function main() {
  const days = Number(process.argv.find((a) => a.startsWith("--days="))?.slice(7) ?? 90);
  if (!Number.isInteger(days) || days < 1) throw new Error("--days=N, with N a positive integer");

  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    await tx.execute(sql`SET LOCAL statement_timeout = '60s'`);
    const res = (await tx.execute(sql`
      SELECT "projectId", "createdAt", "transcript"
      FROM "projectChatMessages"
      WHERE "transcript" IS NOT NULL
        AND "createdAt" > now() - make_interval(days => ${days})
        AND "transcript"::text ~ ${ANY_MESSAGE}
    `)) as unknown;
    return Array.isArray(res) ? (res as Record<string, unknown>[]) : ((res as { rows?: Record<string, unknown>[] }).rows ?? []);
  });

  const turns: TurnForTally[] = rows.map((r) => ({
    projectId: String(r.projectId),
    createdAt: new Date(r.createdAt as string | Date),
    transcript: r.transcript,
  }));
  const current = (catalogo(CATALOGO_ACTUAL)?.dependencias ?? []).map((d) => d.especificador);
  const table = tallyMissingPackages(turns, current);

  console.log(`Packages Len asked for and didn't have — last ${days} days, ${turns.length} turns with one.\n`);
  if (table.length === 0) {
    console.log("None.");
    return;
  }
  for (const r of table) {
    const status = r.inCurrentCatalog ? `already in ${CATALOGO_ACTUAL}` : "missing";
    console.log(
      `${r.pkg.padEnd(32)} ${String(r.projects).padStart(3)} projects · ${String(r.turns).padStart(3)} turns · ${r.sources.join(", ")} · last ${r.lastSeen} · ${status}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[missing-packages] failed", e);
    process.exit(1);
  });
