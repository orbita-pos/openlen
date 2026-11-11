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
      // «Len que avisa» (spec local 2026-11-03-len-que-avisa): the event tasks' watcher, a pass every minute, and the
      // judges a restart left half done. OPENLEN_SCHEDULE=0 or OPENLEN_EVENT_TASKS=0 leaves it off.
      void Promise.all([import("@/lib/event-tasks/enabled"), import("@/lib/event-tasks/watcher"), import("@/lib/event-tasks/judge")])
        .then(([{ eventTasksEnabled }, { startWatcher }, { judgeCandidate }]) => {
          if (eventTasksEnabled()) startWatcher((record, task) => judgeCandidate(record, task));
        })
        .catch((err) => console.error("[event-tasks] no se pudo arrancar el vigilante", err));
      // The person's own assistant (spec local 2026-11-06-asistente-propio, §4.3): what visitors asked for and she
      // couldn't do gets joined into cards for her person, a pass every five minutes. OPENLEN_ASSISTANT=0 leaves it off.
      void import("@/lib/assistants/requests/pass")
        .then((m) => m.startRequestGrouper())
        .catch((err) => console.error("[assistant-requests] no se pudo arrancar la pasada", err));
      // Her morning summary (spec §6.9, phase 4D): at 8 in the owner's zone, only when something happened yesterday.
      void import("@/lib/assistants/summary/pass")
        .then((m) => m.startMorningSummaries())
        .catch((err) => console.error("[assistant-summary] no se pudo arrancar la pasada", err));
      // Len's subagents (spec local 2026-11-01-subagentes-de-len): the ones a restart cut close as stopped, and
      // every notice that never reached Len goes to him, one server turn per project. OPENLEN_SUBAGENTS=0 leaves it.
      if (process.env.OPENLEN_SUBAGENTS !== "0") {
        void Promise.all([
          import("@/lib/agent/subagents/boot"),
          import("@/lib/agent/subagents/store"),
          import("@/lib/agent/subagents/registry"),
          import("@/lib/agent/turnos-desde-el-servidor"),
        ])
          .then(([boot, store, registry, turns]) =>
            boot.closeSubagentsOfThePreviousProcess({
              store,
              finishWorktree: async (r) => {
                if (!r.worktreeCopyId || !r.worktreeBranch || !r.worktreeBase) return null;
                const [{ db, schema }, { eq }, { realDeps }, { saveWorktreeIntoDraft }, { finishAgentWorktree }] = await Promise.all([
                  import("@/lib/db"), import("drizzle-orm"), import("@/lib/agent/tools"),
                  import("@/lib/agent/subagents/worktree-save"), import("@/lib/agent/subagents/worktree"),
                ]);
                const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, r.projectId)).limit(1);
                if (!project) return null;
                const session: import("@/lib/agent/tools").AgentSession = {
                  projectId: r.projectId, userId: project.userId, personId: r.personId, turnId: r.turnId,
                  app: project.data.app, page: null, ownerEmail: null,
                  imageEditsThisTurn: 0, photoSearchesThisTurn: 0, busquedasVaciasSeguidas: 0,
                };
                const deps = realDeps();
                const result = await finishAgentWorktree({
                  parentId: r.projectId, ownerId: project.userId, description: r.description,
                  w: { copyId: r.worktreeCopyId, branch: r.worktreeBranch, base: r.worktreeBase },
                  previous: r.worktreeOutcome ?? undefined,
                  save: (changes, draft) => saveWorktreeIntoDraft(session, deps, changes, draft),
                });
                if (result.changes) {
                  const [{ addChangesToTurn }, { cambiosDelTurnoParaDeshacer }] = await Promise.all([
                    import("@/lib/projects/deshacer-turno"), import("@/lib/projects/deshacer-turno-plan"),
                  ]);
                  await addChangesToTurn(r.projectId, r.chatRowId, cambiosDelTurnoParaDeshacer(result.changes.before, result.changes.after));
                }
                await store.setWorktreeOutcome(r.id, result.outcome);
                return result.outcome;
              },
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
              isLive: registry.isLive,
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
