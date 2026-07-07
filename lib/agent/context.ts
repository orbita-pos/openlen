// lib/agent/context.ts — builds the per-turn context block the agent route
// injects as the first user message (state + brief + tagged document).
//
// Pure string building, zero I/O, zero native imports — the route feeds it
// server-read state (summarizeProjectState) and the already-tagged HTML
// (tagWithOpIds); this module just formats. Keeping it import-free of
// @/lib/html-engine (native) and @/lib/db lets context.test.ts run under
// vitest without the native bindings being loadable.

export function buildAgentContext(args: {
  state: Record<string, unknown>;
  taggedHtml: string;
  userBrief: string | null;
}): string {
  const brief = (args.userBrief ?? "").trim();
  const briefBlock = brief
    ? `PROJECT BRIEF (persistente — aplica a toda petición):\n${brief}\n\n`
    : "";
  return `ESTADO DEL PROYECTO (real, leído del servidor ahora mismo):\n${JSON.stringify(args.state, null, 2)}\n\n${briefBlock}DOCUMENTO ACTUAL (cada elemento trae data-op-id inyectado por el servidor — usa esos ids en editar_pagina):\n\n${args.taggedHtml}`;
}

/** Rough chars→tokens estimate (~3.5 chars/token on tag-dense HTML + JSON),
 *  used as a pre-flight size guard before the route ships a turn upstream. */
export function estimateContextTokens(userContent: string, systemPrompt: string): number {
  return Math.ceil((userContent.length + systemPrompt.length) / 3.5);
}
