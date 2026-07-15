import "server-only";

// El núcleo TESTEABLE del cron de datos vivos (spec §6): re-hornea las páginas
// con datos vivos en horario. La lógica vive aquí, con TODAS sus dependencias
// inyectadas (listTargets/fetchSheet/syncCollection/republish), para poder
// probar la selección + el tope + el aislamiento de fallos + el dedup SIN
// tocar DB, red ni el pipeline de publicación. El script fino
// (scripts/live-republish.ts) solo cablea las dependencias reales.
import { liveDataEnabled } from "@/lib/publish/kill-switches";
import type { SheetData } from "./sheet-source";

/** Un proyecto publicado que tiene datos vivos que refrescar. */
export interface RepublishTarget {
  projectId: string;
  userId: string;
  subdomain: string;
  /** settings.liveData?.sheetUrl — para los value-bindings (se rellenan en el
   *  republish); null si el proyecto solo usa colecciones sheet-backed. */
  valueSheetUrl: string | null;
  /** Colecciones cuya fuente es un Sheet: se sincronizan ANTES de republicar. */
  collections: { collectionId: string; sheetUrl: string }[];
}

export interface RepublishDeps {
  listTargets: () => Promise<RepublishTarget[]>;
  fetchSheet: (url: string) => Promise<SheetData>;
  syncCollection: (projectId: string, collectionId: string, rows: Record<string, string>[]) => Promise<unknown>;
  /** Envuelve publishProject — re-hornea el value-binding con datos frescos. */
  republish: (t: RepublishTarget) => Promise<unknown>;
  /** Tope de proyectos por corrida (acota la carga del box). Default 200. */
  maxPerRun?: number;
}

export interface RepublishSummary {
  processed: number;
  synced: number;
  failures: number;
}

export async function runLiveRepublish(deps: RepublishDeps): Promise<RepublishSummary> {
  // Kill-switch primero: ni siquiera se lista nada.
  if (!liveDataEnabled()) return { processed: 0, synced: 0, failures: 0 };

  const max = deps.maxPerRun ?? 200;
  const targets = (await deps.listTargets()).slice(0, max);
  // Dedup de fetches: dos proyectos que comparten la misma URL de Sheet la
  // traen UNA vez por corrida (un fetch por URL, no por proyecto).
  const sheetCache = new Map<string, SheetData>();

  let processed = 0;
  let synced = 0;
  let failures = 0;

  for (const t of targets) {
    try {
      for (const col of t.collections) {
        let data = sheetCache.get(col.sheetUrl);
        if (!data) {
          data = await deps.fetchSheet(col.sheetUrl);
          sheetCache.set(col.sheetUrl, data);
        }
        await deps.syncCollection(t.projectId, col.collectionId, data.rows);
        synced++;
      }
      await deps.republish(t);
      processed++;
    } catch (err) {
      // Un proyecto que falla NUNCA detiene la corrida (spec §7). La corrida
      // entera jamás truena por un Sheet malo.
      failures++;
      // eslint-disable-next-line no-console
      console.warn(
        "[live-republish] project failed " +
          JSON.stringify({ projectId: t.projectId, err: String((err as { message?: unknown })?.message ?? err).slice(0, 120) }),
      );
    }
  }

  return { processed, synced, failures };
}
