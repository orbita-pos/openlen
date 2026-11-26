// lib/agent/code-mode/enabled.ts — Programmatic Tool Calling (`run_code`) gate.
//
// Active by default in Len Odyssey (`mode === "dynamis"` with terminal enabled),
// off by default in normal Len (`mode === "len"`) so Len's prompt and tool
// declarations stay byte-for-byte identical and every warm KV cache holds.
// Operators can force it off with `OPENLEN_CODE_MODE=0` or opt in with `OPENLEN_CODE_MODE=1`.

import type { AgentMode } from "@/lib/agent/dynamis";
import { terminalEncendida } from "@/lib/agent/terminal/declaracion";

export const RUN_CODE_TOOL = "run_code" as const;

export function codeModeEnabled(
  mode: AgentMode = "len",
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const flag = env.OPENLEN_CODE_MODE?.trim();
  if (flag === "0") return false;
  if (flag === "1") return terminalEncendida(env);
  return mode === "dynamis" && terminalEncendida(env);
}
