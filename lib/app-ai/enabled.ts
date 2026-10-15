// lib/app-ai/enabled.ts — IS THE AI OF THE APPS ON? Only on top of the Edge
// Functions (spec local 2026-10-15, 4.2): without them nobody can call it and
// Len's manual doesn't offer it. `OPENLEN_APP_AI=0` turns it off at once.

import { functionsEnabledIn } from "@/lib/functions/enabled";

export function appAiEnabledIn(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return functionsEnabledIn(env) && env.OPENLEN_APP_AI !== "0";
}
