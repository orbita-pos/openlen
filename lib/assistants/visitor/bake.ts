// WHAT PUBLISHING BAKES AS THE PAGE'S BUBBLE (spec local 2026-11-06-asistente-propio, §4.4.5; phase 2A): the person's
// own assistant when she is on the page — her name, color and figure —, today's assistant otherwise. Her color and
// shape are checked again here: they go into the published page's markup.
//
// Pure.
import type { AssistantPersona } from "@/lib/publish/assistant-widget";

import { ASSISTANT_SHAPES, type AssistantShape } from "../names";

const DEFAULT_COLOR = "#F4A48B";
const HEX = /^#[0-9a-fA-F]{6}$/;

export interface AssistantBakeChoice {
  enabled: true;
  businessName: string;
  persona?: AssistantPersona;
}

export function assistantBakeOf(o: {
  legacyEnabled: boolean;
  businessName: string;
  onPage: { name: string; color: string; shape: string } | null;
}): AssistantBakeChoice | undefined {
  if (o.onPage) {
    const shape: AssistantShape = (ASSISTANT_SHAPES as readonly string[]).includes(o.onPage.shape) ? (o.onPage.shape as AssistantShape) : "blob";
    return {
      enabled: true,
      businessName: o.businessName,
      persona: { name: o.onPage.name, color: HEX.test(o.onPage.color) ? o.onPage.color : DEFAULT_COLOR, shape },
    };
  }
  return o.legacyEnabled ? { enabled: true, businessName: o.businessName } : undefined;
}
