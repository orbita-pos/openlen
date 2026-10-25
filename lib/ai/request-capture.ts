// Full request captures, ONLY in development (layer 1 of Len 3.1, spec local
// 2026-10-24-len-3-1-layers-0-1, §5.5): with `OPENLEN_CAPTURE_REQUESTS_DIR` set,
// each body POSTed to a provider is appended as one line to
// `<dir>/<requestId>.jsonl`, for `npm run requests:diff -- --captures <file>`.
// The captures hold customer text: never in production (refused, said once),
// always outside the repo, deleted when the audit is done. A capture that fails
// never touches the call.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

let refusedOnce = false;

export function captureRequest(requestId: string, body: unknown, env: Readonly<Record<string, string | undefined>> = process.env): void {
  const dir = env.OPENLEN_CAPTURE_REQUESTS_DIR;
  if (!dir) return;
  if (env.NODE_ENV === "production") {
    if (!refusedOnce) {
      refusedOnce = true;
      console.warn("[capture] OPENLEN_CAPTURE_REQUESTS_DIR is ignored in production");
    }
    return;
  }
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${requestId.replace(/[^A-Za-z0-9_-]/g, "_") || "request"}.jsonl`), `${JSON.stringify(body)}\n`, "utf8");
  } catch {
    // The call goes out the same.
  }
}
