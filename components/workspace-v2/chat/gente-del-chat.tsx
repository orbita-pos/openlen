"use client";

// Quién hay en el proyecto, arriba del chat (sólo compartido): pulsar una
// inicial escribe su @ en la caja. Así se descubre el @ sin explicarlo.

import { useTranslations } from "next-intl";

import type { PersonaMencionable } from "@/lib/workspace-v2/menciones";

export function GenteDelChat({
  gente,
  yo,
  colorDe,
  onMencionar,
}: {
  gente: readonly PersonaMencionable[];
  yo: string | null;
  colorDe: (userId: string) => string;
  onMencionar: (nombre: string) => void;
}) {
  const t = useTranslations("panelsChat.equipo");
  return (
    <div className="flex items-center gap-1" data-gente-del-chat="">
      {gente
        .filter((p) => p.userId !== yo)
        .map((p) => (
          <button
            key={p.userId}
            type="button"
            title={t("mencionar", { nombre: p.nombre })}
            aria-label={t("mencionar", { nombre: p.nombre })}
            onClick={() => onMencionar(p.nombre)}
            className="grid h-6 w-6 place-items-center rounded-full text-[10.5px] font-bold text-white"
            style={{ background: colorDe(p.userId) }}
          >
            {(p.nombre.trim()[0] ?? "?").toUpperCase()}
          </button>
        ))}
    </div>
  );
}
