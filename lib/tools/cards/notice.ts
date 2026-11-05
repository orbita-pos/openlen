// WHAT LEN LEARNS ABOUT ITS CARDS (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): DeepSeek's action-cards
// status notice (packages/experimental/action-cards, at fcc0ad4621, MIT) for OpenLen's `create_tool` — the cards the
// person or the background work changed since Len last heard, as facts with the kind's guidance, read at the start of
// Len's next request in that chat. It never wakes Len. Pure.
import type { ToolCardRow } from "./store";

const FACTS =
  "Latest status of action cards from user actions and background work. These are status facts, not a request to start or retry work. Use these receipts instead of the earlier proposal when describing progress.";

const GUIDANCE =
  "Cancelled means a started background build was stopped before installation. Cancelled, failed or interrupted builds can be retried from their existing card; no new proposal is needed. A removed tool can be restored from its card while its version remains; if it is gone, a new proposal is needed.";

const CONTINUE = "Continue with the user's current request.";

export function toolCardStatusNotice(cards: readonly ToolCardRow[]): string | null {
  if (cards.length === 0) return null;
  const receipts = cards.map((c) => ({
    action: "create_tool",
    id: c.id,
    title: c.title,
    phase: c.phase,
    data: { placement: c.placement, ...(c.customLocation ? { customLocation: c.customLocation } : {}), ...(c.error ? { error: c.error } : {}) },
  }));
  return [FACTS, GUIDANCE, CONTINUE, JSON.stringify(receipts)].join("\n\n");
}
