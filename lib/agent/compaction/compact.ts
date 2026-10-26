// LA COMPACTACIÓN DE DEEPSEEK, en el orden de `compaction-basic` (MIT): con
// presión, primero se poda (sin modelo); si ya cabe, se acaba ahí; si no, se
// resume el tramo más viejo con el MISMO modelo y se rechaza el resumen que no
// encoge. Un desborde confirmado por el proveedor compacta sin mirar el umbral y
// con cola 0. El fichero de recuperación se guarda ANTES de podar, para que el
// aviso no nombre un fichero que no existe.
import type { Message } from "@/lib/ai-gateway";
import { estimateMessageTokens, estimateTokens } from "./estimate";
import type { CompactionPolicy } from "./policy";
import { oversizedResults, pruneToolResults } from "./prune";
import { selectSpan } from "./select";
import { applySummary, buildSummaryRequest, buildTruncatedSummaryRequest } from "./summary-prompt";

export interface CompactInput {
  readonly messages: readonly Message[];
  /** Primer mensaje que se puede resumir: después del sistema y del manual. */
  readonly firstIndex: number;
  readonly pressureTokens: number;
  readonly policy: CompactionPolicy;
  /** `"manual"` es `/compact` (A11): resume aunque no haya presión, como `force`. */
  readonly trigger: "pressure" | "overflow" | "manual";
  /** A11 · resumir aunque no haya presión (con la cola de `retainTokens`): la
   *  charla que no cabía al empezar (`compactFirst`) y `/compact`. */
  readonly force?: boolean;
  /** Las de `/compact <instrucciones>`, para el resumidor. */
  readonly instructions?: string | null;
  /** Desde dónde están los mensajes que el modelo todavía no ha visto: no se
   *  podan. Por defecto, el último. DeepSeek poda también lo nuevo; aquí lo
   *  nuevo se ve entero una vez, y en un desborde el bucle pasa la longitud
   *  entera —todo se puede podar, como allí—. */
  readonly protectFrom?: number;
  /** `"too_long"`: la petición del resumen tampoco cupo (se reintenta una vez). */
  summarize(request: Message[]): Promise<string | null | "too_long">;
  saveRecovery?(path: string, text: string): Promise<boolean>;
}

export interface CompactOutcome {
  readonly messages: Message[];
  readonly changed: boolean;
  readonly pruned: number;
  readonly summarized: boolean;
  /** A11 · si resumió: dónde quedó el mensaje del resumen, y los ficheros que lo
   *  resumido leyó (del más reciente al más viejo, sin los que el tramo
   *  conservado vuelve a leer), para devolverlos detrás (`restore-files.ts`). */
  readonly summaryIndex?: number;
  readonly readPaths?: string[];
}

/** Los `file_path` de las llamadas `Read` de unos mensajes, del más reciente al más viejo. */
function readPathsIn(messages: readonly Message[]): string[] {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    for (const c of [...(messages[i]!.functionCalls ?? [])].reverse()) {
      const path = (c.args as { file_path?: unknown } | undefined)?.file_path;
      if (c.name === "Read" && typeof path === "string" && !out.includes(path)) out.push(path);
    }
  }
  return out;
}

export async function compactIfNeeded(o: CompactInput): Promise<CompactOutcome> {
  const force = o.force === true || o.trigger === "manual";
  if (o.trigger === "pressure" && !force && o.pressureTokens < o.policy.thresholdTokens) {
    return { messages: [...o.messages], changed: false, pruned: 0, summarized: false };
  }

  // 1 · Podar lo que el modelo ya vio.
  const protectFrom = o.protectFrom ?? o.messages.length - 1;
  const paths = new Map<string, string>();
  if (o.saveRecovery) {
    const stamp = Date.now();
    for (const { key, text } of oversizedResults(o.messages, protectFrom)) {
      const path = `/tmp/pruned/${stamp}-${key.replace(":", "-")}.txt`;
      // Un fichero que no se pudo dejar —la terminal se reinició a medias— no
      // se nombra y ya está: el aviso de la poda sale sin ruta, y el turno sigue.
      const saved = await o.saveRecovery(path, text).catch(() => false);
      if (saved) paths.set(key, path);
    }
  }
  const pruned = pruneToolResults(o.messages, protectFrom, paths);
  const prunedOnly: CompactOutcome = { messages: pruned.messages, changed: pruned.count > 0, pruned: pruned.count, summarized: false };
  const freed = estimateTokens(o.messages) - estimateTokens(pruned.messages);
  if (o.trigger === "pressure" && !force && o.pressureTokens - freed < o.policy.thresholdTokens) return prunedOnly;

  // 2 · Resumir lo más viejo.
  const span = selectSpan(pruned.messages, {
    firstIndex: o.firstIndex,
    retainTokens: o.trigger === "overflow" ? 0 : o.policy.retainTokens,
    estimate: estimateMessageTokens,
  });
  if (!span) return prunedOnly;
  const instructions = o.instructions ?? null;
  let summary = await o.summarize(buildSummaryRequest(pruned.messages, span, instructions));
  // A11 · el `compact_ptl_retry` de Claude Code: si el resumen no cabe, UN
  // reintento sin la mitad más vieja del tramo y su marcador en su lugar.
  if (summary === "too_long") summary = await o.summarize(buildTruncatedSummaryRequest(pruned.messages, span, instructions));
  if (!summary || summary === "too_long" || summary.trim() === "") return prunedOnly;
  const replaced = applySummary(pruned.messages, span, summary);
  // DeepSeek («shrink validation»): un resumen que no encoge no se acepta.
  if (estimateTokens(replaced) >= estimateTokens(pruned.messages)) return prunedOnly;
  const kept = new Set(readPathsIn(pruned.messages.slice(span.end)));
  const readPaths = readPathsIn(pruned.messages.slice(span.start, span.end)).filter((p) => !kept.has(p));
  return { messages: replaced, changed: true, pruned: pruned.count, summarized: true, summaryIndex: span.start, readPaths };
}
