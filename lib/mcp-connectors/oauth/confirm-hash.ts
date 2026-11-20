// THE ONE-TIME TOKEN OF A PHONE SIGN-IN'S CONFIRM FORM (spec local 2026-11-17-oauth-de-conectores-mcp, final review F5):
// what is stored is its SHA-256, never the token — the page's form is the only place the token itself lives.
import { createHash } from "node:crypto";

export function confirmHashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
