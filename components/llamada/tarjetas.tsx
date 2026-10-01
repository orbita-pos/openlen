"use client";
// Las tarjetas que salen mientras Len habla. Visitas: los números de
// /api/voz/visitas, que son los de `ver_visitas`. Borrador y publicar: las
// MISMAS tarjetas del chat (el toque del usuario es lo único que manda o publica).
// Esas dos pintan con clases que sólo existen dentro de `.workspace-v2` (los
// tokens de app/[locale]/new/tokens.css, que la página de la llamada carga):
// sin ese envoltorio, la caja del borrador heredaba el blanco de la pantalla y
// el texto de Len no se veía (llamadas del 01/10).
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AgentConfirmCard } from "@/components/workspace-v2/agent-confirm-card";
import { AgentReplyCard, type EtiquetasDeRespuesta } from "@/components/workspace-v2/agent-reply-card";
import type { DatosDeVisitas } from "@/lib/voz/tarjeta-de-visitas";
import type { TarjetaDeLlamada } from "./puente-a-len";

function TarjetaDeVisitas({ projectId }: { projectId: string }) {
  const t = useTranslations("llamada.visitas");
  const [d, setD] = useState<DatosDeVisitas | null>(null);
  useEffect(() => {
    const zona = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
    void fetch(`/api/voz/visitas?project=${encodeURIComponent(projectId)}&zona=${zona}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setD)
      .catch(() => setD(null));
  }, [projectId]);
  if (!d) return null;
  const max = Math.max(1, ...d.porDia.map((x) => x.vistas));
  return (
    <div className="w-full rounded-2xl bg-white/95 p-4 text-[#1c0d04] shadow-lg">
      <p className="text-xs uppercase tracking-wide opacity-60">{t("titulo")}</p>
      <p className="text-4xl font-semibold">{d.vistas}</p>
      <p className="text-xs opacity-60">
        {t("personas", { n: d.personas })} · {t("hoy", { n: d.hoy })}
      </p>
      <div className="mt-3 flex h-16 items-end gap-1">
        {d.porDia.map((x) => (
          <div key={x.dia} className="flex-1 rounded-t bg-[#f97316]" style={{ height: `${(100 * x.vistas) / max}%` }} title={`${x.dia}: ${x.vistas}`} />
        ))}
      </div>
      {d.origen && <p className="mt-2 text-xs font-medium">{t("llegan", { origen: d.origen.origen, n: d.origen.deCadaDiez })}</p>}
    </div>
  );
}

export function TarjetasDeLaLlamada({ projectId, tarjetas }: { projectId: string; tarjetas: TarjetaDeLlamada[] }) {
  const t = useTranslations("llamada");
  const tAgent = useTranslations("wsPage.agent");
  const etiquetas = useMemo<EtiquetasDeRespuesta>(
    () => ({
      titulo: (con) => tAgent("respuesta.titulo", { con }),
      tituloSinNombre: tAgent("respuesta.tituloSinNombre"),
      nota: tAgent("respuesta.nota"),
      enviar: tAgent("respuesta.enviar"),
      enviando: tAgent("respuesta.enviando"),
      enviado: tAgent("respuesta.enviado"),
      correo: tAgent("respuesta.correo"),
      whatsapp: tAgent("respuesta.whatsapp"),
      copiar: tAgent("respuesta.copiar"),
      copiado: tAgent("respuesta.copiado"),
      asunto: tAgent("respuesta.asunto"),
      error: tAgent("respuesta.error"),
    }),
    [tAgent],
  );
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      {tarjetas.map((x, i) =>
        x.tipo === "visitas" ? (
          <TarjetaDeVisitas key={i} projectId={projectId} />
        ) : x.tipo === "texto" ? (
          <div key={i} className="rounded-2xl bg-white/95 p-4 text-sm text-[#1c0d04] shadow-lg">
            <p className="mb-1 text-xs uppercase tracking-wide opacity-60">{t("textoDeLen")}</p>
            <p className="whitespace-pre-wrap">{x.texto}</p>
          </div>
        ) : x.tipo === "respuesta" ? (
          <div key={i} className="workspace-v2 rounded-2xl p-2 shadow-lg">
            <AgentReplyCard respuesta={x.respuesta} labels={etiquetas} />
          </div>
        ) : (
          <div key={i} className="workspace-v2 rounded-2xl p-2 shadow-lg">
            <AgentConfirmCard projectId={projectId} confirm={x.confirm} onPublished={() => {}} />
          </div>
        ),
      )}
    </div>
  );
}
