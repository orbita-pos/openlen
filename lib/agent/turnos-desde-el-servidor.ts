/**
 * `@Len` DESDE UN HILO DEL CÓDIGO, COMO CLAUDE TAG: el turno arranca EN EL
 * SERVIDOR en cuanto se publica el mensaje —no depende de que el chat esté
 * abierto, ni de que quien lo pidió siga en la página— y Len contesta en el
 * hilo al cerrar (lo escribe la ruta de Len: `respuestaDeLen`).
 *
 * Es el mismo camino que la ronda siguiente de un encargo (pieza 8): se llama
 * al turno sin la puerta HTTP. La ruta de Len (`app/api/agent/route.ts`) se
 * registra aquí al cargarse —una ruta de Next no puede exportar otra cosa que
 * sus métodos— y, si aún no se cargó, se importa.
 *
 * Un turno a la vez por proyecto: si Len ya trabaja en él, el pedido espera en
 * la cola del proyecto. La cola vive en memoria, pero el pedido NO: queda
 * apuntado en su mensaje del hilo (`apuntarPedidoALen`), y al arrancar el
 * servidor `retomarPedidosDelHilo` lo retoma —el que no llegó a empezar se
 * vuelve a lanzar con su misma fila; el que se cortó a medias, Len lo dice en
 * el hilo (pudo dejar cambios hechos: no se repite a ciegas)—. Se llama desde
 * `instrumentation.ts` y, por si acaso, la primera vez que alguien lee los
 * hilos. Supone UN proceso de Next (como la cola y `hayTurnoVivoEnElProyecto`).
 *
 * Si el turno no llega a contestar (sin créditos, el tope de los miembros, un
 * fallo), Len lo dice en el hilo con el motivo, para que nunca se quede en
 * «trabajando».
 */
import "server-only";

import { hayTurnoVivoEnElProyecto } from "@/lib/agent/direcciones";
import type { LenWatchOrigin, ScheduledOrigin, StoredChatTurn } from "@/lib/projects/types";

/** The cards a turn left (`registro.tarjetas`): what a scheduled task's email reads its files and waits from. */
export type Tarjetas = NonNullable<StoredChatTurn["actions"]>;

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://openlen.com";
}
import { fraseDeFalloDelHilo, fraseDeInterrupcionDelHilo, idiomaDelCorreo } from "@/lib/projects/correos-del-proyecto";
import { contextoParaLen, hiloTieneRespuestaDe, listarHilos, pedidosALenSinContestar, respuestaDeLen } from "@/lib/projects/hilos";

export interface OrigenDelHilo {
  readonly hiloId: string;
  readonly ruta: string;
  readonly linea: number;
}

/** Lo que el turno necesita de un hilo: dónde, y lo dicho antes (sólo para el modelo). */
export interface PedidoDelHilo extends OrigenDelHilo {
  /** El contexto que va al MODELO, no a lo que se ve en el chat. */
  readonly contexto: string;
}

/** Un pedido que llegó POR CORREO (lib/len-email): Len contesta por correo al cerrar. */
export interface EmailRequest {
  /** Lo que lee el MODELO delante del pedido; la fila guarda sólo lo escrito. */
  readonly context: string;
  /** Lo que Len dijo al cerrar el turno: se le manda a quien escribió. */
  readonly onReply: (text: string) => Promise<void>;
}

/** A SCHEDULED TASK's run (spec local 2026-10-29-tareas-programadas, §7.5): the model reads DeepSeek's
 *  `[SCHEDULE REMINDER]` framing instead of the prompt; the row keeps the prompt with its origin. */
export interface ScheduledRequest {
  readonly framing: string;
  /** A scheduled task's run, or a Len Watch turn (spec local 2026-10-30-len-watch): both arrive framed. */
  readonly origin: ScheduledOrigin | LenWatchOrigin;
  /** What Len said at the end and the turn's cards (their `present` files go in the email);
   *  `finalText` is only its last message (`RegistroDelTurno.finalText`). */
  readonly onReply: (text: string, cards: Tarjetas, finalText?: string) => Promise<void>;
  /** Whose chat the row goes to, when the tools act on another project: a Len Watch worktree's turn lives in its
   *  parent's chat (spec local 2026-10-30-len-watch, §5.5). */
  readonly chatProjectId?: string;
}

type Corredor = (
  userId: string,
  body: Record<string, unknown>,
  req: { url: string; signal: AbortSignal },
  opts: { hilo?: PedidoDelHilo; email?: EmailRequest; scheduled?: ScheduledRequest },
) => Promise<Response>;

let corredor: Corredor | null = null;

/** Lo llama la ruta de Len al cargarse. */
export function registrarCorredorDeTurnos(f: Corredor): void {
  corredor = f;
}

const colas = new Map<string, Promise<unknown>>();
const ESPERA_MAX_MS = 30 * 60_000;

/** Waits for Len's live turn in the project to end (up to half an hour); false if it never did. «Traer el arreglo»
 *  waits on it too (lib/len-watch/bring.ts). */
export async function esperarALen(projectId: string): Promise<boolean> {
  const hasta = Date.now() + ESPERA_MAX_MS;
  while (hayTurnoVivoEnElProyecto(projectId)) {
    if (Date.now() > hasta) return false;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return true;
}

/** Un fallo del turno: su frase y, si la trae, su código (`tope_de_miembros`, `no_credits`…). */
export interface FalloDelTurno {
  readonly motivo: string;
  readonly code?: string;
}

/** Los eventos `error` de un SSE, en orden. */
async function erroresDelStream(res: Response): Promise<FalloDelTurno[]> {
  const errores: FalloDelTurno[] = [];
  if (!res.body) return errores;
  const lector = res.body.getReader();
  const deco = new TextDecoder();
  let resto = "";
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    resto += deco.decode(value, { stream: true });
    const trozos = resto.split("\n\n");
    resto = trozos.pop() ?? "";
    for (const t of trozos) {
      if (!/^event: error$/m.test(t)) continue;
      try {
        const data = JSON.parse(/^data: (.+)$/m.exec(t)?.[1] ?? "{}") as { message?: unknown; code?: unknown };
        if (typeof data.message === "string") errores.push({ motivo: data.message, ...(typeof data.code === "string" ? { code: data.code } : {}) });
      } catch {
        // un evento roto no es un motivo
      }
    }
  }
  return errores;
}

/**
 * Lanza el turno del hilo y vuelve en el acto con su fila (para que el chat lo
 * siga si está abierto). El trabajo —esperar turno, correr, contestar— sigue
 * solo. `fraseDeFallo` arma lo que dice Len cuando el turno no contesta: la
 * pone quien llama, en el idioma de quien escribió (con el código, traduce).
 */
/** Corre el turno y devuelve sus fallos (el HTTP que no fue 200, o los `error` del SSE). */
async function runTurn(
  correr: Corredor,
  p: { userId: string; projectId: string; texto: string; filaId: string; origen: string; body?: Record<string, unknown> },
  opts: { hilo?: PedidoDelHilo; email?: EmailRequest; scheduled?: ScheduledRequest },
): Promise<FalloDelTurno[]> {
  try {
    const res = await correr(
      p.userId,
      { projectId: p.projectId, prompt: p.texto, turnId: p.filaId, answersQuestions: false, ...p.body },
      { url: p.origen, signal: new AbortController().signal },
      opts,
    );
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
      return [{ motivo: typeof j.error === "string" ? j.error : `HTTP ${res.status}`, ...(typeof j.code === "string" ? { code: j.code } : {}) }];
    }
    return await erroresDelStream(res);
  } catch (err) {
    return [{ motivo: err instanceof Error ? err.message : String(err) }];
  }
}

/** Un turno a la vez por proyecto: `work` corre cuando acabó lo anterior de la cola. */
function enqueue(projectId: string, work: () => Promise<void>, label: string): void {
  const anterior = colas.get(projectId) ?? Promise.resolve();
  const trabajo = anterior
    .catch(() => undefined)
    .then(work)
    .catch((err) => console.error(`[${label}] el turno falló`, err));
  colas.set(projectId, trabajo);
  void trabajo.finally(() => {
    if (colas.get(projectId) === trabajo) colas.delete(projectId);
  });
}

async function corredorCargado(): Promise<Corredor | null> {
  if (!corredor) await import("@/app/api/agent/route");
  return corredor;
}

/**
 * Lanza el turno del hilo y vuelve en el acto con su fila (para que el chat lo
 * siga si está abierto). El trabajo —esperar turno, correr, contestar— sigue
 * solo. `fraseDeFallo` arma lo que dice Len cuando el turno no contesta: la
 * pone quien llama, en el idioma de quien escribió (con el código, traduce).
 */
export async function lanzarTurnoDelHilo(p: {
  readonly userId: string;
  readonly projectId: string;
  readonly texto: string;
  readonly hilo: PedidoDelHilo;
  readonly origen: string;
  readonly fraseDeFallo: (fallo: FalloDelTurno | null) => string;
  /** La fila del turno, si ya se apuntó con el pedido (`apuntarPedidoALen`). */
  readonly filaId?: string;
}): Promise<{ readonly filaId: string }> {
  const correr = await corredorCargado();
  const filaId = p.filaId ?? crypto.randomUUID();
  enqueue(
    p.projectId,
    async () => {
      if (!correr) throw new Error("la ruta de Len no se registró");
      if (!(await esperarALen(p.projectId))) {
        await respuestaDeLen({ projectId: p.projectId, hiloId: p.hilo.hiloId, texto: p.fraseDeFallo(null), filaId });
        return;
      }
      const errores = await runTurn(correr, { ...p, filaId }, { hilo: p.hilo });
      // Si Len no contestó en el hilo, lo dice con el motivo: nunca se queda «trabajando».
      if (!(await hiloTieneRespuestaDe(p.hilo.hiloId, filaId))) {
        await respuestaDeLen({ projectId: p.projectId, hiloId: p.hilo.hiloId, texto: p.fraseDeFallo(errores.at(-1) ?? null), filaId });
      }
    },
    "hilos",
  );
  return { filaId };
}

/**
 * LEN POR CORREO (lib/len-email): el mismo camino que un `@Len` de un hilo,
 * pero Len contesta POR CORREO. `reply` manda lo que Len dijo al cerrar; si el
 * turno no llegó a contestar, se manda `fraseDeFallo` con el motivo, para que
 * quien escribió nunca se quede sin respuesta. La cola vive en memoria, pero el
 * pedido no: lo apunta quien llama (`lenEmailRequests`, con su `filaId`) y
 * `resumeEmailRequests` (lib/len-email/run.ts) lo retoma tras un reinicio.
 */
export async function launchEmailTurn(p: {
  readonly userId: string;
  readonly projectId: string;
  readonly texto: string;
  readonly context: string;
  readonly origen: string;
  readonly reply: (text: string) => Promise<void>;
  readonly fraseDeFallo: (fallo: FalloDelTurno | null) => string;
  /** La fila del turno: el id del correo apuntado. */
  readonly filaId?: string;
}): Promise<{ readonly filaId: string }> {
  const correr = await corredorCargado();
  const filaId = p.filaId ?? crypto.randomUUID();
  enqueue(
    p.projectId,
    async () => {
      if (!correr) throw new Error("la ruta de Len no se registró");
      if (!(await esperarALen(p.projectId))) {
        await p.reply(p.fraseDeFallo(null));
        return;
      }
      let replied = false;
      const email: EmailRequest = {
        context: p.context,
        onReply: async (text) => {
          replied = true;
          await p.reply(text);
        },
      };
      const errores = await runTurn(correr, { ...p, filaId }, { email });
      if (!replied) await p.reply(p.fraseDeFallo(errores.at(-1) ?? null));
    },
    "len-email",
  );
  return { filaId };
}

/**
 * A SCHEDULED TASK (spec local 2026-10-29-tareas-programadas, §7.5): the same road as an email to
 * Len, started by the scheduler (lib/scheduled-tasks/scheduler.ts) instead of a person. It runs as
 * whoever created the task, in the task's zone and language, and waits its turn in the project's
 * queue. `reply` gets what Len said and the turn's cards; with no reply (no credits, the members'
 * cap, a failure, Len busy for too long) `fail` gets the reason — never silence. Returns at once.
 */
export function launchScheduledTurn(p: FramedTurn<ScheduledOrigin>): void {
  launchFramedTurn(p, "scheduled-task");
}

/**
 * A LEN WATCH TURN (spec local 2026-10-30-len-watch, §5.4): the published site stopped loading and the
 * owner let Len fix it on its own (or pressed «Fix with Len»). The same road as a scheduled task:
 * it runs as the owner, waits its turn in the project's queue, and says why when it can't reply.
 */
export function launchLenWatchTurn(p: FramedTurn<LenWatchOrigin>): void {
  launchFramedTurn(p, "len-watch");
}

interface FramedTurn<O extends ScheduledOrigin | LenWatchOrigin> {
  readonly userId: string;
  readonly projectId: string;
  /** What the chat row shows as the person's message. */
  readonly texto: string;
  /** What the model reads instead. */
  readonly framing: string;
  readonly origin: O;
  readonly timeZone: string;
  readonly locale: string;
  /** The chat row's id: the run's id. */
  readonly filaId: string;
  readonly reply: (text: string, cards: Tarjetas, finalText?: string) => Promise<void>;
  readonly fail: (fallo: FalloDelTurno | null, cut: boolean) => Promise<void>;
  readonly onStart: () => Promise<void>;
  /** The chat the row goes to when `projectId` is a worktree (`ScheduledRequest.chatProjectId`). */
  readonly chatProjectId?: string;
}

function launchFramedTurn(p: FramedTurn<ScheduledOrigin | LenWatchOrigin>, label: string): void {
  enqueue(
    p.projectId,
    async () => {
      const correr = await corredorCargado();
      if (!correr) throw new Error("la ruta de Len no se registró");
      if (!(await esperarALen(p.projectId))) {
        await p.fail(null, false);
        return;
      }
      await p.onStart();
      let replied = false;
      const scheduled: ScheduledRequest = {
        framing: p.framing,
        origin: p.origin,
        onReply: async (text, cards, finalText) => {
          replied = true;
          await p.reply(text, cards, finalText);
        },
        ...(p.chatProjectId ? { chatProjectId: p.chatProjectId } : {}),
      };
      const errores = await runTurn(
        correr,
        { userId: p.userId, projectId: p.projectId, texto: p.texto, filaId: p.filaId, origen: `${siteUrl()}/api/agent`, body: { zonaHoraria: p.timeZone, idioma: p.locale } },
        { scheduled },
      );
      if (!replied) await p.fail(errores.at(-1) ?? null, false);
    },
    label,
  );
}

/** Cuándo arrancó este proceso: lo pedido antes, nadie de aquí lo corre. */
const ARRANQUE = new Date();
/** Pasado esto, un pedido que no empezó ya no se lanza solo (sorprendería): Len
 *  dice en el hilo que no llegó. */
const RETOMAR_HASTA_MS = 24 * 3_600_000;

let retomando: Promise<number> | null = null;

/**
 * Los pedidos a `@Len` que un reinicio dejó sin contestar: los que no llegaron
 * a empezar se lanzan otra vez (con su misma fila, como si nada); los que se
 * cortaron a medias, o son de hace más de un día, Len lo dice en el hilo. Una
 * vez por proceso; devuelve cuántos atendió. Nunca lanza.
 */
export function retomarPedidosDelHilo(): Promise<number> {
  retomando ??= retomar().catch((err) => {
    console.error("[hilos] no se pudieron retomar los pedidos a Len", err);
    return 0;
  });
  return retomando;
}

async function retomar(): Promise<number> {
  const pendientes = await pedidosALenSinContestar(ARRANQUE);
  for (const p of pendientes) {
    const idioma = idiomaDelCorreo(p.pedido.idioma);
    const viejo = ARRANQUE.getTime() - p.createdAt.getTime() > RETOMAR_HASTA_MS;
    if (p.empezado || viejo) {
      const texto = p.empezado ? fraseDeInterrupcionDelHilo(idioma) : fraseDeFalloDelHilo(idioma, null);
      await respuestaDeLen({ projectId: p.projectId, hiloId: p.hiloId, texto, filaId: p.filaId });
      continue;
    }
    const hilo = (await listarHilos(p.projectId, p.autorId)).find((h) => h.id === p.hiloId);
    if (!hilo) continue;
    await lanzarTurnoDelHilo({
      userId: p.autorId,
      projectId: p.projectId,
      texto: p.texto,
      filaId: p.filaId,
      hilo: { hiloId: hilo.id, ruta: hilo.ruta, linea: hilo.linea, contexto: contextoParaLen(hilo, p.mensajeId) },
      origen: p.pedido.url,
      fraseDeFallo: (fallo) => fraseDeFalloDelHilo(idioma, fallo),
    });
  }
  if (pendientes.length > 0) console.info(`[hilos] ${pendientes.length} pedido(s) a Len retomados tras el reinicio`);
  return pendientes.length;
}
