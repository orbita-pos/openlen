// Una lectura al entrar; cada 3 s mientras quede un hijo trabajando, aunque su turno ya cerró.
import { useCallback, useEffect, useState } from "react";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { leerSubagentes, pararSubagente } from "../api/subagentes";
import type { ElementoDelHilo } from "./hilo";
import { trabajando, type RunDelMovil } from "./subagentes";

export function useSubagentes(cliente: ClienteDeOpenLen, projectId: string, elementos: readonly ElementoDelHilo[]) {
  const clave = JSON.stringify(elementos.filter(e => e.tipo === "subagentes").map(e => [e.fila, e.refs.map(r => r.id)]));
  const [estado, setEstado] = useState<{ projectId: string; porFila: ReadonlyMap<string, RunDelMovil[]> }>({ projectId, porFila: new Map() });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const filas = JSON.parse(clave) as [string, string[]][];
    if (filas.length === 0) { setEstado({ projectId, porFila: new Map() }); return; }
    let fuera = false;
    let reloj: ReturnType<typeof setTimeout>;
    const leer = async () => {
      try {
        const resultados = await Promise.all(filas.map(async ([fila, ids]) => [fila, await leerSubagentes(cliente, { projectId, fila, ids })] as const));
        if (fuera) return;
        const porFila = new Map(resultados);
        setEstado({ projectId, porFila });
        if (resultados.some(([, runs]) => trabajando(runs) > 0)) reloj = setTimeout(() => void leer(), 3000);
      } catch {
        if (!fuera) reloj = setTimeout(() => void leer(), 3000);
      }
    };
    void leer();
    return () => { fuera = true; clearTimeout(reloj); };
  }, [cliente, projectId, clave, revision]);
  const parar = useCallback(async (id: string) => {
    try { await pararSubagente(cliente, id); } finally { setRevision(r => r + 1); }
  }, [cliente]);
  const porFila = estado.projectId === projectId ? estado.porFila : new Map<string, RunDelMovil[]>();
  // Un hijo despertado puede aparecer bajo dos turnos: cuenta una sola vez.
  const unicos = new Map([...porFila.values()].flat().map(r => [r.id, r]));
  return { porFila, trabajando: trabajando([...unicos.values()]), parar };
}
