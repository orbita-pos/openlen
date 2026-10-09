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
    // Los pedidos a `@Len` desde un hilo del código que un reinicio dejó sin
    // contestar: se retoman en cuanto el servidor está en pie (unos segundos
    // después, para no cargar la ruta de Len en el arranque). Si esto falla, la
    // primera lectura de los hilos lo vuelve a intentar.
    setTimeout(() => {
      void import("@/lib/agent/turnos-desde-el-servidor")
        .then((m) => m.retomarPedidosDelHilo())
        .catch((err) => console.error("[hilos] no se pudieron retomar los pedidos a Len", err));
      // Y los correos a Len (lib/len-email/run.ts), igual.
      void import("@/lib/len-email/run")
        .then((m) => m.resumeEmailRequests())
        .catch((err) => console.error("[len-email] no se pudieron retomar los correos a Len", err));
    }, 10_000).unref?.();
  }
}
