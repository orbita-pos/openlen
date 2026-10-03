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
  /** F5 · los ficheros perezosos (de sólo lectura) que ESTE comando hizo cargar. */
  readonly cargados?: readonly string[];
  /** F5 · los que no se pudieron calcular, con el porqué (`just-bash` sólo dice «No such file»). */
  readonly fallidos?: readonly { readonly ruta: string; readonly error: string }[];
}

class CorteDuro extends Error {}

type Respuesta = { id: number; ok: boolean; error?: string } & Record<string, unknown>;

export class TerminalDeLen {
  private hilo: Worker | null = null;
  private siguiente = 0;
  private cargados: string[] = [];
  private fallidos: { ruta: string; error: string }[] = [];
  private readonly pendientes = new Map<number, { resolve: (r: Respuesta) => void; reject: (e: Error) => void }>();

  constructor(
    private readonly o: {
      /** Los ficheros del proyecto, tal como están AHORA (se piden al arrancar y tras un reinicio). */
      readonly cargarFicheros: () => Promise<Record<string, string>>;
      /** F5 · los ficheros de sólo lectura, que se calculan cuando un comando
       *  los lee por primera vez (ver la cabecera de `trabajador.mjs`). */
      readonly perezosos?: {
        readonly rutas: () => Promise<readonly string[]>;
        readonly leer: (ruta: string) => Promise<string>;
      };
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
      if (typeof m.perezoso === "number") {
        void this.servirPerezoso(hilo, m.perezoso, String(m.ruta ?? ""));
        return;
      }
      const p = this.pendientes.get(m.id);
      if (!p) return;
      this.pendientes.delete(m.id);
      if (m.ok) p.resolve(m);
      else p.reject(new Error(m.error ?? "the terminal failed"));
    });
    hilo.on("error", (e) => this.fallarTodo(e));
    hilo.on("exit", () => {
      if (this.hilo === hilo) this.hilo = null;
      this.fallarTodo(new Error("the terminal closed"));
    });
    this.hilo = hilo;
    const [ficheros, perezosos] = await Promise.all([this.o.cargarFicheros(), this.o.perezosos?.rutas() ?? []]);
    await this.pedir({ tipo: "iniciar", ficheros, perezosos, limiteMs: this.limite });
  }

  /** Un fichero de sólo lectura que el hilo necesita: se calcula aquí y se le devuelve. */
  private async servirPerezoso(hilo: Worker, pid: number, ruta: string): Promise<void> {
    this.cargados.push(ruta);
    try {
      if (!this.o.perezosos) throw new Error(`${ruta}: not available`);
      const contenido = await this.o.perezosos.leer(ruta);
      hilo.postMessage({ tipo: "perezoso", pid, ruta, contenido });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.fallidos.push({ ruta, error });
      hilo.postMessage({ tipo: "perezoso", pid, ruta, error });
    }
  }

  private fallarTodo(e: Error): void {
    for (const p of this.pendientes.values()) p.reject(e);
    this.pendientes.clear();
  }

  private pedir(m: Record<string, unknown>, corteMs?: number): Promise<Respuesta> {
    const hilo = this.hilo;
    if (!hilo) return Promise.reject(new Error("the terminal isn't started"));
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
    this.cargados = [];
    this.fallidos = [];
    try {
      const r = await this.pedir({ tipo: "exec", command }, this.limite + (this.o.margenMs ?? MARGEN_MS));
      return {
        stdout: String(r.stdout ?? ""),
        stderr: String(r.stderr ?? ""),
        exitCode: Number(r.exitCode ?? 1),
        ficheros: (r.ficheros as Record<string, string>) ?? null,
        ...(this.cargados.length > 0 ? { cargados: [...this.cargados] } : {}),
        ...(this.fallidos.length > 0 ? { fallidos: [...this.fallidos] } : {}),
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

  /**
   * F5 · lo de sólo lectura, con las rutas y el contenido de AHORA: lo ya leído
   * se olvida y se vuelve a calcular al leerlo. Se pide cuando el sitio cambió
   * (una versión nueva). Sin arrancar no hace nada: al arrancar ya se listan.
   */
  async refrescarPerezosos(): Promise<void> {
    if (!this.hilo || !this.o.perezosos) return;
    const perezosos = await this.o.perezosos.rutas();
    await this.pedir({ tipo: "perezosos", perezosos });
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
