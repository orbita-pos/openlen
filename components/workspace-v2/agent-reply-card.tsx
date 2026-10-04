"use client";

import { useCallback, useState } from "react";
import { ChatIcon, Loader } from "./icons";
import type { RespuestaPreparada } from "@/lib/agent/resultados";
import { enlaceDeCorreo, enlaceDeWhatsApp } from "@/lib/resultados/enlaces-de-respuesta";

// EL BORRADOR QUE NO SE MANDA SOLO (plans/len-resultados/diseno.md §5). Len lo
// deja con `preparar_respuesta`; el usuario lo corrige si quiere y lo manda con
// un toque. «Enviar» contesta como el negocio por la bandeja; correo y
// WhatsApp abren SU aplicación con el texto puesto. Como la de publicar, no se
// guarda: al recargar, el borrador sigue en el texto de Len. Los textos llegan
// por props: así se prueba sin montar next-intl. La caja y
// los botones son los de `AgentConfirmCard`, para que las dos se vean iguales.

export interface EtiquetasDeRespuesta {
  titulo: (con: string) => string;
  tituloSinNombre: string;
  nota: string;
  enviar: string;
  enviando: string;
  enviado: string;
  correo: string;
  whatsapp: string;
  copiar: string;
  copiado: string;
  asunto: string;
  error: string;
}

type Estado = "listo" | "enviando" | "enviado" | "copiado" | "error";

const BOTON_PRINCIPAL =
  "inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-[11.5px] font-medium bg-[var(--accent-strong)] text-white shadow-coral hover:brightness-105 transition disabled:opacity-50 disabled:cursor-not-allowed";
const BOTON_SECUNDARIO =
  "inline-flex items-center h-7 px-2.5 rounded-md text-[11.5px] font-medium border bd fg hover:bg-hover transition disabled:opacity-50";

export function AgentReplyCard({ respuesta, labels }: { respuesta: RespuestaPreparada; labels: EtiquetasDeRespuesta }) {
  const [texto, setTexto] = useState(respuesta.texto);
  const [estado, setEstado] = useState<Estado>("listo");
  const inerte = estado === "enviado" || estado === "enviando";

  const enviar = useCallback(async () => {
    if (inerte || texto.trim() === "") return;
    setEstado("enviando");
    try {
      const r = await fetch(`/api/inbox/${encodeURIComponent(respuesta.id)}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: texto.trim() }),
      });
      setEstado(r.ok ? "enviado" : "error");
    } catch {
      setEstado("error");
    }
  }, [inerte, texto, respuesta.id]);

  const copiar = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setEstado("copiado");
    } catch {
      setEstado("error");
    }
  }, [texto]);

  const correo = respuesta.correo ? enlaceDeCorreo(respuesta.correo, labels.asunto, texto) : null;
  const whatsapp = respuesta.whatsapp ? enlaceDeWhatsApp(respuesta.whatsapp, texto) : null;

  return (
    <div className="rounded-lg border bd bg-app px-3 py-2.5">
      <div className="flex items-center gap-2 text-[12px] font-medium fg">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
          <ChatIcon size={13} />
        </span>
        <span>{respuesta.con ? labels.titulo(respuesta.con) : labels.tituloSinNombre}</span>
      </div>

      <textarea
        className="mt-2 w-full resize-y rounded-md bg-elev border bd px-2.5 py-1.5 text-[12px] fg"
        rows={3}
        value={texto}
        disabled={inerte}
        onChange={(e) => setTexto(e.target.value)}
      />
      <div className="mt-1 text-[11px] fg-faint">{labels.nota}</div>

      {estado === "error" && <div className="mt-2 text-[11px] text-red-600 dark:text-red-400">{labels.error}</div>}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {respuesta.botones.includes("enviar") && (
          <button type="button" className={BOTON_PRINCIPAL} disabled={inerte} onClick={() => void enviar()}>
            {estado === "enviando" ? (
              <>
                <Loader size={12} className="animate-spin" />
                <span>{labels.enviando}</span>
              </>
            ) : estado === "enviado" ? (
              labels.enviado
            ) : (
              labels.enviar
            )}
          </button>
        )}
        {respuesta.botones.includes("correo") && correo && (
          <a className={BOTON_SECUNDARIO} href={correo}>
            {labels.correo}
          </a>
        )}
        {respuesta.botones.includes("whatsapp") && whatsapp && (
          <a className={BOTON_SECUNDARIO} href={whatsapp} target="_blank" rel="noopener noreferrer">
            {labels.whatsapp}
          </a>
        )}
        {respuesta.botones.includes("copiar") && (
          <button type="button" className={BOTON_SECUNDARIO} onClick={() => void copiar()}>
            {estado === "copiado" ? labels.copiado : labels.copiar}
          </button>
        )}
      </div>
    </div>
  );
}
