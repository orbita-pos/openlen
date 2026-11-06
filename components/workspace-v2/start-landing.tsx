// Start landing — the empty state of a blank project at /new: what you see before the first message to Len.
//
// SINCE 06/11 IT IS THE HOME'S SCREEN (Jesús, on Gemini: «/new y / quiero que sea compartido»): the question of the
// time of day, and under it the box — the home's own (`components/prompt-box.tsx`) in the workspace's tokens —, with
// the home's light behind it in the dark theme (it is made for black). Around it, the start frame's rail and top row
// (`start-rail.tsx`, mounted by the page). Nothing under the box any more: the template gallery has its place in the
// rail («Plantillas», `template-gallery.tsx`) and «Pegar HTML» went into the box's `+` menu.

"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { useTranslations } from "next-intl";
import { ClipboardPaste } from "lucide-react";
import type { BriefFormState } from "@/components/workspace/types";
import { type PageEffort } from "./panels/ai-brief-panel";
import "./chat/new-chat.css";
import { useFileDrop } from "./chat/use-file-drop";
import { DropOverlay } from "./chat/drop-overlay";
import { registrarUso } from "@/lib/uso/cliente";
import type { NaceComo } from "./tarjetas-nace-como";
import { PromptBox, type KindChoice, type PromptBoxOption, type PromptBoxTextArea } from "@/components/prompt-box";
import { HomeQuestion } from "@/components/marketing/home-question";
import { HomeGlow } from "@/components/marketing/home-glow";
import { CajaConMenciones } from "./hilos-del-codigo";
import { hasLink } from "@/lib/chat/links";
import type { PersonaMencionable } from "@/lib/workspace-v2/menciones";

// The first message has nobody to mention: the box only paints its URLs.
const NO_PEOPLE: readonly PersonaMencionable[] = [];
const NO_COLOR = () => "";

export interface StartLandingProps {
  /** The shared AI brief form state ({ prompt, setPrompt }). */
  aiState: BriefFormState;
  onGenerate: () => void;
  generating: boolean;
  /** Cuánto trabajo se pone en la página; hoy sólo `low` está vivo. */
  effort: PageEffort;
  onEffortChange: (effort: PageEffort) => void;
  /** Switch to the paste-HTML entry flow (the box's `+` menu, for a page). */
  onPaste: () => void;
  /** What the project is born as: the pill in the composer's row (it was a grid of cards above it until 06/11). */
  naceComo: NaceComo;
  onNaceComoChange: (v: NaceComo) => void;
  /** TOOLS MADE BY LEN (spec local 2026-11-04-herramientas-hechas-por-len, §4.9 door 2): Herramienta in the pill, when tools are on. */
  conHerramienta?: boolean;
  /** Why the tool card can't be chosen (the Free plan). */
  herramientaBloqueada?: string;
  /** THE GAME MODE (spec local 2026-11-05-modo-juego-design, §8.2): Juego in the pill, when games are on. */
  conJuego?: boolean;
}

/** The box's placeholder for each kind; a page keeps the box's own. */
const PLACEHOLDERS: Record<NaceComo, string | null> = {
  pagina: null,
  app: "start.kind.appPlaceholder",
  game: "start.kind.gamePlaceholder",
  tool: "start.kind.toolPlaceholder",
};

export function StartLanding({
  aiState,
  onGenerate,
  generating,
  effort,
  onEffortChange,
  onPaste,
  naceComo,
  onNaceComoChange,
  conJuego = false,
  conHerramienta = false,
  herramientaBloqueada,
}: StartLandingProps) {
  const tw = useTranslations("wsChrome");
  const tch = useTranslations("panelsChat");
  // DROP ANYWHERE ON THE START SCREEN (spec local 2026-10-27-chat-drop-and-images): the composer
  // below owns the photos and files, and lends its way in here.
  const addFilesRef = useRef<((files: File[]) => void) | null>(null);
  const drop = useFileDrop({ enabled: !generating, onFiles: (files) => addFilesRef.current?.(files) });

  // EL PRIMER PASO DEL EMBUDO DE CREAR: la pantalla se VIO. Sin él no hay forma
  // de separar a quien se fue sin intentarlo de quien nunca llegó (lib/uso/).
  // El ref evita el doble registro del montaje doble de StrictMode.
  const vistaRegistrada = useRef(false);
  useEffect(() => {
    if (vistaRegistrada.current) return;
    vistaRegistrada.current = true;
    registrarUso("crear_vista", {});
  }, []);

  const placeholder = PLACEHOLDERS[naceComo];
  // Pasting HTML is a PAGE thing: with App, Juego or Herramienta chosen there is no HTML to paste.
  const moreOptions: PromptBoxOption[] =
    naceComo === "pagina"
      ? [{ key: "paste", icon: <ClipboardPaste size={15} />, title: tw("start.pasteTitle"), hint: tw("start.pasteHint"), onSelect: onPaste }]
      : [];

  return (
    // The drop zone wraps the whole screen, so the overlay covers what is in view.
    <div className="relative flex min-h-0 min-w-0 flex-1" {...drop.handlers}>
      {drop.dragging && (
        <div className="nc">
          <DropOverlay label={tch("composer.dropHere")} />
        </div>
      )}
      {/* `isolate` + `overflow-hidden`: the light (z-index -1, 100vw wide) stays above this screen's background and is
          cut at its edges, as the home's wrapper does there. */}
      <section className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col justify-center overflow-hidden fg">
        {/* WHERE IT SITS, like the home (`hero.tsx`): the box in the middle, the question above it. */}
        <div className="relative mx-auto w-full max-w-5xl px-6 pb-24 [@media(max-height:500px)]:pb-4">
          <div className="flex flex-col items-center text-center">
            <HomeQuestion as="h2" />
            <div className="relative mt-8 w-full max-w-3xl text-left [@media(max-height:500px)]:mt-5">
              {/* The home's light is made for black: in the light theme there is none. */}
              <div className="hidden dark:block">
                <HomeGlow />
              </div>
              <HeroComposer
                state={aiState}
                onGenerate={onGenerate}
                generating={generating}
                effort={effort}
                onEffortChange={onEffortChange}
                addFilesRef={addFilesRef}
                kind={{ value: naceComo, onChange: onNaceComoChange, conJuego, conHerramienta, ...(herramientaBloqueada ? { herramientaBloqueada } : {}) }}
                {...(placeholder ? { placeholder: tw(placeholder) } : {})}
                moreOptions={moreOptions}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// THE /new BOX IS THE HOME'S BOX (`components/prompt-box.tsx`, Jesús, 06/11: «dos inputs así es duplicación»), in the
// workspace's tokens. What stays here is /new's: the text and attachments live in the page (it sends the first message
// to Len), PDFs and videos go too, a drop zone around can lend them in, URLs paint blue as you type, and the usage
// funnel counts «wrote» and «sent» — never with the text.
export function HeroComposer({
  state,
  onGenerate,
  generating,
  placeholder,
  addFilesRef,
  kind,
  moreOptions,
}: {
  state: BriefFormState;
  onGenerate: () => void;
  generating: boolean;
  effort: PageEffort;
  onEffortChange: (effort: PageEffort) => void;
  /** Lo que se lee en la caja vacía; sin él, el de una página. */
  placeholder?: string;
  /** Where the composer lends its way in to a drop zone around it (the start screen). */
  addFilesRef?: MutableRefObject<((files: File[]) => void) | null>;
  /** What the project is born as: the home page's pill in this composer's row (Jesús, 06/11). Absent = no pill. */
  kind?: KindChoice;
  /** More entries of the `+` menu (the start screen's «Pegar HTML»). */
  moreOptions?: readonly PromptBoxOption[];
}) {
  const t = useTranslations("panelsA");
  // «WROTE» IS THE STEP BETWEEN LOOKING AND TRYING: logged the first time text comes in by any of the three doors —
  // keyboard, paste or dictation — and never again in this visit. It never carries the text.
  const wrote = useRef(false);
  const markWrote = () => {
    if (wrote.current) return;
    wrote.current = true;
    registrarUso("crear_escribio", {});
  };

  return (
    <PromptBox
      piel="taller"
      value={state.prompt}
      onValueChange={state.setPrompt}
      truncation={{
        value: state.truncatedPrompt,
        onValueChange: state.setTruncatedPrompt,
        token: state.truncationAnnouncementToken,
        onTokenChange: state.setTruncationAnnouncementToken,
      }}
      photos={state.fotos}
      onPhotosChange={state.setFotos}
      {...(state.setPdfs ? { files: state.pdfs ?? [], onFilesChange: state.setPdfs } : {})}
      {...(kind ? { kind } : {})}
      placeholder={placeholder ?? t("aiBrief.placeholder")}
      onSend={() => {
        // Sending is ONE event though there are two ways, Enter and the button. Only the shape of the brief — how
        // many images —, never the brief.
        registrarUso("crear_envio", { imagenes: state.fotos.length });
        onGenerate();
      }}
      sending={generating}
      locked={generating}
      onTyped={markWrote}
      {...(addFilesRef ? { addFilesRef } : {})}
      {...(moreOptions ? { moreOptions } : {})}
      textArea={PAINTED_TEXT_AREA}
    />
  );
}

/** /new's text area: a URL turns blue while it's written, as in the chat. */
const PAINTED_TEXT_AREA: PromptBoxTextArea = ({ cajaRef, value, medida, props }) => (
  <CajaConMenciones
    cajaRef={cajaRef}
    pintar={hasLink(value)}
    gente={NO_PEOPLE}
    colorDe={NO_COLOR}
    medida={medida}
    value={value}
    {...props}
  />
);
