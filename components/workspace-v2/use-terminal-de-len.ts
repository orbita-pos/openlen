"use client";

// Lo que enseña la lente «Terminal» (F6a de plans/len-agente-2026): los
// comandos de turnos anteriores, de `GET /api/projects/[id]/terminal`, más los
// del turno que corre, que llegan en vivo por `terminalEnVivo`.
//
// Vive en PreviewArea y no dentro de la vista porque el lienzo necesita saber
// ANTES de abrirla si la lente existe: sólo se ofrece cuando la terminal está
// encendida o el proyecto ya tiene comandos. Una pestaña vacía para quien no
// tiene la palanca sería un botón que no hace nada.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import type { ComandoDeLaTerminal } from "@/lib/agent/terminal/historial";
import { terminalEnVivo, type ComandoEnVivo } from "@/lib/workspace-v2/terminal-en-vivo";

export interface TurnoDeLaTerminal {
  readonly id: string;
  readonly pedido: string;
  readonly creado: string;
  readonly comandos: readonly ComandoDeLaTerminal[];
}

export interface TerminalDeLen {
  readonly encendida: boolean;
  readonly turnos: readonly TurnoDeLaTerminal[];
  readonly enVivo: readonly ComandoEnVivo[];
  readonly cargando: boolean;
  readonly error: boolean;
  readonly recargar: () => void;
}

const SIN_PROYECTO = "";

export function useTerminalDeLen(projectId: string | null): TerminalDeLen {
  const [encendida, setEncendida] = useState(false);
  const [turnos, setTurnos] = useState<readonly TurnoDeLaTerminal[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);
  const [pedido, setPedido] = useState(0);

  const enVivo = useSyncExternalStore(
    terminalEnVivo.subscribe,
    () => terminalEnVivo.comandos(projectId ?? SIN_PROYECTO),
    () => terminalEnVivo.comandos(SIN_PROYECTO),
  );

  useEffect(() => {
    setEncendida(false);
    setTurnos([]);
    setError(false);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    const ctrl = new AbortController();
    setCargando(true);
    fetch(`/api/projects/${projectId}/terminal`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const cuerpo = (await r.json()) as { encendida?: unknown; turnos?: unknown };
        const lista = Array.isArray(cuerpo.turnos) ? (cuerpo.turnos as TurnoDeLaTerminal[]) : [];
        setEncendida(cuerpo.encendida === true);
        setTurnos(lista);
        setError(false);
        terminalEnVivo.sinLosYaGuardados(
          projectId,
          lista.flatMap((t) => t.comandos),
        );
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name === "AbortError") return;
        setError(true);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false);
      });
    return () => ctrl.abort();
  }, [projectId, pedido]);

  const recargar = useCallback(() => setPedido((n) => n + 1), []);
  return { encendida, turnos, enVivo, cargando, error, recargar };
}
