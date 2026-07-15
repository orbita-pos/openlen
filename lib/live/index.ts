import "server-only";

// EL orquestador de "datos vivos" (spec 2026-07-14): cache-por-URL de Sheet →
// (en miss) fetch + guardar en cache → hornear cada [data-ol-live] con su
// valor. NEVER-THROW por contrato, igual que lib/transform/index.ts: ante
// CUALQUIER error/timeout/kill-switch apagado devuelve el HTML ORIGINAL
// intacto — el Sheet es una mejora, jamás una dependencia. Los callers
// (publish, cron de refresco) no necesitan try/catch.
import { liveDataEnabled } from "@/lib/publish/kill-switches";
import { fetchSheet as fetchSheetReal, type SheetData } from "./sheet-source";
import { getCachedSheet as getCachedSheetReal, putCachedSheet as putCachedSheetReal } from "./cache";
import { bakeLiveValues } from "./bake-values";

export interface LiveReport {
  baked: number;
  /** presente = NO se aplicaron datos vivos (motivo); ausente = flujo feliz
   *  (incluye el caso "sin sheetUrl", que no es un error). */
  fallback?: string;
}

interface LiveDataDeps {
  fetchSheet: typeof fetchSheetReal;
  getCachedSheet: typeof getCachedSheetReal;
  putCachedSheet: typeof putCachedSheetReal;
}

const DEFAULT_TIMEOUT = 5000;
// 55 min y no 60: el cron de refresco (siguiente task) corre cada hora. Con
// TTL=60 habría una carrera donde el cache sigue "vivo" justo cuando el cron
// despierta, y esa corrida serviría el dato de hace una hora completa sin
// refrescar. Con 55 el cache siempre vence ANTES del próximo ciclo del cron,
// así que cada corrida ve un miss real y fetchea.
const CACHE_TTL_MS = 55 * 60 * 1000;

export interface ApplyLiveDataOptions {
  timeoutMs?: number;
  /** solo tests — el default son fetchSheet/getCachedSheet/putCachedSheet
   *  reales; inyectable para que los tests nunca toquen red ni disco. */
  deps?: Partial<LiveDataDeps>;
}

export async function applyLiveData(
  html: string,
  sheetUrl: string | null,
  opts: ApplyLiveDataOptions = {},
): Promise<{ html: string; report: LiveReport }> {
  if (!liveDataEnabled()) {
    return { html, report: { baked: 0, fallback: "disabled" } };
  }

  // Sin Sheet configurado: la página simplemente no usa datos vivos. No es
  // un error, así que NO lleva `fallback` (ese campo es para "se intentó y
  // no se pudo").
  if (!sheetUrl) {
    return { html, report: { baked: 0 } };
  }

  const fetchSheet = opts.deps?.fetchSheet ?? fetchSheetReal;
  const getCachedSheet = opts.deps?.getCachedSheet ?? getCachedSheetReal;
  const putCachedSheet = opts.deps?.putCachedSheet ?? putCachedSheetReal;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;

  try {
    let data: SheetData | null = await getCachedSheet(sheetUrl, CACHE_TTL_MS);
    if (!data) {
      data = await fetchSheet(sheetUrl, timeoutMs);
      await putCachedSheet(sheetUrl, data);
    }

    const baked = bakeLiveValues(html, data.values);
    const report: LiveReport = { baked: baked.baked };
    logNotable(sheetUrl, report);
    return { html: baked.html, report };
  } catch (err) {
    const reason = String((err as { message?: unknown })?.message ?? err).slice(0, 160);
    const report: LiveReport = { baked: 0, fallback: reason };
    logNotable(sheetUrl, report);
    return { html, report };
  }
}

// El sensor de demanda + la señal de Sheet-roto (spec §9): UNA línea
// estructurada solo cuando pasó algo que valga registrar — se horneó un
// valor, o un fetch/parse falló de verdad (ese fallback además alimenta el
// aviso al dueño). El caso común (kill-switch off, o página sin Sheet) sale
// por los returns tempranos y jamás llega aquí: silencio, igual que el
// transform cuando no hay nada que hacer.
function logNotable(sheetUrl: string, report: LiveReport): void {
  if (report.baked > 0 || report.fallback) {
    // eslint-disable-next-line no-console
    console.warn(`[live] ${JSON.stringify({ sheetUrl, baked: report.baked, fallback: report.fallback })}`);
  }
}
