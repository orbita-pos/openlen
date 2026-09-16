"use client";
import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  INICIAL,
  PLAZO_LISTO_MS,
  motivoDeRespuesta,
  siguiente,
  type EstadoLienzo,
  type EventoLienzo,
} from "./lienzo-remoto";

// Sube cada documento del lienzo a /api/lienzo, cronometra el «listo» del
// iframe, reintenta una vez y cae a la reserva. La lógica está en
// `lienzo-remoto.ts`; esto es sólo el cableado con React y la red.

interface Interno {
  estado: EstadoLienzo;
  reintentos: number;
}

function reducir(p: Interno, ev: EventoLienzo): Interno {
  const s = siguiente(p.estado, ev);
  return { estado: s.estado, reintentos: s.subirOtraVez ? p.reintentos + 1 : p.reintentos };
}

export function useLienzoRemoto(opts: {
  html: string;
  projectId: string | null;
  pagina: string | null;
  activo: boolean;
  /** Cambia cuando el iframe se vuelve a montar con el mismo documento. */
  recarga: number;
}): { estado: EstadoLienzo; marcarListo: () => void } {
  const { html, projectId, pagina, activo, recarga } = opts;
  const [interno, despachar] = useReducer(reducir, { estado: INICIAL, reintentos: 0 });
  const estado = interno.estado;
  const local = estado.modo === "local";

  const subir = useCallback(
    async (reintento: boolean, senal: AbortSignal) => {
      try {
        const res = await fetch("/api/lienzo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, pagina, html }),
          signal: senal,
        });
        const cuerpo = (await res.json().catch(() => ({}))) as { url?: unknown; error?: unknown };
        if (senal.aborted) return;
        if (res.ok && typeof cuerpo.url === "string") despachar({ tipo: "subido", url: cuerpo.url, reintento });
        else despachar({ tipo: "fallo", motivo: motivoDeRespuesta(res.status, cuerpo.error) });
      } catch (err) {
        if (senal.aborted) return;
        console.warn("[lienzo] no se pudo subir el documento", err);
        despachar({ tipo: "fallo", motivo: "error" });
      }
    },
    [html, projectId, pagina],
  );

  // Cada documento nuevo se sube. En local no: la reserva no parpadea.
  useEffect(() => {
    if (!activo || !projectId || !html || local) return;
    const c = new AbortController();
    void subir(false, c.signal);
    return () => c.abort();
  }, [activo, projectId, html, local, subir]);

  // El reintento, una vez por documento.
  const subirRef = useRef(subir);
  subirRef.current = subir;
  useEffect(() => {
    if (interno.reintentos === 0) return;
    const c = new AbortController();
    void subirRef.current(true, c.signal);
    return () => c.abort();
  }, [interno.reintentos]);

  // Remontar el iframe vuelve a exigir «listo».
  const primeraRecarga = useRef(recarga);
  useEffect(() => {
    if (recarga === primeraRecarga.current) return;
    despachar({ tipo: "recargado" });
  }, [recarga]);

  // El plazo para que el iframe diga «listo».
  const url = estado.modo === "remoto" ? estado.url : null;
  const listo = estado.modo === "remoto" && estado.listo;
  useEffect(() => {
    if (!url || listo) return;
    const t = setTimeout(() => despachar({ tipo: "vencido" }), PLAZO_LISTO_MS);
    return () => clearTimeout(t);
  }, [url, listo, recarga]);

  const motivo = estado.modo === "local" ? estado.motivo : null;
  useEffect(() => {
    if (motivo) console.warn(`[lienzo] vista limitada: ${motivo}`);
  }, [motivo]);

  const marcarListo = useCallback(() => despachar({ tipo: "listo" }), []);
  return { estado, marcarListo };
}
