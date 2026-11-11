// THE FIGURE LEN SUGGESTED, ON ITS WAY TO THE CARD (spec local 2026-11-10-figuras-del-asistente, §5.6): `create_assistant`
// leaves it in its action's `summary`, after the tool's name — a field a turn already keeps and sends, so the
// suggestion survives a reload without a new field through the turn's plumbing. The card reads it back, checked.
//
// Pure and client-safe.
import { checkLook, type FigureLook } from "@/lib/figure/look";

const TOOL = "create_assistant";

export function summaryWithLook(look: FigureLook): string {
  return `${TOOL} ${JSON.stringify(look)}`;
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
