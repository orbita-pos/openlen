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
import { Loader, Search, SendUp } from "./icons";
import { Mic, Plus, Square, X } from "lucide-react";
import { ReferenceField } from "./reference-field";
import { useDictado } from "@/components/marketing/use-dictado";
import { reducirImagen } from "@/components/marketing/reducir-imagen";
import { MAX_REFERENCIAS } from "@/lib/ai/referencia-adjunta";

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
}

export function StartLanding({
  aiState,
  onGenerate,
  generating,
  effort,
  onEffortChange,
  onPreviewTemplate,
  onPaste,
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
            {tw("start.headline")}
          </h2>
          <p className="mt-2.5 text-[13px] fg-muted leading-relaxed max-w-md mx-auto">
            {tw("start.subtitle")}
          </p>
        </div>

        {/* AI brief — the hero input (visible, not buried) */}
        <div className="max-w-2xl mx-auto">
          <HeroComposer
            state={aiState}
            onGenerate={onGenerate}
            generating={generating}
            effort={effort}
            onEffortChange={onEffortChange}
          />
          <div className="mt-2.5 text-center">
            <button
              type="button"
              onClick={onPaste}
              className="text-[11.5px] fg-faint hover:fg transition px-2.5 py-1 rounded-md hover:bg-hover"
            >
              {tw("start.pasteHtml")}
            </button>
          </div>
        </div>

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
                onClick={() => onPreviewTemplate(tpl)}
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
function HeroComposer({
  state,
  onGenerate,
  generating,
  effort,
  onEffortChange,
}: {
  state: BriefFormState;
  onGenerate: () => void;
  generating: boolean;
  effort: PageEffort;
  onEffortChange: (effort: PageEffort) => void;
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

  // MISMO DICTADO QUE EL HEROE, mismo gancho. No se copia el codigo: si algun
  // dia Chrome cambia cuando cierra la sesion, se arregla en un sitio.
  const dictado = useDictado({
    idioma: locale,
    onTexto: (fragmento) => {
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

  return (
    <div className="rounded-2xl border bd bg-elev shadow-card focus-within:border-[color:var(--accent)] focus-within:ring-1 focus-within:ring-[color:var(--accent-ring)]/30 transition">
      {/* La miniatura va ARRIBA y DENTRO, igual que en el heroe: la caja crece
          con ella en vez de taparle algo al usuario. */}
      {state.fotos.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3.5">
          {state.fotos.map((foto, i) => (
            <div key={`${foto.nombre}-${i}`} className="relative inline-flex">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={foto.dataUrl}
                alt={foto.nombre || tm("heroPrompt.attachedAlt")}
                className="h-14 w-14 rounded-lg object-cover ring-1 ring-[color:var(--border)]"
              />
              <button
                type="button"
                onClick={() => state.setFotos(state.fotos.filter((_, j) => j !== i))}
                aria-label={tm("heroPrompt.removeImage")}
                className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[color:var(--fg)] text-[color:var(--bg)] ring-2 ring-[color:var(--bg-elev)] transition hover:opacity-80"
              >
                <X size={11} strokeWidth={2.6} />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={taRef}
        value={state.prompt}
        onChange={briefLimit.onChange}
        onPaste={briefLimit.onPaste}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canGenerate) {
              dictado.parar();
              onGenerate();
            }
          }
        }}
        rows={2}
        disabled={generating}
        placeholder={t("aiBrief.placeholder")}
        maxLength={briefLimit.maxLength}
        aria-describedby={
          briefLimit.warningVisible ? briefLimit.feedbackId : undefined
        }
        className="block w-full bg-transparent text-[13.5px] leading-relaxed px-4 pt-3.5 pb-1 fg placeholder:fg-faint focus:outline-none resize-none nice-scroll disabled:opacity-60"
        style={{ minHeight: 56 }}
      />
      {/* Lo que el motor va oyendo. Fuera del textarea a proposito: es texto
          que todavia puede CORREGIRSE, y verlo reescribirse dentro de lo ya
          escrito da la sensacion de que te lo borra. */}
      {dictado.escuchando && (
        <p className="px-4 pb-1 text-[12px] italic fg-faint" aria-live="polite">
          {dictado.parcial || tm("heroPrompt.listening")}
        </p>
      )}
      {dictado.mudo && (
        <p className="px-4 pb-1 text-[11.5px] text-amber-600 dark:text-amber-400" role="status">
          {tm("heroPrompt.micSilent")}
        </p>
      )}
      {dictado.denegado && (
        <p className="px-4 pb-1 text-[11.5px] text-amber-600 dark:text-amber-400" role="status">
          {tm("heroPrompt.micDenied")}
        </p>
      )}

      <GenerationBriefLimitFeedback
        valueLength={state.prompt.length}
        state={briefLimit}
        warningText={t("aiBrief.trimmed", { max: briefLimit.maxLength })}
        className="px-4 pb-1 text-[11px]"
        warningClassName="text-amber-600 dark:text-amber-400"
        counterClassName="fg-faint"
      />
      {/* justify-END, no justify-between: la referencia no pinta nada hasta
          que hay una dirección, y `between` con un solo hijo lo alinea al
          INICIO — el botón de generar se iba a la izquierda en cuanto el brief
          no traía URL, que es casi siempre. La referencia se empuja ella sola
          con `me-auto`. */}
      {/* El `+` y la referencia van en un GRUPO con `me-auto`, no cada uno con
          el suyo: `ReferenceField` ya trae `me-auto` dentro, y dos margenes
          automaticos se reparten el hueco —la referencia se iria al centro—.
          Ponerselo solo a ella tampoco vale: devuelve `null` sin URL, que es el
          caso normal, y entonces el `+` se iria a la derecha. El microfono va
          pegado a generar, como en el heroe. */}
      <div className="flex items-center justify-end gap-2 px-2.5 pb-2.5 pt-1">
        <div className="me-auto flex min-w-0 items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/avif"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => void elegirFotos(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={generating || leyendoFoto || state.fotos.length >= MAX_REFERENCIAS}
          aria-label={tm("heroPrompt.attachImages")}
          title={
            state.fotos.length >= MAX_REFERENCIAS
              ? tm("heroPrompt.maxImages", { max: MAX_REFERENCIAS })
              : tm("heroPrompt.attachImages")
          }
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md fg-faint hover:fg hover:bg-hover transition disabled:opacity-40"
        >
          {leyendoFoto ? <Loader size={14} className="animate-spin" /> : <Plus size={16} />}
        </button>
        <ReferenceField
          brief={state.prompt}
          reference={state.reference}
          onChange={state.setReference}
          disabled={generating}
        />
        </div>
        {dictado.soportado && (
          <button
            type="button"
            onClick={dictado.alternar}
            aria-pressed={dictado.escuchando}
            aria-label={dictado.escuchando ? tm("heroPrompt.stopDictating") : tm("heroPrompt.dictate")}
            title={dictado.escuchando ? tm("heroPrompt.stopDictating") : tm("heroPrompt.dictate")}
            disabled={generating}
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition disabled:opacity-40 ${
              dictado.escuchando
                ? "bg-[var(--accent-strong)] text-white shadow-coral"
                : "fg-faint hover:fg hover:bg-hover"
            }`}
          >
            {dictado.escuchando ? <Square size={10} className="fill-current" /> : <Mic size={15} />}
          </button>
        )}
        {/* El dial está aparcado mientras la puerta es /api/generate: ahí no
            compra nada todavía, y un selector que no compra nada es la mentira
            que se arregló en page-effort.ts. Su hueco lo ocupa ahora la
            referencia visual, que sí compra algo: la dirección de una web que
            al usuario le gusta. Se ve y se quita antes de generar.
            Desde el 2026-08-27 la dirección se ESCRIBE dentro del brief y esto
            no ocupa nada hasta que hay una — ni un botón. */}
        <button
          type="button"
          onClick={() => {
            // El motor sigue vivo tras navegar si no se corta aqui.
            dictado.parar();
            onGenerate();
          }}
          disabled={!canGenerate}
          aria-label={t("aiBrief.generate")}
          className={`inline-flex shrink-0 items-center justify-center gap-1.5 h-9 rounded-lg text-[12.5px] font-medium transition ${
            canGenerate
              ? "px-4 bg-[var(--accent-strong)] text-white shadow-coral hover:brightness-105"
              : "w-9 bg-hover fg-faint cursor-not-allowed"
          }`}
        >
          {generating ? (
            <Loader size={14} className="animate-spin" />
          ) : canGenerate ? (
            <>
              <SendUp size={13} /> <span>{t("aiBrief.generate")}</span>
            </>
          ) : (
            <SendUp size={14} />
          )}
        </button>
      </div>
    </div>
  );
}
