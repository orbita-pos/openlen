"use client";

// Debajo de la caja: a quién va lo que se escribe (el chat del equipo). Así
// nadie le escribe a una persona creyendo que hablaba con Len, ni al revés.

import { useTranslations } from "next-intl";
import { Fragment } from "react";

import type { Destino } from "@/lib/workspace-v2/destino-del-mensaje";

export function LineaDeDestino({ destino, puedeLen, colorDe }: { destino: Destino; puedeLen: boolean; colorDe: (userId: string) => string }) {
  const t = useTranslations("panelsChat.equipo");
  if (!puedeLen && destino.tipo !== "personas") {
    return <p className="px-3 pb-1 text-[11.5px] text-accent" data-destino="bloqueado">{t("soloEditoresLen")}</p>;
  }
  if (destino.tipo === "len") return <p className="px-3 pb-1 text-[11.5px] fg-faint" data-destino="len">{t("paraLen")}</p>;
  const nombres = destino.personas.map((p, i) => (
    <Fragment key={p.userId}>
      {i > 0 && ", "}
      <span className="font-medium" style={{ color: colorDe(p.userId) }}>{p.nombre}</span>
    </Fragment>
  ));
  // La frase se traduce con una marca en el sitio de los nombres y se parte por
  // ella: así cada idioma pone los nombres donde le toca y van con su color.
  const MARCA = "\u0000";
  const [antes, despues] = t(destino.tipo === "personas" ? "paraPersonas" : "paraLenYPersonas", { nombres: MARCA }).split(MARCA);
  return (
    <p className="px-3 pb-1 text-[11.5px] fg-faint" data-destino={destino.tipo}>
      {antes}
      {nombres}
      {despues}
    </p>
  );
}
