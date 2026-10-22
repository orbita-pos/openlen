// lib/project-email/function-env.ts — WHAT A PROJECT'S FUNCTIONS GET FOR EMAIL (spec
// local 2026-10-22-email-integration, 5): the Resend SDK reads RESEND_API_KEY and
// RESEND_BASE_URL, so `new Resend(Deno.env.get("RESEND_API_KEY"))` lands on the
// project's /email/v1 gateway with its own secret key. OPENLEN_EMAIL_FROM is the
// verified address, only once the domain is ready. A user who saved their own
// RESEND_API_KEY keeps it: OpenLen sets neither. Pure.

import type { EmailDomainRow } from "./types";

export function emailFunctionEnv(o: {
  enabled: boolean;
  /** The URL of that environment (the draft's own, or the published one). */
  envUrl: string;
  secretKey: string;
  userSecrets: Readonly<Record<string, string>>;
  domain: Pick<EmailDomainRow, "status" | "sendingHost"> | null;
}): Record<string, string> {
  if (!o.enabled || o.userSecrets.RESEND_API_KEY) return {};
  return {
    RESEND_API_KEY: o.secretKey,
    RESEND_BASE_URL: `${o.envUrl.replace(/\/+$/, "")}/email/v1`,
    ...(o.domain?.status === "ready" ? { OPENLEN_EMAIL_FROM: `noreply@${o.domain.sendingHost}` } : {}),
  };
}
