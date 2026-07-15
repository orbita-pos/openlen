// Backfill de conductas para proyectos EXISTENTES (los clones nacidos antes
// del transform de ingestión, master a443759). Corre translateKnownPatterns
// (determinista, sin Chrome, sin IA — el JS de estos proyectos ya fue borrado
// por el sanitizer al nacer, así que el paso de bake no aplica aquí; el bake
// de los demos del Explore va aparte, vía re-seed con el seeder transformado).
//
// DRY-RUN POR DEFECTO: imprime qué cambiaría y NO escribe nada. Con --apply:
//   1. snapshot de versión por documento (label pre-conductas-backfill) para
//      poder revertir desde el panel Versiones,
//   2. update de projects.data con el HTML traducido.
// Las páginas publicadas se re-hornean después vía POST /api/internal/republish
// (en el box — publicar desde local escribiría al disco equivocado).
//
// Run (dry):   npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json --require ./scripts/test-node-server-only-shim.cjs scripts/transform-backfill.ts
// Run (real):  ... scripts/transform-backfill.ts --apply
// Filtros:     --only=id1,id2   --limit=N
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { translateKnownPatterns } from "@/lib/transform/translate";
import { createVersion } from "@/lib/projects/versions";
import type { ProjectData } from "@/lib/projects/types";

const APPLY = process.argv.includes("--apply");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(",")) : null;
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.slice(8), 10) : Infinity;

interface DocChange {
  page: string | null; // null = home
  behaviors: string[];
  tabsFound: number;
}

async function main() {
  const rows = (
    await db.execute(sql`
      SELECT id, data, subdomain, ("publishedAt" IS NOT NULL AND subdomain IS NOT NULL) AS published
      FROM projects ORDER BY "createdAt"`)
  ).rows as unknown as { id: string; data: ProjectData; subdomain: string | null; published: boolean }[];

  let scanned = 0;
  let changedProjects = 0;
  const publishedChanged: string[] = [];

  for (const row of rows) {
    if (ONLY && !ONLY.has(row.id)) continue;
    if (scanned >= LIMIT) break;
    scanned++;

    const data = row.data;
    if (!data?.html) continue;

    const changes: DocChange[] = [];
    const nextData: ProjectData = { ...data };

    const home = translateKnownPatterns(data.html);
    if (home.html !== data.html) {
      changes.push({ page: null, behaviors: home.translated, tabsFound: home.tabsFound });
      nextData.html = home.html;
    }

    if (data.pages) {
      const nextPages: NonNullable<ProjectData["pages"]> = { ...data.pages };
      for (const [slug, pg] of Object.entries(data.pages)) {
        const out = translateKnownPatterns(pg.html);
        if (out.html !== pg.html) {
          changes.push({ page: slug, behaviors: out.translated, tabsFound: out.tabsFound });
          nextPages[slug] = { ...pg, html: out.html };
        }
      }
      nextData.pages = nextPages;
    }

    if (changes.length === 0) continue;
    changedProjects++;
    if (row.published) publishedChanged.push(row.id);

    const detail = changes
      .map((c) => `${c.page ?? "home"}:[${c.behaviors.join("+") || "-"}${c.tabsFound ? ` tabs×${c.tabsFound}` : ""}]`)
      .join(" ");
    console.log(`${APPLY ? "APPLY" : "would"} ${row.id}${row.subdomain ? ` (${row.subdomain})` : ""} → ${detail}`);

    if (!APPLY) continue;

    for (const c of changes) {
      const original = c.page === null ? data.html : data.pages![c.page].html;
      await createVersion({
        projectId: row.id,
        html: original,
        // source "manual": VersionSource no tiene variante de backfill y añadir
        // una solo para un script one-shot no lo amerita; el label identifica.
        label: "pre-conductas-backfill",
        source: "manual",
        page: c.page,
      });
    }
    await db.execute(sql`UPDATE projects SET data = ${JSON.stringify(nextData)}::jsonb, "updatedAt" = now() WHERE id = ${row.id}`);
  }

  console.log(
    `\n${APPLY ? "APLICADO" : "DRY-RUN"}: ${scanned} escaneados · ${changedProjects} con cambios · ${publishedChanged.length} publicados a re-hornear`,
  );
  if (publishedChanged.length > 0) {
    console.log("PUBLICADOS (para /api/internal/republish):");
    console.log(JSON.stringify({ projectIds: publishedChanged }));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[transform-backfill] fatal", err);
  process.exit(1);
});
