// scripts/missing-packages.ts
// Qué paquetes pidió Len que su catálogo no tiene, leído de las transcripciones
// de sus turnos (lib/apps/missing-packages.ts dice de dónde sale cada uno). Es
// la lista con la que crece el catálogo siguiente: más proyectos, más arriba.
//
// Sólo lee, en una transacción de lectura con tope de 60 s, y sólo imprime
// nombres de paquetes y recuentos.
//
// Run: npm run apps:missing-packages            (últimos 90 días)
//      npm run apps:missing-packages -- --days=30

import { sql } from "drizzle-orm";
import { CATALOGO_ACTUAL, catalogo } from "../lib/apps/dependencias";
import { tallyMissingPackages, type TurnForTally } from "../lib/apps/missing-packages";
import { db } from "../lib/db";

// Los cuatro textos (en el orden de lib/apps/missing-packages.ts), para que
// Postgres sólo devuelva los turnos que tienen alguno.
const ALGUNO = "isn't available here — there is no npm|is not available in this app|imports from URLs or|packages can only be imported in an app";

async function main() {
  const dias = Number(process.argv.find((a) => a.startsWith("--days="))?.slice(7) ?? 90);
  if (!Number.isInteger(dias) || dias < 1) throw new Error("--days=N, con N entero y positivo");

  const filas = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    await tx.execute(sql`SET LOCAL statement_timeout = '60s'`);
    const res = (await tx.execute(sql`
      SELECT "projectId", "createdAt", "transcript"
      FROM "projectChatMessages"
      WHERE "transcript" IS NOT NULL
        AND "createdAt" > now() - make_interval(days => ${dias})
        AND "transcript"::text ~ ${ALGUNO}
    `)) as unknown;
    return Array.isArray(res) ? (res as Record<string, unknown>[]) : ((res as { rows?: Record<string, unknown>[] }).rows ?? []);
  });

  const turnos: TurnForTally[] = filas.map((f) => ({
    projectId: String(f.projectId),
    createdAt: new Date(f.createdAt as string | Date),
    transcript: f.transcript,
  }));
  const actual = (catalogo(CATALOGO_ACTUAL)?.dependencias ?? []).map((d) => d.especificador);
  const tabla = tallyMissingPackages(turnos, actual);

  console.log(`Paquetes que Len pidió y no tenía — últimos ${dias} días, ${turnos.length} turnos con alguno.\n`);
  if (tabla.length === 0) {
    console.log("Ninguno.");
    return;
  }
  for (const f of tabla) {
    const estado = f.inCurrentCatalog ? `ya en ${CATALOGO_ACTUAL}` : "falta";
    console.log(
      `${f.pkg.padEnd(32)} ${String(f.projects).padStart(3)} proyectos · ${String(f.turns).padStart(3)} turnos · ${f.sources.join(", ")} · último ${f.lastSeen} · ${estado}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[missing-packages] falló", e);
    process.exit(1);
  });
