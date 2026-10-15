// lib/app-ai/errors.ts — THE GATEWAY'S ERRORS, shaped like OpenAI's
// (`{ error: { message, type, code, param } }`), so code written for the
// `openai` SDK reads them as usual (spec local 2026-10-15, 4.2). No CORS
// headers on purpose: the gateway is server-only, and a browser must not be
// able to read it even if someone tries.

export type AppAiErrorCode =
  | "invalid_request"
  | "unsupported_parameter"
  | "invalid_api_key"
  | "insufficient_credits"
  | "app_ai_cap_reached"
  | "project_not_found"
  | "model_not_found"
  | "unknown_endpoint"
  | "rate_limit_exceeded"
  | "upstream_error"
  | "app_ai_disabled"
  | "app_ai_busy";

const ERRORS: Record<AppAiErrorCode, readonly [status: number, type: string, message: string]> = {
  invalid_request: [400, "invalid_request_error", "The request is not valid"],
  unsupported_parameter: [400, "invalid_request_error", "This parameter is not supported yet"],
  invalid_api_key: [401, "authentication_error", "This endpoint is server-only: call it from an Edge Function with SUPABASE_SERVICE_ROLE_KEY"],
  insufficient_credits: [402, "insufficient_quota", "The project owner doesn't have enough credits for this request (the worst case of max_tokens is reserved first)"],
  app_ai_cap_reached: [402, "insufficient_quota", "The owner's apps reached their monthly AI limit"],
  project_not_found: [404, "invalid_request_error", "No project answers at this address"],
  model_not_found: [404, "invalid_request_error", "The model does not exist: use openlen-fast or openlen-smart"],
  unknown_endpoint: [404, "invalid_request_error", "Unknown endpoint: this gateway has POST /ai/v1/chat/completions and GET /ai/v1/models"],
  rate_limit_exceeded: [429, "rate_limit_error", "Too many AI requests for this project; try again shortly"],
  upstream_error: [502, "api_error", "The model failed to answer; nothing was charged"],
  app_ai_disabled: [503, "api_error", "AI for apps is not available here"],
  app_ai_busy: [503, "api_error", "AI for free-plan apps is busy today; try again tomorrow"],
};

export function appAiStatus(code: AppAiErrorCode): number {
  return ERRORS[code][0];
}

export function appAiErrorBody(
  code: AppAiErrorCode,
  o: { readonly message?: string; readonly param?: string | null } = {},
): { error: { message: string; type: string; code: AppAiErrorCode; param: string | null } } {
  const [, type, message] = ERRORS[code];
  return { error: { message: o.message ?? message, type, code, param: o.param ?? null } };
}

export function appAiError(
  code: AppAiErrorCode,
  o: { readonly message?: string; readonly param?: string | null; readonly retryAfterSec?: number } = {},
): Response {
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8" };
  if (o.retryAfterSec !== undefined) headers["retry-after"] = String(Math.max(1, Math.ceil(o.retryAfterSec)));
  return new Response(JSON.stringify(appAiErrorBody(code, o)), { status: appAiStatus(code), headers });
}
