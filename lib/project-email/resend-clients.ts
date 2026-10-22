// lib/project-email/resend-clients.ts — OPENLEN'S CUSTOMERS' RESEND ACCOUNT (spec
// local 2026-10-22-email-integration, 0.7 and 6.1): a separate account from the
// one OpenLen's own email uses, so a customer's abuse can never take that down.
// With `fetch` and no SDK, as lib/stripe/api.ts: it's tested with a fake fetch,
// and the bodies and errors are Resend's REST API as documented.

import type { DnsRecord } from "./types";

export const RESEND_API_BASE = "https://api.resend.com";

export interface ResendError {
  readonly statusCode: number;
  readonly name: string;
  readonly message: string;
}

/** The fields of Resend's POST /emails that project email uses. */
export type ResendEmail = {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string[];
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
};

export interface ResendClients {
  createDomain(name: string): Promise<{ id: string; records: DnsRecord[]; status: string }>;
  /** null when Resend no longer has it (404). */
  getDomain(id: string): Promise<{ status: string; records: DnsRecord[] } | null>;
  verifyDomain(id: string): Promise<void>;
  deleteDomain(id: string): Promise<void>;
  send(payload: ResendEmail, idempotencyKey?: string): Promise<{ id: string } | { error: ResendError }>;
}

type Raw = { status: number; json: unknown };

function asError(r: Raw): ResendError {
  const j = (r.json ?? {}) as Partial<ResendError>;
  return {
    statusCode: typeof j.statusCode === "number" ? j.statusCode : r.status,
    name: typeof j.name === "string" ? j.name : "application_error",
    message: typeof j.message === "string" ? j.message : `Resend answered ${r.status}`,
  };
}

/** Resend's SPF and DKIM records, as the owner copies them (no Receiving nor Tracking: we only send). */
function dnsRecords(raw: unknown): DnsRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: DnsRecord[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (r.record !== "SPF" && r.record !== "DKIM") continue;
    if ((r.type !== "TXT" && r.type !== "MX") || typeof r.name !== "string" || typeof r.value !== "string") continue;
    // A TXT value in quotes: the provider adds its own.
    const value = r.type === "TXT" ? r.value.replace(/^"(.*)"$/s, "$1") : r.value;
    out.push({ type: r.type, name: r.name, value, ...(typeof r.priority === "number" ? { priority: r.priority } : {}) });
  }
  return out;
}

export function resendClients(apiKey: string, f: typeof fetch = fetch): ResendClients {
  async function call(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, idempotencyKey?: string): Promise<Raw> {
    const headers: Record<string, string> = { authorization: `Bearer ${apiKey}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    const res = await f(`${RESEND_API_BASE}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }
  const ok = (r: Raw) => r.status >= 200 && r.status < 300;
  const orThrow = (r: Raw) => {
    if (!ok(r)) throw new Error(asError(r).message);
  };

  return {
    async createDomain(name) {
      const r = await call("POST", "/domains", { name, custom_return_path: "send" });
      orThrow(r);
      const j = r.json as { id: string; status: string; records: unknown };
      return { id: j.id, status: j.status, records: dnsRecords(j.records) };
    },
    async getDomain(id) {
      const r = await call("GET", `/domains/${encodeURIComponent(id)}`);
      if (r.status === 404) return null;
      orThrow(r);
      const j = r.json as { status: string; records: unknown };
      return { status: j.status, records: dnsRecords(j.records) };
    },
    async verifyDomain(id) {
      orThrow(await call("POST", `/domains/${encodeURIComponent(id)}/verify`));
    },
    async deleteDomain(id) {
      orThrow(await call("DELETE", `/domains/${encodeURIComponent(id)}`));
    },
    async send(payload, idempotencyKey) {
      const r = await call("POST", "/emails", payload, idempotencyKey);
      if (!ok(r)) return { error: asError(r) };
      return { id: String((r.json as { id?: unknown })?.id ?? "") };
    },
  };
}
