// npm run len-replay:gate — the deploy gate of Len 3.1's layer 1 (spec local
// 2026-10-24-len-3-1-layers-0-1, §5.6). Before every deploy:
//   1. every test file of the list must exist (vitest silently ignores a
//      missing one, which is how a gate goes dark);
//   2. the real production scenes are downloaded again, read-only
//      (scripts/fetch-replay-scenes.ts) — a failure stops the deploy;
//   3. vitest runs exactly those files with OPENLEN_GATE=1, so a scene that is
//      missing fails instead of being skipped.
// Exits with the first failing step's code. No model, no database, $0.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const DEFAULT_FILES = [
  "lib/agent/testing/replay-invariant.test.ts",
  "lib/agent/loop.test.ts",
  "lib/agent/context.test.ts",
  "lib/agent/replay-scenes/replay-scenes.test.ts",
  "components/workspace-v2/chat/chat-scenes.test.tsx",
  "lib/agent/brain-faults.test.ts",
  "lib/agent/telemetry/request-fingerprint.test.ts",
  "lib/agent/telemetry/cache-break.test.ts",
  "lib/agent/telemetry/step-signals.test.ts",
  "lib/agent/telemetry/step-store.test.ts",
  "lib/agent/telemetry/step-recorder.test.ts",
  "lib/agent/telemetry/request-diff.test.ts",
  "lib/agent/telemetry/cache-suspects.test.ts",
];

const files = process.env.LEN_REPLAY_GATE_FILES ? process.env.LEN_REPLAY_GATE_FILES.split(",").map((f) => f.trim()).filter(Boolean) : DEFAULT_FILES;
const missing = files.filter((f) => !existsSync(f));
if (missing.length > 0) {
  console.error(`len-replay:gate — missing test file(s): ${missing.join(", ")}`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const run = (args, env = {}) => spawnSync(process.execPath, args, { stdio: "inherit", env: { ...process.env, ...env } });

if (process.env.LEN_REPLAY_GATE_SKIP_FETCH !== "1") {
  const fetched = run([require.resolve("tsx/cli"), "--tsconfig", "tsconfig.eval.json", "scripts/fetch-replay-scenes.ts"]);
  if (fetched.status !== 0) {
    console.error("len-replay:gate — could not download the replay scenes (ssh openlen); the reason is right above");
    process.exit(fetched.status || 1);
  }
}

const config = process.env.LEN_REPLAY_GATE_VITEST_CONFIG;
const tested = run([require.resolve("vitest/vitest.mjs"), "run", ...(config ? ["--config", config] : []), ...files], { OPENLEN_GATE: "1" });
process.exit(tested.status ?? 1);
