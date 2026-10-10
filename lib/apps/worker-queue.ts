// lib/apps/worker-queue.ts — UN HILO CON SU COLA (plan 02). Lo usan el
// comprobador de tipos y lint (plan 03) y el empaquetador: los dos corren algo
// pesado que no puede parar el hilo de la app.
//
// Lo que aprendió el comprobador, aquí una vez:
//   · LA COLA vive en el hilo de la app: al hilo entra UNA petición a la vez y
//     su tope cuenta desde que ENTRA. Con la cola en el puerto del hilo, las
//     últimas de una cola larga caducaban esperando y mataban el hilo con todo
//     lo pendiente (medido: 14 de 30).
//   · `supersedes`: una petición nueva con la misma marca sustituye a la que aún
//     espera, como el `geterr` de tsserver (`errorCheck.startNew`).
//   · Una petición que pasa del tope se lleva el hilo por delante (`terminate`):
//     un caso patológico no se queda comiendo CPU. La siguiente renace.
//   · El hilo que se recicla (su umbral de memoria) lo dice EN su respuesta
//     (`recycling`), y la siguiente va a uno nuevo en vez de perderse.
// Fail-soft: lo que no llega, falla o se sustituye es `null`.
//
// Protocolo: entra `{ id, ...mensaje }`, sale `{ id, ok, result?, recycling? }`.
import { Worker, type ResourceLimits } from "node:worker_threads";

interface Peticion<Out> {
  readonly message: Record<string, unknown>;
  readonly timeoutMs: number;
  readonly supersedes?: object;
  readonly resolve: (r: Out | null) => void;
}

export class WorkerQueue<Out> {
  #hilo: Worker | null = null;
  #siguienteId = 0;
  readonly #cola: Peticion<Out>[] = [];
  #enCurso: { readonly id: number; readonly peticion: Peticion<Out>; readonly timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(private readonly o: { readonly workerPath: string; readonly resourceLimits?: ResourceLimits; readonly workerData?: unknown }) {}

  run(message: Record<string, unknown>, o: { readonly timeoutMs: number; readonly supersedes?: object }): Promise<Out | null> {
    return new Promise((resolve) => {
      if (o.supersedes) {
        for (let i = this.#cola.length - 1; i >= 0; i--) {
          if (this.#cola[i]!.supersedes !== o.supersedes) continue;
          this.#cola[i]!.resolve(null);
          this.#cola.splice(i, 1);
        }
      }
      this.#cola.push({ message, timeoutMs: o.timeoutMs, ...(o.supersedes ? { supersedes: o.supersedes } : {}), resolve });
      this.#despachar();
    });
  }

  /** Para las pruebas y el apagado: suelta lo pendiente y termina el hilo. */
  stop(): void {
    for (const p of this.#cola.splice(0)) p.resolve(null);
    this.#soltarElHilo();
  }

  /** Lo que está dentro del hilo, a `null`, y el hilo fuera: el siguiente renace. */
  #soltarElHilo(): void {
    if (this.#enCurso) {
      clearTimeout(this.#enCurso.timer);
      this.#enCurso.peticion.resolve(null);
      this.#enCurso = null;
    }
    const viejo = this.#hilo;
    this.#hilo = null;
    void viejo?.terminate();
  }

  #elHilo(): Worker {
    if (this.#hilo) return this.#hilo;
    const nuevo = new Worker(this.o.workerPath, {
      ...(this.o.resourceLimits ? { resourceLimits: this.o.resourceLimits } : {}),
      ...(this.o.workerData !== undefined ? { workerData: this.o.workerData } : {}),
    });
    nuevo.on("message", (m: { id: number; ok: boolean; result?: Out; recycling?: boolean }) => {
      // Se recicla (su umbral de memoria): la siguiente va a un hilo nuevo.
      if (m.recycling && this.#hilo === nuevo) this.#hilo = null;
      if (!this.#enCurso || this.#enCurso.id !== m.id) return;
      clearTimeout(this.#enCurso.timer);
      this.#enCurso.peticion.resolve(m.ok && m.result !== undefined ? m.result : null);
      this.#enCurso = null;
      this.#despachar();
    });
    const alMorir = () => {
      if (this.#hilo !== nuevo) return;
      this.#soltarElHilo();
      this.#despachar();
    };
    nuevo.on("error", alMorir);
    nuevo.on("exit", alMorir);
    // Que un hilo ocioso no mantenga vivo el proceso (las pruebas, un script).
    nuevo.unref();
    this.#hilo = nuevo;
    return nuevo;
  }

  /** Mete en el hilo la siguiente de la cola, si el hilo está libre. */
  #despachar(): void {
    if (this.#enCurso) return;
    const peticion = this.#cola.shift();
    if (!peticion) return;
    let w: Worker;
    try {
      w = this.#elHilo();
    } catch {
      peticion.resolve(null);
      this.#despachar();
      return;
    }
    const id = ++this.#siguienteId;
    const timer = setTimeout(() => {
      if (this.#enCurso?.id !== id) return;
      this.#soltarElHilo();
      this.#despachar();
    }, peticion.timeoutMs);
    this.#enCurso = { id, peticion, timer };
    w.postMessage({ ...peticion.message, id });
  }
}
