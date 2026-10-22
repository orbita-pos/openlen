// lib/project-email/enabled.ts — THE SWITCH (spec local 2026-10-22-email-integration,
// 6.11): on with the key of OpenLen's customers' Resend account, which is NOT
// `RESEND_API_KEY` (that one is OpenLen's own email and stays apart, spec 0.7).
// `OPENLEN_EMAIL=0` turns it all off.

export function emailEnabledIn(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.OPENLEN_EMAIL?.trim() === "0") return false;
  return Boolean(env.RESEND_CLIENTS_API_KEY?.trim());
}
