// lib/backend/sql-split-worker.mjs — THE THREAD WHERE MIGRATION SQL IS SPLIT (14/10).
//
// Splitting SQL that the model wrote is CPU work over input nobody controls. On
// 14/10 a catastrophic regex in the splitter hung the app's main thread at 100%
// forever and the whole server stopped answering. Here a slow split only costs
// this thread, which `split-off-thread.ts` ends from outside (its cap, or the
// command's signal when the command times out).
//
// Plain JS: a `Worker` loads it by path, like `lib/apps/checker/checker-worker.mjs`.
// Messages: `{ id, sql }` → `{ id, ok, result | error }`.
import { parentPort } from "node:worker_threads";

import { splitSqlStatements } from "./sql-split.mjs";

parentPort.on("message", (m) => {
  try {
    parentPort.postMessage({ id: m.id, ok: true, result: splitSqlStatements(String(m.sql ?? "")) });
  } catch (e) {
    parentPort.postMessage({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
