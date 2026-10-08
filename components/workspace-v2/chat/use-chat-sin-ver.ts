"use client";

// Las menciones del chat sin ver (el chat del equipo), para el punto del
// carril. Cada 30 s, como los hilos; con el chat a la vista, 0 (verlo las ve).
// En un proyecto sin miembros, una pregunta y ya: el servidor dice que no es
// compartido y se deja de preguntar.

import { useEffect, useState } from "react";

import type { ChatLayout } from "./use-chat-version";

/** ¿El chat está DE VERDAD a la vista? Minimizado no (ni marca nada visto);
 *  flotante sí aunque el panel esté plegado; anclado, sólo desplegado. En el
 *  móvil el chat siempre va anclado. */
export function chatALaVista(p: { mode: string; plegado: boolean; layout: ChatLayout; movil: boolean }): boolean {
  if (p.mode !== "chat") return false;
  if (p.movil || p.layout === "docked") return !p.plegado;
  return p.layout === "floating";
}

export function useChatSinVer(projectId: string | null, chatAbierto: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!projectId || chatAbierto) {
      setN(0);
      return;
    }
    let vivo = true;
    let reloj: number | undefined;
    const leer = () =>
      void fetch(`/api/projects/${encodeURIComponent(projectId)}/chat/mensajes?solo=sinVer`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!vivo || !j) return;
          if (typeof j.sinVer === "number") setN(j.sinVer);
          if (j.compartido === false) window.clearInterval(reloj);
        })
        .catch(() => {});
    leer();
    reloj = window.setInterval(leer, 30_000);
    return () => {
      vivo = false;
      window.clearInterval(reloj);
    };
  }, [projectId, chatAbierto]);
  return n;
}
