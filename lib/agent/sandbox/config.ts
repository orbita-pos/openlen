// Whether the real terminal is on, and with what (spec local 2026-10-21-real-terminal-e2b, §8–§9).
// Off by the switch (`OPENLEN_SANDBOX=0`), without a key, or with Len's terminal itself off: then
// every turn uses today's terminal and nothing says so, because it is off on purpose.

import { terminalEncendida } from "@/lib/agent/terminal/declaracion";

/** The E2B template the boxes start from (infra/e2b/openlen-terminal). A new template is a new name. */
// v3 (spec local 2026-10-26-len-skills): LibreOffice and the office Python packages.
export const SANDBOX_TEMPLATE = "openlen-terminal-v3";

/** OpenLen's daily cap on all E2B spend, in dollars, unless the box sets another. */
export const DEFAULT_SANDBOX_DAILY_USD = 5;

export interface SandboxConfig {
  readonly apiKey: string;
  readonly template: string;
  readonly dailyUsd: number;
  /** Only these accounts get the box (`OPENLEN_SANDBOX_ONLY_USERS`); `null` = everyone. */
  readonly onlyUsers: readonly string[] | null;
}

export function sandboxConfig(env: Readonly<Record<string, string | undefined>> = process.env): SandboxConfig | null {
  if (env.OPENLEN_SANDBOX === "0" || !terminalEncendida(env)) return null;
  const apiKey = env.E2B_API_KEY?.trim();
  if (!apiKey) return null;
  const cap = Number(env.OPENLEN_SANDBOX_DAILY_USD);
  const dailyUsd = env.OPENLEN_SANDBOX_DAILY_USD !== undefined && Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_SANDBOX_DAILY_USD;
  const users = (env.OPENLEN_SANDBOX_ONLY_USERS ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  return { apiKey, template: SANDBOX_TEMPLATE, dailyUsd, onlyUsers: users.length > 0 ? users : null };
}

/** Whether the turns of the project's owner `userId` get the box: on, and during a rollout, on its list
 *  (as terminalForTurn decides, ./choose.ts). What Len is told about its terminal —bash's description,
 *  the manual— follows this. Without a person (scripts, Len-Bench, the MCP docs), only with no rollout. */
export function realTerminalFor(userId: string | null | undefined, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const config = sandboxConfig(env);
  if (!config) return false;
  return config.onlyUsers === null || (typeof userId === "string" && config.onlyUsers.includes(userId));
}
