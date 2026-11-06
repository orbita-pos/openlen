// Start landing — the center surface a first-time user sees at a bare /new
// (no project yet). It leads with the can't-fail CATALOG (a mosaic of verified
// templates, $0, one click) while keeping the AI brief visible as the hero
// input — "catalog-first, AI not buried". Picking a template previews it in
// place (same flow as the sidebar gallery); typing + generate runs the normal
// AI flow. No new machinery — this just composes the pieces that already exist.

"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { BriefFormState } from "@/components/workspace/types";
import { type PageEffort } from "./panels/ai-brief-panel";
import { TemplatePreviewFrame } from "./template-preview-frame";
import { useTemplates } from "./use-templates";
import {
  TEMPLATE_FAMILIES,
  type TemplateFamily,
  type TemplateSpec,
} from "./templates-data";
import { Search } from "./icons";
import "./chat/new-chat.css";
import { useFileDrop } from "./chat/use-file-drop";
import { DropOverlay } from "./chat/drop-overlay";
import { registrarUso } from "@/lib/uso/cliente";
import type { NaceComo } from "./tarjetas-nace-como";
import { PromptBox, type KindChoice, type PromptBoxTextArea } from "@/components/prompt-box";
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
  /** Preview a template in the main area (it clones on commit). */
  onPreviewTemplate: (t: TemplateSpec) => void;
  /** Switch to the paste-HTML entry flow. */
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

/** What the empty state says for each kind: its headline, its subtitle and the composer's placeholder. */
const TEXTS: Record<NaceComo, { headline: string; subtitle: string; placeholder?: string }> = {
  pagina: { headline: "start.headline", subtitle: "start.subtitle" },
  app: { headline: "start.kind.headline", subtitle: "start.kind.subtitle", placeholder: "start.kind.appPlaceholder" },
  game: { headline: "start.kind.gameHeadline", subtitle: "start.kind.gameSubtitle", placeholder: "start.kind.gamePlaceholder" },
  tool: { headline: "start.kind.toolHeadline", subtitle: "start.kind.toolSubtitle", placeholder: "start.kind.toolPlaceholder" },
};

export function StartLanding({
  aiState,
  onGenerate,
  generating,
  effort,
  onEffortChange,
  onPreviewTemplate,
  onPaste,
  naceComo,
  onNaceComoChange,
  conJuego = false,
  conHerramienta = false,
  herramientaBloqueada,
}: StartLandingProps) {
  const tw = useTranslations("wsChrome");
  const tp = useTranslations("panelsA");
  const tf = useTranslations("families");
  const tch = useTranslations("panelsChat");
  // DROP ANYWHERE ON THE START SCREEN (spec local 2026-10-27-chat-drop-and-images): the composer
  // below owns the photos and files, and lends its way in here.
  const addFilesRef = useRef<((files: File[]) => void) | null>(null);
  const drop = useFileDrop({ enabled: !generating, onFiles: (files) => addFilesRef.current?.(files) });

  const { templates, isLoading, error } = useTemplates();
  const [familyFilter, setFamilyFilter] = useState<TemplateFamily | "all">(
    "all",
  );
  const [familiesExpanded, setFamiliesExpanded] = useState(false);
  const [query, setQuery] = useState("");

  // EL PRIMER PASO DEL EMBUDO DE CREAR: la pantalla se VIO. Sin él no hay forma
  // de separar a quien se fue sin intentarlo de quien nunca llegó (lib/uso/).
  // El ref evita el doble registro del montaje doble de StrictMode.
  const vistaRegistrada = useRef(false);
  useEffect(() => {
    if (vistaRegistrada.current) return;
    vistaRegistrada.current = true;
    registrarUso("crear_vista", {});
  }, []);

  // Only surface family chips that actually have templates — a dead chip on
  // the home screen reads as a broken filter.
  const familyCounts = useMemo(() => {
    const m = new Map<TemplateFamily, number>();
    for (const tpl of templates) m.set(tpl.family, (m.get(tpl.family) ?? 0) + 1);
    return m;
  }, [templates]);
  const availableFamilies = useMemo(
    () => TEMPLATE_FAMILIES.filter((f) => (familyCounts.get(f.id) ?? 0) > 0),
    [familyCounts],
  );
  const shownChips = familiesExpanded
    ? availableFamilies
    : availableFamilies.filter((f, i) => i < 10 || f.id === familyFilter);
  const hiddenCount = availableFamilies.length - shownChips.length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = templates.filter((tpl) => {
      if (familyFilter !== "all" && tpl.family !== familyFilter) return false;
      if (!q) return true;
      return `${tpl.name} ${tpl.pitch} ${tpl.family}`
        .toLowerCase()
        .includes(q);
    });
    // Featured ("popular") templates lead the wall — the verified hero picks
    // a creator should see first. Stable otherwise, so server order is kept.
    return list.sort((a, b) => Number(b.featured) - Number(a.featured));
  }, [templates, familyFilter, query]);

  return (
    // The drop zone wraps the scrolling section, so the overlay covers what is in view.
    <div className="relative flex min-h-0 min-w-0 flex-1" {...drop.handlers}>
      {drop.dragging && (
        <div className="nc">
          <DropOverlay label={tch("composer.dropHere")} />
        </div>
      )}
      <section className="flex-1 min-w-0 min-h-0 overflow-y-auto nice-scroll bg-app">
        <div className="mx-auto max-w-5xl px-6 py-10 sm:py-12">
          {/* Hero copy */}
          <div className="text-center mb-6">
            <h2 className="text-[26px] sm:text-[31px] font-semibold fg tracking-tight leading-tight">
              {tw(TEXTS[naceComo].headline)}
            </h2>
            <p className="mt-2.5 text-[13px] fg-muted leading-relaxed max-w-md mx-auto">
              {tw(TEXTS[naceComo].subtitle)}
            </p>
          </div>

          {/* The composer, with what the project is born as in its own row — the
              home page's pill (Jesús, 06/11: the grid of cards above it pushed it
              down). */}
          <div className="max-w-2xl mx-auto">
            <HeroComposer
              state={aiState}
              onGenerate={onGenerate}
              generating={generating}
              effort={effort}
              onEffortChange={onEffortChange}
              addFilesRef={addFilesRef}
              kind={{ value: naceComo, onChange: onNaceComoChange, conJuego, conHerramienta, ...(herramientaBloqueada ? { herramientaBloqueada } : {}) }}
              {...(TEXTS[naceComo].placeholder ? { placeholder: tw(TEXTS[naceComo].placeholder) } : {})}
            />
            {/* Pegar HTML y la galería son de PÁGINAS: con App elegida no hay
                plantilla que clonar ni HTML que pegar, y enseñarlas sería
                ofrecer justo lo que el dueño acaba de decir que no quiere. */}
            {naceComo === "pagina" && (
              <div className="mt-2.5 text-center">
                <button
                  type="button"
                  onClick={onPaste}
                  className="text-[11.5px] fg-faint hover:fg transition px-2.5 py-1 rounded-md hover:bg-hover"
                >
                  {tw("start.pasteHtml")}
                </button>
              </div>
            )}
          </div>

          {naceComo === "pagina" && (
            <>
              {/* Gallery heading + search */}
              <div className="mt-10 mb-4 flex items-center gap-3 flex-wrap">
                <h3 className="text-[12px] uppercase tracking-[0.16em] fg-faint font-semibold shrink-0">
                  {tw("start.galleryHeading")}
                </h3>
                <div className="h-px bg-[color:var(--border)] flex-1 min-w-[40px]" />
                <div className="relative shrink-0">
                  <Search
                    size={13}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 fg-faint pointer-events-none"
                  />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={tw("start.search")}
                    aria-label={tw("start.search")}
                    className="w-44 sm:w-56 h-8 pl-8 pr-2.5 rounded-md text-[12px] bg-elev border bd fg placeholder:fg-faint focus:outline-none focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 transition"
                  />
                </div>
              </div>

              {/* Family chips */}
              {!isLoading && availableFamilies.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-5">
                  <FamilyChip
                    active={familyFilter === "all"}
                    onClick={() => setFamilyFilter("all")}
                  >
                    {tp("templates.all")}
                    {templates.length > 0 ? ` ${templates.length}` : ""}
                  </FamilyChip>
                  {shownChips.map((f) => (
                    <FamilyChip
                      key={f.id}
                      active={familyFilter === f.id}
                      onClick={() => setFamilyFilter(f.id)}
                    >
                      {tf(`${f.id}.label`)}
                    </FamilyChip>
                  ))}
                  {hiddenCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => setFamiliesExpanded(true)}
                      className="text-[10.5px] px-2.5 py-1 rounded-md transition font-medium text-accent bg-hover hover:fg"
                    >
                      {tp("templates.moreFamilies", { count: hiddenCount })}
                    </button>
                  ) : familiesExpanded ? (
                    <button
                      type="button"
                      onClick={() => setFamiliesExpanded(false)}
                      className="text-[10.5px] px-2.5 py-1 rounded-md transition font-medium fg-muted bg-hover hover:fg"
                    >
                      {tp("templates.fewerFamilies")}
                    </button>
                  ) : null}
                </div>
              )}

              {error && (
                <div className="mb-4 px-3 py-2 rounded-md ring-1 ring-rose-300/60 dark:ring-rose-500/30 bg-rose-50 dark:bg-rose-500/5 text-[11.5px] text-rose-700 dark:text-rose-300">
                  {tp("templates.loadError", { error })}
                </div>
              )}

              {/* Mosaic */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {isLoading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={`skel-${i}`}
                      className="rounded-lg ring-1 ring-[color:var(--border)] animate-pulse"
                      style={{ aspectRatio: "16 / 11", background: "var(--bg-elev)" }}
                    />
                  ))}
                {!isLoading &&
                  filtered.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => {
                        registrarUso("crear_plantilla", { plantilla: tpl.id });
                        onPreviewTemplate(tpl);
                      }}
                      aria-label={tpl.name}
                      className="group text-left rounded-lg overflow-hidden ring-1 ring-[color:var(--border)] hover:ring-[color:var(--border-strong)] hover:-translate-y-px hover:shadow-card transition-all duration-200"
                      style={{ background: "var(--bg)" }}
                    >
                      <TemplatePreviewFrame
                        url={tpl.previewUrl}
                        name={tpl.name}
                        imageUrl={tpl.imageUrl}
                      />
                      <div className="px-3 py-2 border-t bd flex items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold fg truncate">
                          {tpl.name}
                        </span>
                        <span className="text-[10px] fg-faint shrink-0 truncate max-w-[45%] text-right">
                          {tf(`${tpl.family}.label`)}
                        </span>
                      </div>
                    </button>
                  ))}
              </div>

              {!isLoading && filtered.length === 0 && !error && (
                <div className="text-center py-12 text-[12.5px] fg-faint">
                  {tw("start.noResults", { query })}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function FamilyChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10.5px] px-2.5 py-1 rounded-md transition font-medium ${
        active
          ? "bg-[var(--accent-strong)] text-white"
          : "fg-muted bg-hover hover:fg"
      }`}
    >
      {children}
    </button>
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
