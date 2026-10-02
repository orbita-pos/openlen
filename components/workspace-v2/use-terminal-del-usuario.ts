"use client";

// LA TERMINAL DEL USUARIO en la lente «Terminal» (la #17 de
// plans/len-agente-2026/notas/fase-5-taller.md): lo que escribes, a
// `POST /api/projects/[id]/terminal`, y lo que imprime, aquí.
//
// Como la de DeepSeek, aparte de la de Len: sus comandos no van a la
// conversación ni los ve el modelo. Viven lo que la pestaña, en un almacén de
// módulo para que cerrar y abrir la lente no los borre. Si un comando cambió
// algún fichero, se avisa por el canal con el que las pestañas ya se avisan
// entre sí (`openlen-project-sync`, en `/new`), y el lienzo vuelve a leer el
// proyecto sin pisar lo que tengas sin guardar.

import { useCallback, useSyncExternalStore } from "react";

import { leerCambiosDelComando, type CambiosDelComando } from "@/lib/agent/terminal/cambios-del-comando";

export interface ComandoTuyo {
  readonly n: number;
  readonly command: string;
  /** Null mientras corre. */
  readonly salida: string | null;
  readonly exitCode: number | null;
  /** No llegó a correr (red, terminal apagada…): se dice en vez de la salida. */
  readonly error?: string;
  /** Lo que cambió en los ficheros (la #10). */
  readonly cambios?: CambiosDelComando;
}

const porProyecto = new Map<string, readonly ComandoTuyo[]>();
const oyentes = new Set<() => void>();
let n = 0;
const VACIA: readonly ComandoTuyo[] = [];
/** Tope por proyecto: la lente no es un registro infinito. */
const TOPE = 200;

function avisar() {
  for (const fn of oyentes) fn();
}

function poner(projectId: string, comando: ComandoTuyo) {
  const lista = porProyecto.get(projectId) ?? VACIA;
  const i = lista.findIndex((c) => c.n === comando.n);
  porProyecto.set(projectId, i < 0 ? [...lista, comando].slice(-TOPE) : lista.map((c, k) => (k === i ? comando : c)));
  avisar();
}

export interface TerminalDelUsuario {
  readonly comandos: readonly ComandoTuyo[];
  readonly corriendo: boolean;
  readonly ejecutar: (command: string) => Promise<void>;
}

export function useTerminalDelUsuario(projectId: string | null): TerminalDelUsuario {
  const comandos = useSyncExternalStore(
    (fn) => {
      oyentes.add(fn);
      return () => {
        oyentes.delete(fn);
      };
    },
    () => (projectId ? porProyecto.get(projectId) ?? VACIA : VACIA),
    () => VACIA,
  );
  const corriendo = comandos.some((c) => c.salida === null && !c.error);

  const ejecutar = useCallback(
    async (command: string) => {
      if (!projectId || !command.trim()) return;
      const yo = ++n;
      poner(projectId, { n: yo, command, salida: null, exitCode: null });
      try {
        const r = await fetch(`/api/projects/${projectId}/terminal`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ command }),
        });
        const j = (await r.json().catch(() => ({}))) as {
          salida?: string;
          exitCode?: number;
          cambio?: boolean;
          cambios?: unknown;
          error?: string;
        };
        if (!r.ok || typeof j.salida !== "string") {
          poner(projectId, { n: yo, command, salida: null, exitCode: null, error: j.error ?? String(r.status) });
          return;
        }
        const cambios = leerCambiosDelComando(j.cambios);
        poner(projectId, {
          n: yo,
          command,
          salida: j.salida,
          exitCode: typeof j.exitCode === "number" ? j.exitCode : null,
          ...(cambios ? { cambios } : {}),
        });
        if (j.cambio && typeof BroadcastChannel !== "undefined") {
          const canal = new BroadcastChannel("openlen-project-sync");
          canal.postMessage({ projectId });
          canal.close();
        }
      } catch {
        poner(projectId, { n: yo, command, salida: null, exitCode: null, error: "red" });
      }
    },
    [projectId],
  );

  return { comandos, corriendo, ejecutar };
}
