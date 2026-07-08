// lib/agent/context.ts — builds the per-turn context block the agent route
// injects as the first user message (state + brief + tagged document), plus
// buildAgentMessages, the single message-assembly path both the route AND the
// eval harness (F3 Task 6) consume so a turn is byte-identical either way.
//
// Pure string building, zero I/O, zero native imports — the caller feeds it
// server-read state (summarizeProjectState) and the already-tagged HTML
// (tagWithOpIds); this module just formats. Keeping it import-free of
// @/lib/html-engine (native) and @/lib/db lets context.test.ts run under
// vitest without the native bindings being loadable. buildAgentSystemPrompt
// (from catalog) is pure TS too — no native — so importing it here keeps that
// invariant.

import type { Message } from "@/lib/ai-gateway";
import { buildAgentSystemPrompt } from "@/lib/agent/catalog";

export function buildAgentContext(args: {
  state: Record<string, unknown>;
  taggedHtml: string;
  userBrief: string | null;
  /** F2 Task 8 — the user attached an image this turn (same shape the route
   *  validates in ai-design: real http(s) URL, optional alt). Present ⇒ the
   *  model is told to place it via editar_pagina using the URL verbatim,
   *  replacing a placeholder if one exists. Absent/omitted ⇒ output is
   *  byte-identical to F1 (pinned by context.test.ts). */
  attachedImage?: { url: string; alt?: string } | null;
  /** F2 Task 8 — a hard-pinned target op-id (scope.path resolved against the
   *  tagged document by the route via resolveOpIdByPath), same semantics as
   *  ai-design's scopePin. Takes priority over scopeHint when both are set. */
  scopePin?: { opId: string; hint: string } | null;
  /** F2 Task 8 — a soft textual scope hint (scope.hint with no resolvable
   *  path). Ignored when scopePin is set. */
  scopeHint?: string | null;
}): string {
  const brief = (args.userBrief ?? "").trim();
  const briefBlock = brief
    ? `PROJECT BRIEF (persistente — aplica a toda petición):\n${brief}\n\n`
    : "";

  let focusBlock = "";
  if (args.scopePin) {
    focusBlock = `FOCO DEL USUARIO (PIN): target="${args.scopePin.opId}" — el usuario señaló este elemento EXACTO (${args.scopePin.hint}). Ancla tu edit principal de editar_pagina en este data-op-id. Solo amplía a hermanos/ancestros cuando la petición del usuario lo implique explícitamente.\n\n`;
  } else if (args.scopeHint) {
    focusBlock = `PISTA DE FOCO DEL USUARIO: el usuario señaló hacia → ${args.scopeHint}. Centra tus cambios ahí si es relevante. Puedes tocar elementos hermanos o relacionados cuando la petición lo implique.\n\n`;
  }

  let imageBlock = "";
  if (args.attachedImage) {
    const altLine = args.attachedImage.alt ? `\nTexto alt: ${args.attachedImage.alt}` : "";
    imageBlock = `IMAGEN ADJUNTA DEL USUARIO: ${args.attachedImage.url}${altLine}\nEsta es una URL de imagen REAL que el usuario adjuntó explícitamente — colócala con editar_pagina usando esta URL EXACTA (verbatim) como src de un <img> (o como CSS background-image). NUNCA inventes ni cambies la URL. Si la página ya tiene un placeholder para esta imagen (un <div> con gradiente, una caja vacía con borde), REEMPLAZA ese elemento completo por el <img> — no lo anides adentro. Incluye siempre texto alt (usa el del usuario si lo dio; si no, infiérelo del contexto).\n\n`;
  }

  return `ESTADO DEL PROYECTO (real, leído del servidor ahora mismo):\n${JSON.stringify(args.state, null, 2)}\n\n${briefBlock}${focusBlock}${imageBlock}DOCUMENTO ACTUAL (cada elemento trae data-op-id inyectado por el servidor — usa esos ids en editar_pagina):\n\n${args.taggedHtml}`;
}

/** Rough chars→tokens estimate (~3.5 chars/token on tag-dense HTML + JSON),
 *  used as a pre-flight size guard before the route ships a turn upstream. */
export function estimateContextTokens(userContent: string, systemPrompt: string): number {
  return Math.ceil((userContent.length + systemPrompt.length) / 3.5);
}

export interface BuildAgentMessagesArgs {
  /** summarizeProjectState(...) output — the caller computes it (it needs the
   *  DB row); this module stays free of @/lib/agent/tools' native imports. */
  state: Record<string, unknown>;
  /** tagWithOpIds(html).taggedHtml — computed by the caller (native). */
  taggedHtml: string;
  userBrief: string | null;
  /** The user's turn prompt (already trimmed/validated by the caller). */
  prompt: string;
  /** Prior turns, ALREADY hardened to {role, content} + capped by the caller
   *  (the route slices to 6 + 4000 chars; the harness passes []). */
  history: { role: "user" | "assistant"; content: string }[];
  attachedImage?: { url: string; alt?: string } | null;
  scopePin?: { opId: string; hint: string } | null;
  scopeHint?: string | null;
  /** Pre-flight size ceiling; over it → { ok:false, reason:"too_large" }. */
  maxPromptTokens: number;
}

export type BuildAgentMessagesResult =
  | { ok: true; messages: Message[]; systemPrompt: string; contextBlock: string }
  | { ok: false; reason: "too_large" };

/** Assemble the exact message array an agent turn ships upstream: system
 *  prompt, the context block (state + brief + tagged doc + optional image/scope
 *  blocks), a fixed synthetic assistant ack, the prior history, then the user
 *  prompt. Shared by app/api/agent/route.ts and the eval harness so a turn is
 *  byte-identical whichever entry point built it. Applies the same pre-flight
 *  size guard the route used inline (413 on overflow). */
export function buildAgentMessages(args: BuildAgentMessagesArgs): BuildAgentMessagesResult {
  const systemPrompt = buildAgentSystemPrompt();
  const contextBlock = buildAgentContext({
    state: args.state,
    taggedHtml: args.taggedHtml,
    userBrief: args.userBrief,
    attachedImage: args.attachedImage,
    scopePin: args.scopePin,
    scopeHint: args.scopeHint,
  });
  const historyText = args.history.map((h) => h.content).join("\n");
  if (estimateContextTokens(contextBlock + historyText + args.prompt, systemPrompt) > args.maxPromptTokens) {
    return { ok: false, reason: "too_large" };
  }
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: contextBlock },
    { role: "assistant", content: "Entendido. Tengo el estado y el documento. ¿Qué hacemos?" },
    ...args.history,
    { role: "user", content: args.prompt },
  ];
  return { ok: true, messages, systemPrompt, contextBlock };
}
