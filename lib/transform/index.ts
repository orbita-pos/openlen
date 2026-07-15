import "server-only";

// EL orquestador del transform de ingestión (spec 2026-07-14): targets →
// bake (Chrome sin red) → translate (lista blanca). NEVER-THROW por
// contrato: ante CUALQUIER error o timeout devuelve el HTML original — la
// página queda exactamente como quedaría hoy, jamás peor. Los callers
// (from-template, from-html) no necesitan try/catch.
import { bakeGeneratedContent, type RunPage } from "./bake";
import { runPageNoNetwork } from "./run-page";
import { translateKnownPatterns } from "./translate";
import { transformEnabled } from "@/lib/publish/kill-switches";

export interface TransformReport {
  bakedContainers: number;
  bakedGeoms: number;
  translated: string[];
  tabsFound: number;
  ms: number;
  /** presente = NO se transformó (motivo); ausente = flujo feliz */
  fallback?: string;
}

export interface TransformOptions {
  /** presupuesto total; el runPage real recibe el mismo tope */
  timeoutMs?: number;
  /** solo tests — el default es el Chrome real sin red */
  runPage?: RunPage;
  /** etiqueta para la línea de telemetría (p. ej. "from-template:mirror") */
  source?: string;
}

export async function transformIngestedHtml(
  html: string,
  opts: TransformOptions = {},
): Promise<{ html: string; report: TransformReport }> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 5000;
  const done = (report: Omit<TransformReport, "ms">) => ({
    html,
    report: { ...report, ms: Date.now() - started },
  });

  if (!transformEnabled()) {
    return done({ bakedContainers: 0, bakedGeoms: 0, translated: [], tabsFound: 0, fallback: "disabled" });
  }

  try {
    const runPage: RunPage = opts.runPage ?? ((h) => runPageNoNetwork(h, timeoutMs));
    const work = (async () => {
      const baked = await bakeGeneratedContent(html, runPage);
      const t = translateKnownPatterns(baked.html);
      return { baked, t };
    })();
    // El verdugo del presupuesto TOTAL (bake+translate). runPageNoNetwork
    // tiene además su propio kill interno que cierra Chrome — esta carrera
    // garantiza que la REQUEST nunca espera más que el presupuesto aunque
    // algo aguas abajo se cuelgue.
    const timer = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs).unref?.();
    });
    const { baked, t } = await Promise.race([work, timer]);

    const report: TransformReport = {
      bakedContainers: baked.bakedContainers,
      bakedGeoms: baked.bakedGeoms,
      translated: t.translated,
      tabsFound: t.tabsFound,
      ms: Date.now() - started,
    };
    const didSomething =
      report.bakedContainers > 0 || report.bakedGeoms > 0 || report.translated.length > 0 || t.html !== html;
    if (didSomething) {
      // eslint-disable-next-line no-console
      console.warn(`[transform] ${JSON.stringify({ source: opts.source ?? "?", ...report })}`);
    }
    return { html: t.html, report };
  } catch (err) {
    const reason = String((err as { message?: unknown })?.message ?? err).slice(0, 160);
    // Un fallback NUNCA rompe el clon, pero tampoco debe ser invisible: el
    // HOME read-only del box tumbó Chrome en prod durante días y nadie lo vio
    // porque este catch callaba (incidente del backfill, 2026-07-15).
    // eslint-disable-next-line no-console
    console.warn(`[transform] fallback ${JSON.stringify({ source: opts.source ?? "?", reason })}`);
    return done({ bakedContainers: 0, bakedGeoms: 0, translated: [], tabsFound: 0, fallback: reason });
  }
}
