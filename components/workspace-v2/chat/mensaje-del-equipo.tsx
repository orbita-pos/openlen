"use client";

// UN MENSAJE ENTRE PERSONAS en el chat (el chat del equipo): más ligero que un
// turno —sin pasos ni créditos—, con quién a quién y «Len no responde». Lo
// propio a la derecha, lo de los demás a la izquierda; cada uno en su color.

import { useTranslations } from "next-intl";

import type { PersonaMencionable } from "@/lib/workspace-v2/menciones";
import { AvatarContent } from "../avatar-content";
import { TextoConMenciones } from "../hilos-del-codigo";
import type { DesignTurn } from "./use-agent-chat";

export function MensajeDelEquipo({
  turn,
  gente,
  yo,
  colorDe,
}: {
  turn: DesignTurn;
  gente: readonly PersonaMencionable[];
  yo: string | null;
  colorDe: (userId: string) => string;
}) {
  const t = useTranslations("panelsChat.equipo");
  const autorId = turn.autorId ?? "";
  const propio = autorId === yo;
  // Quien ya no es del proyecto no está en `gente`: su nombre viene en la fila.
  const nombre = (id: string) =>
    gente.find((p) => p.userId === id)?.nombre ?? turn.nombres?.[id] ?? (id === autorId ? turn.autor : undefined) ?? "?";
  const para = (turn.menciones ?? []).map(nombre).join(", ");
  // Las fotos que lleva el mensaje (una, o todas si son varias).
  const fotos = turn.attachedImages ?? (turn.attachedImage ? [turn.attachedImage] : []);
  const inicial =(nombre(autorId).trim()[0] ?? "?").toUpperCase();
  const avatar = gente.find((p) => p.userId === autorId)?.avatar ?? null;
  return (
    <div className={`nc-up flex items-start gap-2 ${propio ? "flex-row-reverse" : ""}`} data-mensaje-del-equipo={propio ? "propio" : "ajeno"}>
      <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full text-[10.5px] font-bold text-white" style={{ background: colorDe(autorId) }}>
        <AvatarContent avatar={avatar} initial={inicial} />
      </span>
      <div className={`min-w-0 max-w-[84%] ${propio ? "text-right" : ""}`}>
        <p className="text-[11px] fg-faint">{t("deA", { autor: nombre(autorId), para })}</p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed fg">
          <TextoConMenciones texto={turn.userText} gente={gente} colorDe={colorDe} />
        </p>
        {fotos.length > 0 && (
          <div className={`mt-1.5 flex flex-wrap gap-1.5 ${propio ? "justify-end" : ""}`}>
            {fotos.map((f) => (
              <a key={f.url} href={f.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt={f.alt ?? ""} className="h-16 w-16 rounded-[8px] border bd object-cover" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
