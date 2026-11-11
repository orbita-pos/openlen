// WHAT PUBLISHING BAKES AS THE PAGE'S BUBBLE (spec local 2026-11-06-asistente-propio, §4.4.5; phase 2A): the person's
// own assistant when she is on the page — her name and her figure —, today's assistant otherwise. Her look is
// checked again here (lib/assistants/look.ts): it goes into the published page's markup.
//
// Pure.
import type { AssistantPersona } from "@/lib/publish/assistant-widget";

import { lookOfRow } from "../look";

export interface AssistantBakeChoice {
  enabled: true;
  businessName: string;
  persona?: AssistantPersona;
}

export function assistantBakeOf(o: {
  legacyEnabled: boolean;
  businessName: string;
  /** Her row's name, saved look and color (the color dresses a row from before the figures). */
  onPage: { name: string; look?: unknown; color: string } | null;
}): AssistantBakeChoice | undefined {
  if (o.onPage) {
    return { enabled: true, businessName: o.businessName, persona: { name: o.onPage.name, look: lookOfRow(o.onPage) } };
  }
  return o.legacyEnabled ? { enabled: true, businessName: o.businessName } : undefined;
}
