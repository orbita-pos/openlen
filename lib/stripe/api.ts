// lib/stripe/api.ts — STRIPE'S REST API FROM OUR SERVER (spec local
// 2026-10-21-stripe-integration). With `fetch` and no SDK: the key check, the
// `stripe` command, the copy to live mode and the Payments tab all speak the
// API as the Stripe CLI does, form-encoded, pinned to the version of the
// functions catalog's `stripe` package so Len and the platform see the same API.

export const STRIPE_API_VERSION = "2026-09-30.endive";
export const STRIPE_API_BASE = "https://api.stripe.com";

/** The draft (test mode) or the published site (live mode). Same names as the functions' environments. */
export type StripeEnv = "draft" | "live";
export type StripeFetch = typeof fetch;

function encodeInto(out: string[], key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => encodeInto(out, `${key}[${i}]`, v));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) encodeInto(out, `${key}[${k}]`, v);
    return;
  }
  out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value)).replace(/%20/g, "+")}`);
}

/** `{ a: { b: [1] } }` → `a%5Bb%5D%5B0%5D=1`, in insertion order; null and undefined are left out. */
export function encodeStripeParams(params: Readonly<Record<string, unknown>>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) encodeInto(out, k, v);
  return out.join("&");
}

export interface StripeRequest {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  /** Already form-encoded: the body of a POST, the query string otherwise. */
  readonly form?: string;
  readonly idempotencyKey?: string;
}

export interface StripeResponse {
  readonly status: number;
  readonly text: string;
  readonly json: unknown;
  readonly requestId: string | null;
}

export async function stripeRequest(key: string, req: StripeRequest, f: StripeFetch = fetch): Promise<StripeResponse> {
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, "stripe-version": STRIPE_API_VERSION };
  if (req.idempotencyKey) headers["idempotency-key"] = req.idempotencyKey;
  const withBody = req.method === "POST";
  if (withBody) headers["content-type"] = "application/x-www-form-urlencoded";
  const query = !withBody && req.form ? `?${req.form}` : "";
  const res = await f(`${STRIPE_API_BASE}${req.path}${query}`, {
    method: req.method,
    headers,
    ...(withBody ? { body: req.form ?? "" } : {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json, requestId: res.headers.get("request-id") };
}

export class StripeApiError extends Error {
  readonly status: number;
  readonly type: string | null;
  readonly code: string | null;
  readonly requestId: string | null;
  constructor(status: number, body: unknown, requestId: string | null) {
    const e = (body && typeof body === "object" ? (body as { error?: Record<string, unknown> }).error : undefined) ?? {};
    super(typeof e.message === "string" ? e.message : `Stripe answered ${status}`);
    this.name = "StripeApiError";
    this.status = status;
    this.type = typeof e.type === "string" ? e.type : null;
    this.code = typeof e.code === "string" ? e.code : null;
    this.requestId = requestId;
  }
}

/** One call whose answer we need: the parsed body on 2xx, a StripeApiError otherwise. */
export async function stripeCall<T>(
  key: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params?: Readonly<Record<string, unknown>>,
  o: { readonly idempotencyKey?: string; readonly f?: StripeFetch } = {},
): Promise<T> {
  const r = await stripeRequest(key, { method, path, ...(params ? { form: encodeStripeParams(params) } : {}), ...(o.idempotencyKey ? { idempotencyKey: o.idempotencyKey } : {}) }, o.f);
  if (r.status < 200 || r.status >= 300) throw new StripeApiError(r.status, r.json, r.requestId);
  return r.json as T;
}
