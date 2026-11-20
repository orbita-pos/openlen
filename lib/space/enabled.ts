// AGENTS FOR EVERYONE (spec local 2026-11-19-agentes-para-todos): on unless OPENLEN_AGENTS is exactly "0" — and only
// with the person's own assistant on, since every agent is one.
import { assistantsEnabled } from "@/lib/assistants/enabled";

export function agentsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_AGENTS !== "0" && assistantsEnabled(env);
}
