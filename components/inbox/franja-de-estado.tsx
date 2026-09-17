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
// Cada bloque lleva además su enlace «Ajustes» (Tarea 7), que abre el
// DETALLE en un cajón lateral: `ajustes-del-asistente.tsx` y
// `ajustes-del-chat.tsx`. Un formulario de 4.000 caracteres y una lista de
// respuestas no caben en la cabecera de la Bandeja.
//
// Spec: docs/superpowers/specs/2026-09-16-casa-de-asistente-y-chat-design.md §2

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { ChevronDown, X } from "lucide-react";
import type { AssistantSettings, ChatSettings } from "@/lib/projects/types";
import { estadoDeLaBurbuja } from "@/lib/inbox/estado-de-la-burbuja";
import { useToast } from "@/components/workspace-v2/toast";
import { useFocusTrap } from "@/components/workspace-v2/use-focus-trap";
import { AjustesDelAsistente } from "./ajustes-del-asistente";
import { AjustesDelChat } from "./ajustes-del-chat";

/** Se llama SÓLO tras una respuesta `ok`, con el mismo parche que se envió —
 *  el taller es quien funde el ajuste en `loadedProject` y decide si eso
 *  cuenta como cambio sin publicar (Ruling Tarea 6). Ensanchado en la Tarea 7:
 *  el detalle escribe cualquier campo del asistente o del chat, y todos se
 *  hornean al publicar. */
export type OnAjustesGuardados = (patch: {
  assistant?: Partial<AssistantSettings>;
  chat?: Partial<ChatSettings>;
}) => void;

type ParcheDeAjuste =
  | { assistant: { enabled: boolean } }
  | { chat: { enabled: boolean } };

type Detalle = "asistente" | "chat";

export function FranjaDeEstado(props: {
  projectId: string | null;
  nombrePagina: string;
  publicada: boolean;
  /** `hasUnpublishedChanges` del proyecto — ver la Ruling de la Tarea 4 en el ledger. */
  cambiosSinPublicar: boolean;
  asistente: boolean;
  chat: boolean;
  /** `settings.chat` del proyecto, para el detalle del chat. El del asistente
   *  lo lee su detalle del servidor al abrirse (trae también el consumo). */
  ajustesChat: ChatSettings | undefined;
  onAjustesGuardados: OnAjustesGuardados;
}) {
  const t = useTranslations("wsPage");
  const toast = useToast();
  const [abierta, setAbierta] = useState(false);
  // Override optimista por interruptor: `null` significa «lo que diga la
  // prop». Vive SÓLO mientras su petición está en vuelo — se pone en el
  // clic y se limpia a `null` en cuanto la respuesta se asienta, gane o
  // pierda. En éxito la prop YA es la verdad (el taller acaba de fundir el
  // parche en `loadedProject`); en fallo la prop nunca cambió, así que
  // limpiar ES la reversión. Un override que sobreviviera al asentarse
  // dejaría el interruptor mintiendo si algo más (Len, otro proyecto)
  // cambia la prop por debajo — fix ronda 1 del repaso de la Tarea 6.
  const [asistenteOverride, setAsistenteOverride] = useState<boolean | null>(null);
  const [chatOverride, setChatOverride] = useState<boolean | null>(null);
  const idAsistente = useId();
  const idChat = useId();
  // Qué detalle está abierto, y QUÉ enlace lo abrió: al cerrar, el foco vuelve
  // a ese enlace y no se pierde en el <body>.
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const enlaceQueAbrio = useRef<HTMLButtonElement | null>(null);

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
  // Un override no-nulo ES "esta petición sigue en vuelo" — nace en el clic
  // y muere en el `finally` de abajo, así que no hace falta un estado propio.
  const asistenteGuardando = asistenteOverride !== null;
  const chatGuardando = chatOverride !== null;

  async function alternar(tipo: "assistant" | "chat") {
    const enVuelo = tipo === "assistant" ? asistenteGuardando : chatGuardando;
    if (enVuelo) return; // un segundo clic mientras se guarda no hace nada
    const actual = tipo === "assistant" ? asistenteOn : chatOn;
    const siguiente = !actual;
    const setOverride = tipo === "assistant" ? setAsistenteOverride : setChatOverride;
    setOverride(siguiente); // optimista — y esto marca "en vuelo"
    const parche: ParcheDeAjuste =
      tipo === "assistant" ? { assistant: { enabled: siguiente } } : { chat: { enabled: siguiente } };
    try {
      const r = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parche),
      });
      if (!r.ok) {
        toast.error(t("toast.saveError"));
        return;
      }
      props.onAjustesGuardados(parche);
    } catch {
      // Mismo patrón que assistant-panel.tsx:76-80: revertir es no dejar
      // rastro — y aquí "no dejar rastro" es limpiar el override en el
      // `finally`, no restaurar un valor recordado a mano.
      toast.error(t("toast.saveError"));
    } finally {
      setOverride(null);
    }
  }

  function abrirDetalle(cual: Detalle, enlace: HTMLButtonElement) {
    enlaceQueAbrio.current = enlace;
    setDetalle(cual);
  }

  function cerrarDetalle() {
    // El foco se devuelve ANTES de desmontar el cajón, a mano. La trampa de
    // foco restaura lo que estuviera enfocado al abrir, pero un clic no enfoca
    // el botón en todos los navegadores (Safari), y entonces lo restaurado era
    // el <body>. Y moverlo antes tiene otra ventaja: el campo que tenía el
    // foco recibe su `blur` y guarda lo escrito, aunque se cierre con Escape.
    enlaceQueAbrio.current?.focus();
    setDetalle(null);
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
        {/* ENVUELVE, no trunca. A 390 px el nombre de la página se lleva la
            línea entera y `truncate` cortaba justo el final —«En «QA F2 Con
            Plataformas 1785718010921» conte…»—, que es quién contesta: lo
            único que esta franja existe para decir. Una segunda línea en un
            móvil es más barata que perder el mensaje.

            El corte por dentro de palabra no es un adorno: `truncate` tapaba de
            paso los títulos sin espacios —los que salen de un slug—, y sin él
            uno solo desbordaría la franja a lo ancho. */}
        <span role="status" className="min-w-0 flex-1 [overflow-wrap:anywhere]">
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
            ajustes={t("burbuja.bloques.ajustes")}
            activo={asistenteOn}
            guardando={asistenteGuardando}
            onToggle={() => void alternar("assistant")}
            onAjustes={(enlace) => abrirDetalle("asistente", enlace)}
          />
          <Interruptor
            tituloId={idChat}
            titulo={t("burbuja.bloques.chat.titulo")}
            frase={t("burbuja.bloques.chat.frase")}
            ajustes={t("burbuja.bloques.ajustes")}
            activo={chatOn}
            guardando={chatGuardando}
            onToggle={() => void alternar("chat")}
            onAjustes={(enlace) => abrirDetalle("chat", enlace)}
          />
        </div>
      )}
      {detalle !== null && (
        <CajonDeAjustes
          titulo={
            detalle === "asistente"
              ? t("burbuja.bloques.asistente.titulo")
              : t("burbuja.bloques.chat.titulo")
          }
          onCerrar={cerrarDetalle}
        >
          {detalle === "asistente" ? (
            <AjustesDelAsistente
              projectId={projectId}
              onAjustesGuardados={props.onAjustesGuardados}
            />
          ) : (
            <AjustesDelChat
              projectId={projectId}
              settings={props.ajustesChat}
              onAjustesGuardados={props.onAjustesGuardados}
            />
          )}
        </CajonDeAjustes>
      )}
    </div>
  );
}

function Interruptor(props: {
  tituloId: string;
  titulo: string;
  frase: string;
  /** Texto del enlace que abre el detalle del bloque. */
  ajustes: string;
  activo: boolean;
  /** Su PATCH sigue en vuelo — deshabilitado, y sin tocar al otro interruptor. */
  guardando: boolean;
  onToggle: () => void;
  onAjustes: (enlace: HTMLButtonElement) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p id={props.tituloId} className="text-[12px] font-medium text-zinc-800 dark:text-zinc-200">
          {props.titulo}
        </p>
        <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{props.frase}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {/* Un <button> con cara de enlace: abre un diálogo, no navega. */}
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={(e) => props.onAjustes(e.currentTarget)}
          className="text-[11px] font-medium text-zinc-500 underline-offset-2 transition hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          {props.ajustes}
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={props.activo}
          aria-labelledby={props.tituloId}
          aria-disabled={props.guardando}
          disabled={props.guardando}
          onClick={props.onToggle}
          className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition disabled:opacity-50 ${
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
    </div>
  );
}

// EL CAJÓN — portado del patrón de `ModuleDrawer` (modules-panel.tsx, que muere
// en la Tarea 8) y del caparazón de `modal-shell.tsx`:
// - Portal al <body>, SIEMPRE: `fixed` se resuelve contra el ancestro
//   transformado más cercano, y dentro de la cabecera de la Bandeja quedaría
//   encajado en ella.
// - El velo lleva `workspace-v2 ol-scrim`: sin la clase, los hijos no ven las
//   variables del taller; con ella sola, el velo se pintaría del color de la
//   página (ver el comentario de `.ol-scrim` en tokens.css).
// - Trampa de foco; Escape, el aspa y un clic en el velo lo cierran.
// - Se monta sólo abierto: sin animación de salida no hace falta `inert`.
function CajonDeAjustes(props: { titulo: string; onCerrar: () => void; children: ReactNode }) {
  const tc = useTranslations("common");
  const tituloId = useId();
  const trampa = useFocusTrap(true);
  const { onCerrar } = props;

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [onCerrar]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="workspace-v2 ol-scrim fixed inset-0 z-50" onClick={onCerrar}>
      <div
        ref={trampa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="nice-scroll fixed right-0 top-0 h-full w-[400px] max-w-[92vw] overflow-y-auto border-l bd bg-app shadow-2xl"
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id={tituloId} className="text-[16px] font-semibold leading-tight tracking-[-0.01em] fg">
              {props.titulo}
            </h2>
            <button
              type="button"
              aria-label={tc("close")}
              onClick={onCerrar}
              className="-mr-1 -mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg fg-faint transition hover:bg-hover hover:fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
          <div className="mt-4">{props.children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
