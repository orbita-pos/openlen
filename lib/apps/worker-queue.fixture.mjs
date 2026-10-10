// lib/apps/worker-queue.fixture.mjs — un hilo de eco para probar `WorkerQueue`.
// `{ id, ms, value, recycle }` → tras `ms`, `{ id, ok, result: { value, threadId }, recycling }`.
import { parentPort, threadId } from "node:worker_threads";

parentPort.on("message", (m) => {
  setTimeout(() => {
    parentPort.postMessage({ id: m.id, ok: true, result: { value: m.value, threadId }, ...(m.recycle ? { recycling: true } : {}) });
    if (m.recycle) parentPort.close();
  }, m.ms ?? 0);
});
