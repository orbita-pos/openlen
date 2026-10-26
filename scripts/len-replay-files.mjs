// The test files of Len 3.1's deploy gate (layer 1), in one place: the gate runs them before every
// deploy (len-replay-gate.mjs) and the flaky hunt repeats them shuffled (flaky-hunt.mjs).
export const DEFAULT_FILES = [
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
  "lib/agent/compaction/restore-files.test.ts",
  "lib/agent/compaction/manual.test.ts",
];
