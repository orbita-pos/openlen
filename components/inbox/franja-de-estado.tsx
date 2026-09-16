"use client";

// La franja de estado de la Bandeja: le dice al dueño de la página quién
// contesta a sus visitantes — nadie, la IA, él mismo o ambos — y si esa
// respuesta ya está en la página viva o espera a la próxima publicación.
//
// Sólo tiene sentido DENTRO del taller (?project=<id>&view=messages): la
// Bandeja suelta (`app/[locale]/inbox/page.tsx`) es de la CUENTA, no de un
// proyecto, así que sin `projectId` no pinta nada.
//
// Es un <button> porque despliega, y el desplegable trae los DOS
// interruptores (Tarea 6): asistente y chat. Cada uno escribe por el mismo
// embudo que ya usa `assistant-panel.tsx` (PATCH .../settings, optimista con
// reversión) y, sólo tras un `ok`, avisa al taller con `onAjustesGuardados`
// para que la franja de arriba (que lee sus props de `loadedProject`) diga
// lo que acaba de cambiar.
//
// El enlace «Ajustes» de cada bloque (Tarea 7, el detalle) NO se pinta
// todavía: abriría un sitio que no existe.
//
// Spec: docs/superpowers/specs/2026-09-16-casa-de-asistente-y-chat-design.md §2

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { estadoDeLaBurbuja } from "@/lib/inbox/estado-de-la-burbuja";
import { useToast } from "@/components/workspace-v2/toast";

type ParcheDeAjuste =
  | { assistant: { enabled: boolean } }
  | { chat: { enabled: boolean } };

export function FranjaDeEstado(props: {
  projectId: string | null;
  nombrePagina: string;
  publicada: boolean;
  /** `hasUnpublishedChanges` del proyecto — ver la Ruling de la Tarea 4 en el ledger. */
  cambiosSinPublicar: boolean;
  asistente: boolean;
  chat: boolean;
  /** Se llama SÓLO tras una respuesta `ok`, con el mismo parche que se
   *  envió — el taller es quien funde el ajuste en `loadedProject` y
   *  decide si eso cuenta como cambio sin publicar (Ruling Tarea 6). */
  onAjustesGuardados: (patch: {
    assistant?: { enabled: boolean };
    chat?: { enabled: boolean };
  }) => void;
}) {
  const t = useTranslations("wsPage");
  const toast = useToast();
  const [abierta, setAbierta] = useState(false);
  // Override optimista por interruptor: `null` significa «lo que diga la
  // prop». Sólo se rellena entre el clic y la respuesta (o para revertir si
  // falla) — tras un `ok` el taller actualiza la prop y vuelve a coincidir.
  const [asistenteOverride, setAsistenteOverride] = useState<boolean | null>(null);
  const [chatOverride, setChatOverride] = useState<boolean | null>(null);
  const idAsistente = useId();
  const idChat = useId();

  const { projectId } = props;
  if (projectId === null) return null;

  const clave = estadoDeLaBurbuja({
    asistente: props.asistente,
    chat: props.chat,
    publicada: props.publicada,
    cambiosSinPublicar: props.cambiosSinPublicar,
  });
  const texto = t(`burbuja.${clave}`, { pagina: props.nombrePagina });

  const asistenteOn = asistenteOverride ?? props.asistente;
  const chatOn = chatOverride ?? props.chat;

  async function alternar(tipo: "assistant" | "chat") {
    const anterior = tipo === "assistant" ? asistenteOn : chatOn;
    const siguiente = !anterior;
    const setOverride = tipo === "assistant" ? setAsistenteOverride : setChatOverride;
    setOverride(siguiente); // optimista
    const parche: ParcheDeAjuste =
      tipo === "assistant" ? { assistant: { enabled: siguiente } } : { chat: { enabled: siguiente } };
    try {
      const r = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parche),
      });
      if (!r.ok) {
        setOverride(anterior); // reversión
        toast.error(t("toast.saveError"));
        return;
      }
      props.onAjustesGuardados(parche);
    } catch {
      setOverride(anterior); // reversión — mismo patrón que assistant-panel.tsx:76-80
      toast.error(t("toast.saveError"));
    }
  }

  return (
    <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        aria-expanded={abierta}
        onClick={() => setAbierta((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[12px] text-zinc-600 transition hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900/50 sm:px-5"
      >
        {/* El status role vive AQUÍ, no en el <button>: un botón con
            role="status" deja de anunciarse como botón, y aria-expanded no
            es válido sobre un status. El desplegable (abajo) queda FUERA de
            este span a propósito — si estuviera dentro, cada apertura
            volvería a anunciar los dos interruptores como si el texto
            hubiera cambiado. */}
        <span role="status" className="min-w-0 flex-1 truncate">
          {texto}
        </span>
        <ChevronDown
          size={13}
          className={`shrink-0 transition-transform ${abierta ? "rotate-180" : ""}`}
        />
      </button>
      {abierta && (
        <div className="space-y-3 px-3 pb-3 sm:px-5">
          <Interruptor
            tituloId={idAsistente}
            titulo={t("burbuja.bloques.asistente.titulo")}
            frase={t("burbuja.bloques.asistente.frase")}
            activo={asistenteOn}
            onToggle={() => void alternar("assistant")}
          />
          <Interruptor
            tituloId={idChat}
            titulo={t("burbuja.bloques.chat.titulo")}
            frase={t("burbuja.bloques.chat.frase")}
            activo={chatOn}
            onToggle={() => void alternar("chat")}
          />
        </div>
      )}
    </div>
  );
}

function Interruptor(props: {
  tituloId: string;
  titulo: string;
  frase: string;
  activo: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p id={props.tituloId} className="text-[12px] font-medium text-zinc-800 dark:text-zinc-200">
          {props.titulo}
        </p>
        <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{props.frase}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.activo}
        aria-labelledby={props.tituloId}
        onClick={props.onToggle}
        className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition ${
          props.activo ? "bg-coral-500" : "bg-zinc-300 dark:bg-zinc-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition ${
            props.activo ? "left-3.5" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
