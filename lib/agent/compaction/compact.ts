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
import { applySummary, buildSummaryRequest } from "./summary-prompt";

export interface CompactInput {
  readonly messages: readonly Message[];
  /** Primer mensaje que se puede resumir: después del sistema y del manual. */
  readonly firstIndex: number;
  readonly pressureTokens: number;
  readonly policy: CompactionPolicy;
  readonly trigger: "pressure" | "overflow";
  /** Desde dónde están los mensajes que el modelo todavía no ha visto: no se
   *  podan. Por defecto, el último. DeepSeek poda también lo nuevo; aquí lo
   *  nuevo se ve entero una vez, y en un desborde el bucle pasa la longitud
   *  entera —todo se puede podar, como allí—. */
  readonly protectFrom?: number;
  summarize(request: Message[]): Promise<string | null>;
  saveRecovery?(path: string, text: string): Promise<boolean>;
}

export interface CompactOutcome {
  readonly messages: Message[];
  readonly changed: boolean;
  readonly pruned: number;
  readonly summarized: boolean;
}

export async function compactIfNeeded(o: CompactInput): Promise<CompactOutcome> {
  if (o.trigger === "pressure" && o.pressureTokens < o.policy.thresholdTokens) {
    return { messages: [...o.messages], changed: false, pruned: 0, summarized: false };
  }

  // 1 · Podar lo que el modelo ya vio.
  const protectFrom = o.protectFrom ?? o.messages.length - 1;
  const paths = new Map<string, string>();
  if (o.saveRecovery) {
    const stamp = Date.now();
    for (const { key, text } of oversizedResults(o.messages, protectFrom)) {
      const path = `/tmp/pruned/${stamp}-${key.replace(":", "-")}.txt`;
      if (await o.saveRecovery(path, text)) paths.set(key, path);
    }
  }
  const pruned = pruneToolResults(o.messages, protectFrom, paths);
  const prunedOnly: CompactOutcome = { messages: pruned.messages, changed: pruned.count > 0, pruned: pruned.count, summarized: false };
  const freed = estimateTokens(o.messages) - estimateTokens(pruned.messages);
  if (o.trigger === "pressure" && o.pressureTokens - freed < o.policy.thresholdTokens) return prunedOnly;

  // 2 · Resumir lo más viejo.
  const span = selectSpan(pruned.messages, {
    firstIndex: o.firstIndex,
    retainTokens: o.trigger === "overflow" ? 0 : o.policy.retainTokens,
    estimate: estimateMessageTokens,
  });
  if (!span) return prunedOnly;
  const summary = await o.summarize(buildSummaryRequest(pruned.messages, span));
  if (!summary || summary.trim() === "") return prunedOnly;
  const replaced = applySummary(pruned.messages, span, summary);
  // DeepSeek («shrink validation»): un resumen que no encoge no se acepta.
  if (estimateTokens(replaced) >= estimateTokens(pruned.messages)) return prunedOnly;
  return { messages: replaced, changed: true, pruned: pruned.count, summarized: true };
}
