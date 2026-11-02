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
    const startedAt = Date.now();
    try {
      const { cleanupStaleTmpDirs } = await import("@/lib/publish/filesystem");
      await cleanupStaleTmpDirs();
    } catch {
      // Filesystem may be read-only in some test or CI envs — ignore.
    }
    // Y lo que ESTE proceso deje: un deploy lo para con SIGTERM, y antes del
    // `process.exit` de Next cada turno vivo escribe lo que lleva, como Claude
    // Code vacía su transcripción al apagarse (lib/agent/exit-flush.ts).
    try {
      const { installExitFlush } = await import("@/lib/agent/exit-flush");
      installExitFlush();
    } catch (err) {
      console.error("[exit] no se pudo armar el vaciado al apagarse", err);
    }
    // Lo que el proceso anterior dejó a medio turno (un deploy, un reinicio):
    // sus filas «en curso» pasan a cortadas —también las que nadie reengancha—
    // y sus cajas de E2B se sueltan. Ya, sin esperar: un turno nuevo no puede
    // encontrarse la caja retenida por uno muerto. Lo abierto después de
    // arrancar no se toca. Nunca lanza.
    void import("@/lib/agent/close-dead-turns")
      .then((m) => m.closeTurnsOfThePreviousProcess())
      .catch((err) => console.error("[dead-turns] no se pudo cerrar lo que dejó el proceso anterior", err));
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
      // Len's scheduled tasks (spec local 2026-10-29-tareas-programadas): what a restart left, then a
      // pass every 30 s. OPENLEN_SCHEDULE=0 leaves it off.
      void import("@/lib/scheduled-tasks/scheduler")
        .then((m) => m.startScheduler())
        .catch((err) => console.error("[schedule] no se pudo arrancar el planificador", err));
      // Len's subagents (spec local 2026-11-01-subagentes-de-len): the ones a restart cut close as stopped, and
      // every notice that never reached Len goes to him, one server turn per project. OPENLEN_SUBAGENTS=0 leaves it.
      if (process.env.OPENLEN_SUBAGENTS !== "0") {
        void Promise.all([import("@/lib/agent/subagents/boot"), import("@/lib/agent/subagents/store"), import("@/lib/agent/turnos-desde-el-servidor")])
          .then(([boot, store, turns]) =>
            boot.closeSubagentsOfThePreviousProcess({
              store,
              launchNoticeTurn: ({ projectId, personId, notices }) =>
                turns.launchSubagentNoticeTurn({
                  userId: personId,
                  projectId,
                  filaId: crypto.randomUUID(),
                  timeZone: "",
                  locale: "en",
                  takeNotices: () => notices,
                  onStart: async () => {},
                  fail: async () => {},
                }),
              now: Date.now,
              startedAt,
            }),
          )
          .then((n) => {
            if (n > 0) console.info(`[subagents] ${n} notice(s) of the previous process handed to Len`);
          })
          .catch((err) => console.error("[subagents] could not close what the previous process left", err));
      }
    }, 10_000).unref?.();
  }
}
