// CREDENTIAL TEMPLATES (spec local 2026-11-06-conectores-mcp, §5.2): DeepSeek's `${credential:REF}` in a connector's
// url and header values. The value lives apart, encrypted (credentials.ts); here it is only substituted at the moment
// of connecting, and every resolved value — plain and URL-encoded, as DeepSeek's mcp-client redacts — is replaced by
// `[redacted]` in whatever text could reach the model. Pure.
import type { McpServerEntry } from "./config";

export const CREDENTIAL_NAME = /^[A-Z0-9_]{1,64}$/;
/** A well-formed reference. */
export const CREDENTIAL_REF = /\$\{credential:([A-Z0-9_]{1,64})\}/g;
/** Anything that starts like a reference: a malformed one is caught by comparing with the well-formed ones. */
export const CREDENTIAL_START = /\$\{credential:/g;

export function credentialRefs(text: string): string[] {
  return [...new Set([...text.matchAll(CREDENTIAL_REF)].map((m) => m[1]!))].sort();
}

/** Every reference starts a well-formed one. */
export function referencesWellFormed(text: string): boolean {
  return (text.match(CREDENTIAL_START) ?? []).length === (text.match(CREDENTIAL_REF) ?? []).length;
}

export function credentialRefsOf(e: Pick<McpServerEntry, "url" | "headers">): string[] {
  return credentialRefs([e.url, ...Object.values(e.headers)].join("\n"));
}

export function resolveEntry(
  e: Pick<McpServerEntry, "url" | "headers">,
  values: ReadonlyMap<string, string>,
): { ok: true; url: string; headers: Record<string, string>; resolved: string[] } | { ok: false; missing: string[] } {
  const missing = credentialRefsOf(e).filter((n) => !values.has(n));
  if (missing.length > 0) return { ok: false, missing };
  const resolved: string[] = [];
  const sub = (s: string) =>
    s.replace(CREDENTIAL_REF, (_, name: string) => {
      const v = values.get(name)!;
      resolved.push(v);
      return v;
    });
  const url = sub(e.url);
  const headers = Object.fromEntries(Object.entries(e.headers).map(([k, v]) => [k, sub(v)]));
  return { ok: true, url, headers, resolved: [...new Set(resolved)] };
}

export function makeRedactor(values: readonly string[]): (text: string) => string {
  const forms = [...new Set(values.filter((v) => v.length > 0).flatMap((v) => [v, encodeURIComponent(v)]))].sort((a, b) => b.length - a.length);
  if (forms.length === 0) return (text) => text;
  return (text) => forms.reduce((t, f) => t.split(f).join("[redacted]"), text);
}
