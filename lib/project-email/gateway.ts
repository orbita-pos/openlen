// lib/project-email/gateway.ts — `<project URL>/email/v1` (spec local
// 2026-10-22-email-integration, 6.3): Resend's API, the part a project's Edge
// Functions use (`POST /emails`, `POST /emails/batch`), so `new Resend(key)`
// with OpenLen's RESEND_BASE_URL works as it always does. Called by the
// functions with the project's secret key, never by the browser (the
// publishable key is refused), like /ai/v1. Every email goes through the
// sending core; the errors are Resend's (resend.com/docs/api-reference/errors).

import { hashSecretKey } from "@/lib/backend/keys";

import type { ResendEmail, ResendError } from "./resend-clients";
import { sendProjectEmail, type SendDeps, type SendOutcome } from "./send";

export interface EmailGatewayDeps extends SendDeps {
  enabled(): boolean;
  /** The project and environment behind the request's host. */
  resolve(req: Request): Promise<{ projectId: string; environment: "draft" | "live"; secretKeyHash: string } | null>;
}

const MAX_BATCH = 100;
/** Resend's fields this gateway doesn't take (transactional, one recipient at a time, no attachments). */
const UNSUPPORTED = ["attachments", "cc", "bcc", "scheduled_at", "template", "topic_id"] as const;

function errorResponse(e: ResendError, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(e), { status: e.statusCode, headers: { "content-type": "application/json", ...headers } });
}
const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
const fieldError = (message: string): ResendError => ({ statusCode: 400, name: "validation_error", message });

function keyOf(req: Request): string | null {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization")?.trim() ?? "")?.[1]?.trim();
  return bearer || req.headers.get("apikey")?.trim() || null;
}

const list = (v: unknown): string[] | undefined => (v === undefined || v === null ? undefined : (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string"));

/** A Resend API body → the core's email, or the field that isn't taken. */
function toEmail(raw: unknown): ResendEmail | ResendError {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fieldError("An error was found with one or more fields in the request.");
  const b = raw as Record<string, unknown>;
  for (const f of UNSUPPORTED) {
    if (b[f] !== undefined && b[f] !== null) return fieldError(`\`${f}\` isn't supported here: project email is transactional and goes to each recipient on its own.`);
  }
  const headers = b.headers && typeof b.headers === "object" && !Array.isArray(b.headers) ? Object.fromEntries(Object.entries(b.headers as Record<string, unknown>).filter(([, v]) => typeof v === "string") as [string, string][]) : undefined;
  const tags = Array.isArray(b.tags) ? (b.tags as unknown[]).filter((t): t is { name: string; value: string } => !!t && typeof (t as { name?: unknown }).name === "string" && typeof (t as { value?: unknown }).value === "string") : undefined;
  const replyTo = list(b.reply_to);
  return {
    from: typeof b.from === "string" ? b.from : "",
    to: list(b.to) ?? [],
    subject: typeof b.subject === "string" ? b.subject : "",
    ...(typeof b.html === "string" ? { html: b.html } : {}),
    ...(typeof b.text === "string" ? { text: b.text } : {}),
    ...(replyTo && replyTo.length > 0 ? { reply_to: replyTo } : {}),
    ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
  };
}

const isError = (x: ResendEmail | ResendError): x is ResendError => "statusCode" in x;

export async function handleEmailRequest(req: Request, deps: EmailGatewayDeps): Promise<Response> {
  if (!deps.enabled()) return errorResponse({ statusCode: 503, name: "service_unavailable", message: "API is temporarily unavailable" });
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const batch = /\/email\/v1\/emails\/batch$/.test(path);
  if (!batch && !/\/email\/v1\/emails$/.test(path)) return errorResponse({ statusCode: 404, name: "not_found", message: "The requested endpoint does not exist." });
  if (req.method !== "POST") return errorResponse({ statusCode: 405, name: "method_not_allowed", message: "Method is not allowed for the requested path." });

  const key = keyOf(req);
  if (!key) return errorResponse({ statusCode: 401, name: "missing_api_key", message: "Missing API Key" });
  const project = await deps.resolve(req);
  if (!project) return errorResponse({ statusCode: 404, name: "not_found", message: "The requested endpoint does not exist." });
  if (!key.startsWith("sb_secret_") || hashSecretKey(key) !== project.secretKeyHash) return errorResponse({ statusCode: 401, name: "validation_error", message: "API key is invalid" });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(fieldError("An error was found with one or more fields in the request."));
  }
  const idem = req.headers.get("idempotency-key")?.trim() || undefined;
  const send = (email: ResendEmail, idempotencyKey?: string): Promise<SendOutcome> =>
    sendProjectEmail({ projectId: project.projectId, environment: project.environment, kind: "app", email, ...(idempotencyKey ? { idempotencyKey } : {}) }, deps);

  if (!batch) {
    const email = toEmail(body);
    if (isError(email)) return errorResponse(email);
    const r = await send(email, idem);
    if (r.kind === "rejected") return errorResponse(r.error);
    return json({ id: r.id }, r.kind === "not_sent_draft" ? { "x-openlen-email": "not-sent-draft" } : {});
  }

  if (!Array.isArray(body) || body.length === 0 || body.length > MAX_BATCH) return errorResponse(fieldError(`A batch is an array of 1 to ${MAX_BATCH} emails.`));
  const emails = body.map(toEmail);
  const bad = emails.find(isError);
  if (bad) return errorResponse(bad);
  const data: { id: string }[] = [];
  let draft = false;
  for (const [n, email] of (emails as ResendEmail[]).entries()) {
    const r = await send(email, idem ? `${idem}:${n}` : undefined);
    if (r.kind === "rejected") return errorResponse(r.error);
    if (r.kind === "not_sent_draft") draft = true;
    data.push({ id: r.id });
  }
  return json({ data }, draft ? { "x-openlen-email": "not-sent-draft" } : {});
}
