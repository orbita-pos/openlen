import "@inariwatch/capture/auto";
import { captureRequestError } from "@inariwatch/capture";

export const onRequestError = captureRequestError;

export async function register() {
  // @inariwatch/capture/auto initialized via side-effect import above.

  // Best-effort sweep of orphaned publish tmp dirs left behind by a crash
  // mid-publish. Runs only in the Node.js runtime (filesystem APIs aren't
  // available on edge). Errors are swallowed — startup should never fail
  // because of a sweeping issue.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { cleanupStaleTmpDirs } = await import("@/lib/publish/filesystem");
      await cleanupStaleTmpDirs();
    } catch {
      // Filesystem may be read-only in some test or CI envs — ignore.
    }
  }
}
