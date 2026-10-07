// Start landing — the center surface a first-time user sees at a bare /new
// (no project yet). It leads with the can't-fail CATALOG (a mosaic of verified
// templates, $0, one click) while keeping the AI brief visible as the hero
// input — "catalog-first, AI not buried". Picking a template previews it in
// place (same flow as the sidebar gallery); typing + generate runs the normal
// AI flow. No new machinery — this just composes the pieces that already exist.

"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { useTranslations } from "next-intl";
import type { BriefFormState } from "@/components/workspace/types";
import {
  GenerationBriefLimitFeedback,
  useGenerationBriefLimit,
} from "@/components/generation-brief-limit";
import { type PageEffort } from "./panels/ai-brief-panel";
import { TemplatePreviewFrame } from "./template-preview-frame";
import { useTemplates } from "./use-templates";
import {
  TEMPLATE_FAMILIES,
  type TemplateFamily,
  type TemplateSpec,
} from "./templates-data";
import { Loader, Search } from "./icons";
import { ArrowUp, ImageIcon, Mic, Plus, Square } from "lucide-react";
import "./chat/new-chat.css";
import { ComposerChip, ComposerPlusOption } from "./composer-pieces";
import { useMandoDesplegable } from "./use-mando-desplegable";
import { ReferenceField } from "./reference-field";
import { useDictado } from "@/components/marketing/use-dictado";
import { reducirImagen } from "@/components/marketing/reducir-imagen";
import { MAX_REFERENCIAS } from "@/lib/ai/referencia-adjunta";
import { registrarUso } from "@/lib/uso/cliente";
import { TarjetasNaceComo, type NaceComo } from "./tarjetas-nace-como";

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
  /** Página o App: las dos tarjetas de encima del compositor. */
  naceComo: NaceComo;
  onNaceComoChange: (v: NaceComo) => void;
}

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
}: StartLandingProps) {
  const tw = useTranslations("wsChrome");
  const tp = useTranslations("panelsA");
  const tf = useTranslations("families");

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
    <section className="flex-1 min-w-0 min-h-0 overflow-y-auto nice-scroll bg-app">
      <div className="mx-auto max-w-5xl px-6 py-10 sm:py-12">
        {/* Hero copy */}
        <div className="text-center mb-6">
          <h2 className="text-[26px] sm:text-[31px] font-semibold fg tracking-tight leading-tight">
            {naceComo === "app" ? tw("start.kind.headline") : tw("start.headline")}
          </h2>
          <p className="mt-2.5 text-[13px] fg-muted leading-relaxed max-w-md mx-auto">
            {naceComo === "app" ? tw("start.kind.subtitle") : tw("start.subtitle")}
          </p>
        </div>

        {/* PÁGINA O APP, y debajo el compositor de siempre. */}
        <div className="max-w-2xl mx-auto">
          <div className="mb-4">
            <TarjetasNaceComo value={naceComo} onChange={onNaceComoChange} disabled={generating} />
          </div>
          <HeroComposer
            state={aiState}
            onGenerate={onGenerate}
            generating={generating}
            effort={effort}
            onEffortChange={onEffortChange}
            {...(naceComo === "app" ? { placeholder: tw("start.kind.appPlaceholder") } : {})}
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

// The centered AI composer. Mirrors the sidebar AiBriefPanel composer (auto-grow
// textarea + Enter-to-send + the shared EffortSelect) at a larger, hero size.
export function HeroComposer({
  state,
  onGenerate,
  generating,
  effort,
  onEffortChange,
  placeholder,
}: {
  state: BriefFormState;
  onGenerate: () => void;
  generating: boolean;
  effort: PageEffort;
  onEffortChange: (effort: PageEffort) => void;
  /** Lo que se lee en la caja vacía; sin él, el de una página. */
  placeholder?: string;
}) {
  const t = useTranslations("panelsA");
  const tm = useTranslations("marketing");
  const locale = useLocale();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [leyendoFoto, setLeyendoFoto] = useState(false);
  const briefLimit = useGenerationBriefLimit({
    value: state.prompt,
    onValueChange: state.setPrompt,
    externallyTruncatedValue: state.truncatedPrompt,
    onTruncatedValueChange: state.setTruncatedPrompt,
    externalAnnouncementToken: state.truncationAnnouncementToken,
    onExternalAnnouncementTokenChange: state.setTruncationAnnouncementToken,
  });

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [state.prompt]);

  // «ESCRIBIÓ» ES EL PASO QUE SEPARA MIRAR DE INTENTAR, así que se registra la
  // primera vez que entra texto por cualquiera de las tres puertas —teclado,
  // pegar o dictado— y nunca más en esta visita. Nunca lleva el texto.
  const escrito = useRef(false);
  const marcarEscrito = () => {
    if (escrito.current) return;
    escrito.current = true;
    registrarUso("crear_escribio", {});
  };

  // ⚰️ Aquí vivía EL ESCRITOR FIJADO (`/api/crear/escritor`), el selector de
  // qué modelo escribía Crear. Se retiró con Crear el 2026-10-06
  // (plans/crear-es-len, tarea 12): lo que se envía es el primer mensaje a Len.
  // El menú del `+`, con el mismo gancho que el chat: Esc, clic fuera, flechas.
  const [plusOpen, setPlusOpen] = useState(false);
  const plus = useMandoDesplegable({ abierto: plusOpen, cerrar: () => setPlusOpen(false) });
  const tc = useTranslations("panelsChat");
  // MISMO DICTADO QUE EL HEROE, mismo gancho. No se copia el codigo: si algun
  // dia Chrome cambia cuando cierra la sesion, se arregla en un sitio.
  const dictado = useDictado({
    idioma: locale,
    onTexto: (fragmento) => {
      marcarEscrito();
      const previo = state.prompt;
      const junto = previo ? `${previo.replace(/\s+$/, "")} ${fragmento.trim()}` : fragmento.trim();
      state.setPrompt(junto.slice(0, briefLimit.maxLength));
    },
  });

  // Hasta `MAX_REFERENCIAS`, igual que en el heroe y por los mismos motivos —
  // ver el comentario largo del estado en `hero-prompt-input.tsx`.
  const elegirFotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const hueco = MAX_REFERENCIAS - state.fotos.length;
    if (hueco <= 0) return;
    setLeyendoFoto(true);
    try {
      const reducidas = await Promise.all(
        Array.from(files)
          .slice(0, hueco)
          .map(async (file) => {
            const r = await reducirImagen(file);
            return r ? { dataUrl: r.dataUrl, nombre: file.name } : null;
          }),
      );
      const buenas = reducidas.filter((r): r is NonNullable<typeof r> => r !== null);
      if (buenas.length) {
        state.setFotos([...state.fotos, ...buenas].slice(0, MAX_REFERENCIAS));
      }
    } finally {
      setLeyendoFoto(false);
      // Vaciar SIEMPRE: sin esto, elegir el mismo fichero dos veces seguidas no
      // dispara `change` y parece que el boton se rompio.
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const canGenerate = briefLimit.isValid && !generating;

  // Enviar es UN evento aunque haya dos caminos, Enter y el botón. Lleva sólo
  // la forma del encargo —cuántas imágenes, si hay referencia—, nunca el brief.
  const enviar = () => {
    registrarUso("crear_envio", {
      imagenes: state.fotos.length,
      referencia: state.reference !== null,
    });
    // El motor sigue vivo tras navegar si no se corta aqui.
    dictado.parar();
    onGenerate();
  };

  return (
    // LA PIEL DEL CHAT NUEVO (Jesús, 03/10: «que sean como el chat nuevo»): la
    // misma caja, las fichas encima del texto, el `+` con su menú, las opciones
    // como pastillas al final y el botón cuadrado. Bajo `.nc` por los tokens y
    // las animaciones de chat/new-chat.css. Lo que HACE no cambia: fotos,
    // dictado, límite del brief, referencia y eventos de uso.
    <div className="nc">
      <div className="nc-composer relative rounded-[16px] border bd-strong bg-elev px-3 pb-[7px] pt-2 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition">
        {/* Lo que va con el encargo, como fichas ARRIBA y dentro: las fotos y
            la referencia de una web. `empty:hidden` porque la referencia no
            pinta nada sin una dirección escrita, que es lo normal. */}
        <div className="mb-1 flex flex-wrap gap-1.5 empty:hidden">
          {state.fotos.map((foto, i) => (
            <ComposerChip
              key={`${foto.nombre}-${i}`}
              title={foto.nombre}
              {...(generating ? {} : { onRemove: () => state.setFotos(state.fotos.filter((_, j) => j !== i)) })}
              removeLabel={tm("heroPrompt.removeImage")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={foto.dataUrl} alt="" className="h-[18px] w-[18px] shrink-0 rounded object-cover" />
              <span className="min-w-0 max-w-[180px] truncate">{foto.nombre || tm("heroPrompt.attachedAlt")}</span>
            </ComposerChip>
          ))}
          <ReferenceField
            brief={state.prompt}
            reference={state.reference}
            onChange={state.setReference}
            disabled={generating}
            variant="chip"
          />
        </div>

        <textarea
          ref={taRef}
          value={state.prompt}
          onChange={(e) => {
            marcarEscrito();
            briefLimit.onChange(e);
          }}
          onPaste={(e) => {
            marcarEscrito();
            briefLimit.onPaste(e);
          }}
          onKeyDown={(e) => {
            // Mientras un IME compone (japonés, coreano, chino), Enter confirma
            // la palabra: no puede mandar el encargo a medias.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canGenerate) enviar();
            }
          }}
          rows={1}
          disabled={generating}
          placeholder={placeholder ?? t("aiBrief.placeholder")}
          maxLength={briefLimit.maxLength}
          aria-describedby={briefLimit.warningVisible ? briefLimit.feedbackId : undefined}
          className="mt-0.5 block w-full resize-none bg-transparent text-[14px] leading-normal fg outline-none placeholder:fg-faint nice-scroll disabled:opacity-60"
          style={{ minHeight: 44 }}
        />
        {/* Lo que el motor va oyendo. Fuera del textarea a proposito: es texto
            que todavia puede CORREGIRSE, y verlo reescribirse dentro de lo ya
            escrito da la sensacion de que te lo borra. */}
        {dictado.escuchando && (
          <p className="pb-1 text-[12px] italic fg-faint" aria-live="polite">
            {dictado.parcial || tm("heroPrompt.listening")}
          </p>
        )}
        {dictado.mudo && (
          <p className="pb-1 text-[11.5px] text-amber-600 dark:text-amber-400" role="status">
            {tm("heroPrompt.micSilent")}
          </p>
        )}
        {dictado.denegado && (
          <p className="pb-1 text-[11.5px] text-amber-600 dark:text-amber-400" role="status">
            {tm("heroPrompt.micDenied")}
          </p>
        )}
        <GenerationBriefLimitFeedback
          valueLength={state.prompt.length}
          state={briefLimit}
          warningText={t("aiBrief.trimmed", { max: briefLimit.maxLength })}
          className="pb-1 text-[11px]"
          warningClassName="text-amber-600 dark:text-amber-400"
          counterClassName="fg-faint"
        />

        <div className="mt-0.5 flex items-center gap-[3px]">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/avif"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => void elegirFotos(e.target.files)}
          />
          {/* EL `+` ABRE SU MENÚ, como en el chat: hoy una opción, adjuntar
              imágenes, con lo que hace dicho debajo. */}
          <div className="relative" ref={plus.refContenedor} onKeyDown={plus.alPulsarTecla}>
            <button
              type="button"
              ref={plus.refDisparador}
              aria-label={tc("newChat.composer.plus")}
              title={tc("newChat.composer.plus")}
              aria-haspopup="menu"
              aria-expanded={plusOpen}
              onClick={() => setPlusOpen((x) => !x)}
              disabled={generating}
              className={`grid h-[30px] w-[30px] place-items-center rounded-[9px] transition disabled:opacity-40 ${
                state.fotos.length > 0 ? "text-[var(--nc-accent-text)]" : "fg-muted"
              } hover:bg-side hover:fg`}
            >
              {leyendoFoto ? (
                <Loader size={14} className="animate-spin" />
              ) : (
                <Plus size={16} className={`transition-transform duration-200 ${plusOpen ? "rotate-45" : ""}`} />
              )}
            </button>
            {plusOpen && (
              <div
                role="menu"
                aria-label={tc("newChat.composer.plus")}
                className="nc-card-in absolute bottom-[calc(100%+8px)] left-0 z-20 w-[290px] rounded-[14px] border bd-strong bg-elev p-1.5 shadow-[0_18px_40px_-12px_rgb(20_10_5/0.35)]"
              >
                <ComposerPlusOption
                  icon={<ImageIcon size={15} />}
                  title={tm("heroPrompt.attachImages")}
                  hint={
                    state.fotos.length >= MAX_REFERENCIAS
                      ? tm("heroPrompt.maxImages", { max: MAX_REFERENCIAS })
                      : tm("heroPrompt.attachImagesHint", { max: MAX_REFERENCIAS })
                  }
                  on={state.fotos.length > 0}
                  onLabel={String(state.fotos.length)}
                  disabled={leyendoFoto || state.fotos.length >= MAX_REFERENCIAS}
                  onClick={() => {
                    setPlusOpen(false);
                    fileRef.current?.click();
                  }}
                />
              </div>
            )}
          </div>
          {dictado.soportado && (
            <button
              type="button"
              onClick={dictado.alternar}
              aria-pressed={dictado.escuchando}
              aria-label={dictado.escuchando ? tm("heroPrompt.stopDictating") : tm("heroPrompt.dictate")}
              title={dictado.escuchando ? tm("heroPrompt.stopDictating") : tm("heroPrompt.dictate")}
              disabled={generating}
              className={`grid h-[30px] w-[30px] place-items-center rounded-[9px] transition hover:bg-side disabled:opacity-40 ${
                dictado.escuchando ? "bg-side text-[var(--nc-accent-text)]" : "fg-muted hover:fg"
              }`}
            >
              {dictado.escuchando ? <Square size={11} className="fill-current" /> : <Mic size={15} />}
            </button>
          )}
          {/* ⚰️ Aquí iba el selector de QUÉ MOTOR ESCRIBE; se fue con Crear
              (2026-10-06). El botón se queda al final de la fila. */}
          <button
            type="button"
            onClick={enviar}
            disabled={!canGenerate}
            aria-label={t("aiBrief.generate")}
            title={t("aiBrief.generate")}
            className={`ml-auto flex h-8 min-w-8 shrink-0 items-center justify-center rounded-[10px] text-white transition hover:-translate-y-px disabled:translate-y-0 disabled:cursor-default ${
              generating || canGenerate ? "bg-[var(--accent-strong)]" : "bg-[var(--border-strong)]"
            }`}
          >
            {generating ? <Loader size={14} className="animate-spin" /> : <ArrowUp size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
