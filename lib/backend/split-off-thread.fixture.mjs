// lib/backend/split-off-thread.fixture.mjs — a splitter thread that never answers,
// to prove `split-off-thread.ts` keeps the app's thread free and can end it.
import { parentPort } from "node:worker_threads";

parentPort.on("message", () => {
  // Busy forever, like the catastrophic regex of 14/10.
  for (;;);
});
