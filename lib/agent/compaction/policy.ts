// CUÁNDO COMPACTAR, con la fórmula del arnés de DeepSeek
// (`packages/compaction/compaction-basic/src/config.ts` @ 5badb15, MIT):
// umbral = floor(min(W × 0,8, W − O − 65.536)) y cola literal = 16 % de (W − O).
// W es la ventana EFECTIVA de Len —la decide el coste, no el modelo: ver §2 de
// plans/len-agente-2026/INVESTIGACION-2-5-AL-LIMITE.md—. Una política imposible
// falla al cargar, como allí: mejor un error en el arranque que un turno raro.
export interface CompactionPolicyInput {
  readonly windowTokens: number;
  readonly maxOutputTokens: number;
  readonly thresholdRatio?: number;
  readonly headroomTokens?: number;
  readonly retainRatio?: number;
}

export interface CompactionPolicy {
  readonly thresholdTokens: number;
  readonly retainTokens: number;
}

export function resolveCompaction(input: CompactionPolicyInput): CompactionPolicy {
  const ratio = input.thresholdRatio ?? 0.8;
  const headroom = input.headroomTokens ?? 65_536;
  const retain = input.retainRatio ?? 0.16;
  const usable = input.windowTokens - input.maxOutputTokens;
  const thresholdTokens = Math.floor(Math.min(input.windowTokens * ratio, usable - headroom));
  const retainTokens = Math.floor(usable * retain);
  if (thresholdTokens <= 0 || retainTokens >= thresholdTokens) {
    throw new Error(
      `compaction policy: threshold ${thresholdTokens} and retain ${retainTokens} don't fit window ${input.windowTokens} with output ${input.maxOutputTokens}`,
    );
  }
  return { thresholdTokens, retainTokens };
}
