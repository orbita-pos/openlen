// lib/app-ai/request.ts — WHAT THE GATEWAY TAKES: a STRICT subset of OpenAI's
// Chat Completions (spec local 2026-10-15, 4.2). Anything else is a 400 that
// names the field: an app must never depend on a parameter that is silently
// ignored today and behaves differently tomorrow, and nothing that isn't
// delivered may be charged. Text only in v1.
//
// Two planned deviations (plan 2026-10-15): `top_p`, `stop` and `seed` are not
// supported (the Fireworks client shared with Len doesn't carry them), and a
// `json_schema` response format is sent as a plain JSON object (Fireworks'
// strict mode rejects valid schemas, measured): JSON is guaranteed, the schema
// is not enforced.

import type { AppAiErrorCode } from "./errors";
import { MAX_TOKENS_CEILING, appAiModel, type AppAiModelSpec } from "./models";

export interface ParsedMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface ParsedChatRequest {
  readonly model: AppAiModelSpec;
  readonly messages: readonly ParsedMessage[];
  readonly stream: boolean;
  readonly includeUsage: boolean;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly jsonObject: boolean;
}

export type ParseResult =
  | { readonly ok: true; readonly request: ParsedChatRequest }
  | { readonly ok: false; readonly code: AppAiErrorCode; readonly message: string; readonly param: string | null };

const ALLOWED = new Set(["model", "messages", "stream", "stream_options", "max_tokens", "max_completion_tokens", "temperature", "response_format", "user"]);
const MESSAGE_KEYS = new Set(["role", "content", "name"]);
const MAX_MESSAGES = 500;
/** OpenAI's default. */
const DEFAULT_TEMPERATURE = 1;

type Failure = Extract<ParseResult, { ok: false }>;

const bad = (message: string, param: string | null = null): Failure => ({ ok: false, code: "invalid_request", message, param });
const unsupported = (param: string, message = `"${param}" is not supported yet`): Failure => ({ ok: false, code: "unsupported_parameter", message, param });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function roleOf(raw: unknown): ParsedMessage["role"] | null {
  if (raw === "system" || raw === "developer") return "system";
  if (raw === "user") return "user";
  if (raw === "assistant") return "assistant";
  return null;
}

function messageText(content: unknown, at: string): string | Failure {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return bad("content must be a string or a list of text parts", at);
  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part) || typeof part.type !== "string") return bad("each content part needs a type", at);
    if (part.type !== "text") return unsupported(at, "Only text parts are supported yet");
    if (typeof part.text !== "string") return bad("a text part needs its text", at);
    parts.push(part.text);
  }
  return parts.join("\n");
}

export function parseChatRequest(raw: string): ParseResult {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return bad("The body is not valid JSON");
  }
  if (!isRecord(body)) return bad("The body must be a JSON object");
  for (const k of Object.keys(body)) if (!ALLOWED.has(k)) return unsupported(k);

  if (typeof body.model !== "string" || body.model === "") return bad("model is required", "model");
  const model = appAiModel(body.model);
  if (!model) return { ok: false, code: "model_not_found", message: `The model "${body.model}" does not exist: use openlen-fast or openlen-smart`, param: "model" };

  if (!Array.isArray(body.messages) || body.messages.length === 0) return bad("messages must be a non-empty list", "messages");
  if (body.messages.length > MAX_MESSAGES) return bad(`messages can have up to ${MAX_MESSAGES} entries`, "messages");
  const messages: ParsedMessage[] = [];
  for (const [i, m] of (body.messages as unknown[]).entries()) {
    const at = `messages[${i}]`;
    if (!isRecord(m)) return bad("each message must be an object", at);
    for (const k of Object.keys(m)) if (!MESSAGE_KEYS.has(k)) return unsupported(`${at}.${k}`);
    const role = roleOf(m.role);
    if (!role) return typeof m.role === "string" ? unsupported(`${at}.role`, `The role "${m.role}" is not supported yet`) : bad("role is required", `${at}.role`);
    const text = messageText(m.content, `${at}.content`);
    if (typeof text !== "string") return text;
    messages.push({ role, content: text });
  }

  if (body.stream !== undefined && typeof body.stream !== "boolean") return bad("stream must be true or false", "stream");
  let includeUsage = false;
  if (body.stream_options !== undefined) {
    const so = body.stream_options;
    if (!isRecord(so)) return bad("stream_options must be an object", "stream_options");
    for (const k of Object.keys(so)) if (k !== "include_usage") return unsupported(`stream_options.${k}`);
    if (so.include_usage !== undefined && typeof so.include_usage !== "boolean") return bad("include_usage must be true or false", "stream_options.include_usage");
    includeUsage = so.include_usage === true;
  }

  let maxTokens = model.defaultMaxTokens;
  const maxParam = body.max_completion_tokens !== undefined && body.max_completion_tokens !== null ? "max_completion_tokens" : "max_tokens";
  const rawMax = body[maxParam];
  if (rawMax !== undefined && rawMax !== null) {
    if (typeof rawMax !== "number" || !Number.isInteger(rawMax) || rawMax < 1) return bad(`${maxParam} must be a positive whole number`, maxParam);
    if (rawMax > MAX_TOKENS_CEILING) return bad(`${maxParam} can be at most ${MAX_TOKENS_CEILING}`, maxParam);
    maxTokens = rawMax;
  }

  let temperature = DEFAULT_TEMPERATURE;
  if (body.temperature !== undefined && body.temperature !== null) {
    if (typeof body.temperature !== "number" || !(body.temperature >= 0 && body.temperature <= 2)) return bad("temperature must be between 0 and 2", "temperature");
    temperature = body.temperature;
  }

  let jsonObject = false;
  if (body.response_format !== undefined && body.response_format !== null) {
    const rf = body.response_format;
    if (!isRecord(rf) || typeof rf.type !== "string") return bad("response_format needs a type", "response_format");
    if (rf.type === "json_object" || rf.type === "json_schema") jsonObject = true;
    else if (rf.type !== "text") return unsupported("response_format.type", `The response format "${rf.type}" is not supported`);
  }

  if (body.user !== undefined && typeof body.user !== "string") return bad("user must be a string", "user");

  return { ok: true, request: { model, messages, stream: body.stream === true, includeUsage, maxTokens, temperature, jsonObject } };
}
