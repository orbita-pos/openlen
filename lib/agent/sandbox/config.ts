// Whether the real terminal is on, and with what (spec local 2026-10-21-real-terminal-e2b, §8–§9).
// Off by the switch (`OPENLEN_SANDBOX=0`), without a key, or with Len's terminal itself off: then
// every turn uses today's terminal and nothing says so, because it is off on purpose.

import { terminalEncendida } from "@/lib/agent/terminal/declaracion";

/** The E2B template the boxes start from (infra/e2b/openlen-terminal). A new template is a new name. */
// v3 (spec local 2026-10-26-len-skills): LibreOffice and the office Python packages.
// v4 (spec local 2026-10-27-len-pdf-skill): qpdf, tesseract, CJK fonts and the PDF Python packages.
export const SANDBOX_TEMPLATE = "openlen-terminal-v5";

/** OpenLen's daily cap on all E2B spend, in dollars, unless the box sets another. */
export const DEFAULT_SANDBOX_DAILY_USD = 5;

export interface SandboxConfig {
  readonly apiKey: string;
  readonly template: string;
  readonly dailyUsd: number;
  /** Accounts that get the box whatever their plan (`OPENLEN_SANDBOX_ONLY_USERS`, test ones); `null` = none. */
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

/** Whether an owner gets the box: on a paid plan (Jesús, 05/11, spec local 2026-11-05-modo-juego-design, §11:
 *  the owner pays it per second; Free credits would be OpenLen's), or on `OPENLEN_SANDBOX_ONLY_USERS`. */
export function ownerGetsTheBox(config: SandboxConfig, userId: string, ownerPaid: boolean): boolean {
  return ownerPaid || config.onlyUsers?.includes(userId) === true;
}

/** Whether the turns of the project's owner `userId` get the box (as terminalForTurn decides, ./choose.ts):
 *  the box on, and `ownerGetsTheBox`. What Len is told about its terminal —bash's description, the manual—
 *  follows this. Without a person (scripts, Len-Bench, the MCP docs), nobody. */
export function realTerminalFor(
  userId: string | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
  /** The project OWNER's plan is paid (the route reads it once per turn). */
  ownerPaid = false,
): boolean {
  const config = sandboxConfig(env);
  if (!config || typeof userId !== "string") return false;
  return ownerGetsTheBox(config, userId, ownerPaid);
}
