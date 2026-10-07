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
 * la cola del proyecto (en memoria; un reinicio la pierde y el hilo lo dice).
 * Si el turno no llega a contestar (sin créditos, el tope de los miembros, un
 * fallo), Len lo dice en el hilo con el motivo, para que nunca se quede en
 * «trabajando».
 */
import "server-only";

import { hayTurnoVivoEnElProyecto } from "@/lib/agent/direcciones";
import { hiloTieneRespuestaDe, respuestaDeLen } from "@/lib/projects/hilos";

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

type Corredor = (
  userId: string,
  body: Record<string, unknown>,
  req: { url: string; signal: AbortSignal },
  opts: { hilo: PedidoDelHilo },
) => Promise<Response>;

let corredor: Corredor | null = null;

/** Lo llama la ruta de Len al cargarse. */
export function registrarCorredorDeTurnos(f: Corredor): void {
  corredor = f;
}

const colas = new Map<string, Promise<unknown>>();
const ESPERA_MAX_MS = 30 * 60_000;

async function esperarALen(projectId: string): Promise<boolean> {
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
export async function lanzarTurnoDelHilo(p: {
  readonly userId: string;
  readonly projectId: string;
  readonly texto: string;
  readonly hilo: PedidoDelHilo;
  readonly origen: string;
  readonly fraseDeFallo: (fallo: FalloDelTurno | null) => string;
}): Promise<{ readonly filaId: string }> {
  if (!corredor) await import("@/app/api/agent/route");
  const correr = corredor;
  const filaId = crypto.randomUUID();
  const anterior = colas.get(p.projectId) ?? Promise.resolve();
  const trabajo = anterior
    .catch(() => undefined)
    .then(async () => {
      if (!correr) throw new Error("la ruta de Len no se registró");
      if (!(await esperarALen(p.projectId))) {
        await respuestaDeLen({ projectId: p.projectId, hiloId: p.hilo.hiloId, texto: p.fraseDeFallo(null), filaId });
        return;
      }
      let errores: FalloDelTurno[] = [];
      try {
        const res = await correr(
          p.userId,
          { projectId: p.projectId, prompt: p.texto, turnId: filaId, answersQuestions: false },
          { url: p.origen, signal: new AbortController().signal },
          { hilo: p.hilo },
        );
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
          errores = [{ motivo: typeof j.error === "string" ? j.error : `HTTP ${res.status}`, ...(typeof j.code === "string" ? { code: j.code } : {}) }];
        } else {
          errores = await erroresDelStream(res);
        }
      } catch (err) {
        errores = [{ motivo: err instanceof Error ? err.message : String(err) }];
      }
      // Si Len no contestó en el hilo, lo dice con el motivo: nunca se queda «trabajando».
      if (!(await hiloTieneRespuestaDe(p.hilo.hiloId, filaId))) {
        await respuestaDeLen({ projectId: p.projectId, hiloId: p.hilo.hiloId, texto: p.fraseDeFallo(errores.at(-1) ?? null), filaId });
      }
    })
    .catch((err) => console.error("[hilos] el turno del hilo falló", err));
  colas.set(p.projectId, trabajo);
  void trabajo.finally(() => {
    if (colas.get(p.projectId) === trabajo) colas.delete(p.projectId);
  });
  return { filaId };
}
