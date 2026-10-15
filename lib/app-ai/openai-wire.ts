// lib/app-ai/openai-wire.ts — THE ANSWERS IN OPENAI'S SHAPE (spec local
// 2026-10-15, 4.2): a `chat.completion`, or its stream of
// `chat.completion.chunk` events ending in `data: [DONE]`. `model` is always
// the alias, never the provider's id, so no app depends on it. Pure.

import type { FireworksStopReason } from "@/lib/ai/fireworks-stream-client";

import { appAiErrorBody, type AppAiErrorCode } from "./errors";
import type { AppAiModelSpec } from "./models";

export type FinishReason = "stop" | "length";

export interface WireUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens: number;
}

export interface WireHead {
  readonly id: string;
  readonly created: number;
  readonly model: string;
}

export const completionId = (): string => `chatcmpl-${crypto.randomUUID().replace(/-/g, "")}`;

/** A clean end has one; a cut or an error doesn't. */
export function finishReasonOf(stop: FireworksStopReason): FinishReason | null {
  if (stop.kind === "end_turn") return "stop";
  if (stop.kind === "max_tokens") return "length";
  return null;
}

export function wireUsage(o: { readonly inputTokens: number; readonly outputTokens: number }): WireUsage {
  return { prompt_tokens: o.inputTokens, completion_tokens: o.outputTokens, total_tokens: o.inputTokens + o.outputTokens };
}

const sse = (data: unknown): string => `data: ${JSON.stringify(data)}\n\n`;

const chunk = (h: WireHead, delta: Record<string, unknown>, finish: FinishReason | null): string =>
  sse({ id: h.id, object: "chat.completion.chunk", created: h.created, model: h.model, choices: [{ index: 0, delta, finish_reason: finish }] });

export const firstChunk = (h: WireHead): string => chunk(h, { role: "assistant", content: "" }, null);
export const textChunk = (h: WireHead, text: string): string => chunk(h, { content: text }, null);
export const finishChunk = (h: WireHead, finish: FinishReason): string => chunk(h, {}, finish);
export const usageChunk = (h: WireHead, usage: WireUsage): string =>
  sse({ id: h.id, object: "chat.completion.chunk", created: h.created, model: h.model, choices: [], usage });
export const DONE = "data: [DONE]\n\n";
export const errorEvent = (code: AppAiErrorCode, message?: string): string => sse(appAiErrorBody(code, message === undefined ? {} : { message }));

export function completion(o: WireHead & { readonly content: string; readonly finishReason: FinishReason; readonly usage: WireUsage }) {
  return {
    id: o.id,
    object: "chat.completion",
    created: o.created,
    model: o.model,
    choices: [{ index: 0, message: { role: "assistant", content: o.content, refusal: null }, logprobs: null, finish_reason: o.finishReason }],
    usage: o.usage,
  };
}

export function modelList(models: readonly AppAiModelSpec[]) {
  return { object: "list", data: models.map((m) => ({ id: m.id, object: "model", created: 0, owned_by: "openlen" })) };
}
