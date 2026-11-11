// WHAT HER FIGURE IS DOING (spec local 2026-11-10-figuras-del-asistente, §5.4): the engine guesses nothing; whoever
// already knows the turn's state says it. One rule for her place and her tab on the phone.
//
// Pure.
import type { FigureActivity } from "@/lib/figure/engine";

export interface TurnSignals {
  /** Her last turn ended in an error. */
  failed: boolean;
  /** A tool of hers is running. */
  toolRunning: boolean;
  /** Her answer is arriving. */
  streaming: boolean;
  /** The turn is on and nothing of it has arrived yet. */
  waiting: boolean;
  /** Her owner is writing. */
  typing: boolean;
}

export function activityOf(s: TurnSignals): FigureActivity {
  if (s.toolRunning) return "working";
  if (s.streaming) return "talking";
  if (s.waiting) return "thinking";
  // Her owner writing again is the end of the failed turn's gesture.
  if (s.typing) return "listening";
  if (s.failed) return "error";
  return "ready";
}
