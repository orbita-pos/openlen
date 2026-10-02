"use client";

// LOS PASOS DE UN TURNO TERMINADO, DETRÁS DE UNA FILA (la #13 de
// plans/len-agente-2026/notas/fase-5-taller.md), como DeepSeek: «Completado en
// 1min 4s» y, al abrirla, las tarjetas de lo que hizo Len. Cuándo se pliega lo
// decide `lib/workspace-v2/proceso-del-turno.ts`; aquí sólo se pinta.
//
// Mientras el turno corre, los pasos se ven sin fila. Cuando cierra bien, se
// pliegan solos —salvo que el foco del teclado esté dentro: plegarlo lo
// escondería—, que es la regla de allí. Cerrarlo desmonta las tarjetas, así
// que lo que tuvieran desplegado vuelve plegado al abrir otra vez: «cerrar el
// turno entero reinicia lo de dentro».
//
// El contenedor de los pasos es el MISMO antes y después de cerrar: la fila
// entra delante, y las tarjetas no se vuelven a montar al terminar el turno.

import { useEffect, useRef, useState, type ReactNode } from "react";

import { ChevronDown, ChevronRight } from "./icons";

export function ProcesoPlegable({
  plegable,
  titulo,
  children,
}: {
  /** El turno cerró bien y tiene pasos: hay fila, y los pasos van detrás. */
  plegable: boolean;
  titulo: ReactNode;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(!plegable);
  const caja = useRef<HTMLDivElement>(null);
  const antes = useRef(plegable);
  useEffect(() => {
    if (plegable === antes.current) return;
    antes.current = plegable;
    if (!plegable) {
      setAbierto(true);
      return;
    }
    const foco = typeof document === "undefined" ? null : document.activeElement;
    if (foco && caja.current?.contains(foco)) return;
    setAbierto(false);
  }, [plegable]);

  return (
    <div data-proceso-del-turno={plegable ? (abierto ? "abierto" : "plegado") : "a-la-vista"}>
      {plegable && (
        <button
          type="button"
          aria-expanded={abierto}
          onClick={() => setAbierto((x) => !x)}
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] fg-muted hover:fg hover:bg-hover ui-small"
        >
          {abierto ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>{titulo}</span>
        </button>
      )}
      {(!plegable || abierto) && (
        <div ref={caja} className={plegable ? "mt-1" : undefined}>
          {children}
        </div>
      )}
    </div>
  );
}
