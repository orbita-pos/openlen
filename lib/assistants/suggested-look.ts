// THE FIGURE LEN SUGGESTED, ON ITS WAY TO THE CARD (spec local 2026-11-10-figuras-del-asistente, §5.6): `create_assistant`
// leaves it in its action's `summary`, after the tool's name — a field a turn already keeps and sends, so the
// suggestion survives a reload without a new field through the turn's plumbing. The card reads it back, checked.
//
// Pure and client-safe.
import { checkLook, type FigureLook } from "@/lib/figure/look";

const TOOL = "create_assistant";

/** The look, and — for an agent Len wrote (spec local 2026-11-19-agentes-para-todos, §6.3) — its file and whether it was
 *  asked for in the person's space. Beside the look's keys, which `checkLook` ignores, so a card from before still reads. */
export function summaryWithLook(look: FigureLook, more: { readonly agent?: string | null; readonly fromSpace?: boolean } = {}): string {
  return `${TOOL} ${JSON.stringify({ ...look, ...(more.agent ? { agent: more.agent } : {}), ...(more.fromSpace ? { fromSpace: true } : {}) })}`;
}

/** The agent file and where it was asked for, in a `create_assistant` action's summary. */
export function suggestedAgentOf(summary: unknown): { agent: string | null; fromSpace: boolean } {
  const none = { agent: null, fromSpace: false };
  if (typeof summary !== "string" || !summary.startsWith(`${TOOL} `)) return none;
  try {
    const o = JSON.parse(summary.slice(TOOL.length + 1)) as { agent?: unknown; fromSpace?: unknown };
    return { agent: typeof o.agent === "string" && o.agent ? o.agent : null, fromSpace: o.fromSpace === true };
  } catch {
    return none;
  }
}

/** The look in a `create_assistant` action's summary; `undefined` for a turn from before, or anything that is not one. */
export function suggestedLookOf(summary: unknown): FigureLook | undefined {
  if (typeof summary !== "string" || !summary.startsWith(`${TOOL} `)) return undefined;
  try {
    const look = checkLook(JSON.parse(summary.slice(TOOL.length + 1)));
    return look.ok ? look.value : undefined;
  } catch {
    return undefined;
  }
}
