"use client";

// La franja de estado de la Bandeja: le dice al dueño de la página quién
// contesta a sus visitantes — nadie, la IA, él mismo o ambos — y si esa
// respuesta ya está en la página viva o espera a la próxima publicación.
//
// Sólo tiene sentido DENTRO del taller (?project=<id>&view=messages): la
// Bandeja suelta (`app/[locale]/inbox/page.tsx`) es de la CUENTA, no de un
// proyecto, así que sin `projectId` no pinta nada.
//
// Es un <button> porque despliega (Tarea 6 llena el contenido); por ahora
// el bloque desplegable está vacío.
//
// Spec: docs/superpowers/specs/2026-09-16-casa-de-asistente-y-chat-design.md §2

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { estadoDeLaBurbuja } from "@/lib/inbox/estado-de-la-burbuja";

export function FranjaDeEstado(props: {
  projectId: string | null;
  nombrePagina: string;
  publicada: boolean;
  /** `hasUnpublishedChanges` del proyecto — ver la Ruling de la Tarea 4 en el ledger. */
  cambiosSinPublicar: boolean;
  asistente: boolean;
  chat: boolean;
}) {
  const t = useTranslations("wsPage");
  const [abierta, setAbierta] = useState(false);

  if (props.projectId === null) return null;

  const clave = estadoDeLaBurbuja({
    asistente: props.asistente,
    chat: props.chat,
    publicada: props.publicada,
    cambiosSinPublicar: props.cambiosSinPublicar,
  });
  const texto = t(`burbuja.${clave}`, { pagina: props.nombrePagina });

  return (
    <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        role="status"
        aria-expanded={abierta}
        onClick={() => setAbierta((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[12px] text-zinc-600 transition hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900/50 sm:px-5"
      >
        <span className="min-w-0 flex-1 truncate">{texto}</span>
        <ChevronDown
          size={13}
          className={`shrink-0 transition-transform ${abierta ? "rotate-180" : ""}`}
        />
      </button>
      {abierta && <div />}
    </div>
  );
}
