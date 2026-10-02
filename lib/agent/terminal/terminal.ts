/**
 * LA TERMINAL DE LEN, vista desde el hilo de la app (F1 de plans/len-agente-2026).
 *
 * Una por turno: los ficheros duran siempre (son los del proyecto), y el
 * directorio y las variables, lo que dura el turno. El intérprete corre en
 * `trabajador.mjs`, en un `worker_thread`, con el perfil «hardened» de
 * `just-bash` y su tope de 30 s por comando. Si aun así un comando no vuelve,
 * se corta aquí: se mata el hilo y la siguiente llamada empieza con una
 * terminal nueva, y se dice —«reset, never repair», la regla de la terminal de
 * DeepSeek—.
 */
import path from "node:path";
import { Worker } from "node:worker_threads";

/** El tope de cada comando, el de la ficha de F1 y el de `just-bash` en «hardened». */
export const LIMITE_MS = 30_000;
/** Lo que se espera de más antes de cortar el hilo desde fuera. */
const MARGEN_MS = 5_000;

const RUTA_DEL_TRABAJADOR = path.join(process.cwd(), "lib", "agent", "terminal", "trabajador.mjs");

export const AVISO_DE_REINICIO =
  "The terminal was reset: the next command starts in a fresh terminal (the files are kept; the directory and variables are not).";

export interface SalidaDeUnComando {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** Los ficheros del proyecto después del comando; `null` si se cortó y no se sabe. */
  readonly ficheros: Readonly<Record<string, string>> | null;
  /** Lo que se dice si la terminal se reinició. */
  readonly reiniciada?: string;
}

class CorteDuro extends Error {}

type Respuesta = { id: number; ok: boolean; error?: string } & Record<string, unknown>;

export class TerminalDeLen {
  private hilo: Worker | null = null;
  private siguiente = 0;
  private readonly pendientes = new Map<number, { resolve: (r: Respuesta) => void; reject: (e: Error) => void }>();

  constructor(
    private readonly o: {
      /** Los ficheros del proyecto, tal como están AHORA (se piden al arrancar y tras un reinicio). */
      readonly cargarFicheros: () => Promise<Record<string, string>>;
      readonly limiteMs?: number;
      readonly margenMs?: number;
    },
  ) {}

  private get limite(): number {
    return this.o.limiteMs ?? LIMITE_MS;
  }

  private async arrancar(): Promise<void> {
    const hilo = new Worker(RUTA_DEL_TRABAJADOR);
    hilo.on("message", (m: Respuesta) => {
      const p = this.pendientes.get(m.id);
      if (!p) return;
      this.pendientes.delete(m.id);
      if (m.ok) p.resolve(m);
      else p.reject(new Error(m.error ?? "la terminal falló"));
    });
    hilo.on("error", (e) => this.fallarTodo(e));
    hilo.on("exit", () => {
      if (this.hilo === hilo) this.hilo = null;
      this.fallarTodo(new Error("la terminal se cerró"));
    });
    this.hilo = hilo;
    await this.pedir({ tipo: "iniciar", ficheros: await this.o.cargarFicheros(), limiteMs: this.limite });
  }

  private fallarTodo(e: Error): void {
    for (const p of this.pendientes.values()) p.reject(e);
    this.pendientes.clear();
  }

  private pedir(m: Record<string, unknown>, corteMs?: number): Promise<Respuesta> {
    const hilo = this.hilo;
    if (!hilo) return Promise.reject(new Error("la terminal no está arrancada"));
    const id = ++this.siguiente;
    return new Promise<Respuesta>((resolve, reject) => {
      const reloj = corteMs === undefined ? null : setTimeout(() => {
        this.pendientes.delete(id);
        reject(new CorteDuro());
      }, corteMs);
      this.pendientes.set(id, {
        resolve: (r) => {
          if (reloj) clearTimeout(reloj);
          resolve(r);
        },
        reject: (e) => {
          if (reloj) clearTimeout(reloj);
          reject(e);
        },
      });
      hilo.postMessage({ ...m, id });
    });
  }

  async ejecutar(command: string): Promise<SalidaDeUnComando> {
    if (!this.hilo) await this.arrancar();
    try {
      const r = await this.pedir({ tipo: "exec", command }, this.limite + (this.o.margenMs ?? MARGEN_MS));
      return {
        stdout: String(r.stdout ?? ""),
        stderr: String(r.stderr ?? ""),
        exitCode: Number(r.exitCode ?? 1),
        ficheros: (r.ficheros as Record<string, string>) ?? null,
      };
    } catch (e) {
      if (!(e instanceof CorteDuro)) throw e;
      await this.cerrar();
      return {
        stdout: "",
        stderr: `Command timed out after ${Math.round(this.limite / 1000)} s.\n`,
        exitCode: 124,
        ficheros: null,
        reiniciada: AVISO_DE_REINICIO,
      };
    }
  }

  /** Deja ficheros como quedaron de verdad (`null`: que no exista). */
  async poner(ficheros: Readonly<Record<string, string | null>>): Promise<void> {
    if (!this.hilo || Object.keys(ficheros).length === 0) return;
    await this.pedir({ tipo: "poner", ficheros });
  }

  async cerrar(): Promise<void> {
    const hilo = this.hilo;
    this.hilo = null;
    if (hilo) await hilo.terminate();
  }
}
