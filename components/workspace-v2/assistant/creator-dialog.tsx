"use client";

// THE CREATOR, LIKE MUSE (spec local 2026-11-06-asistente-propio, §4.4; her figure: spec local
// 2026-11-10-figuras-del-asistente, §5.6): the figure alive in big, reacting to every pick; its name; its shape,
// eyes, glasses and accessory from the catalog; its color, free; and how it talks. «Listo» creates it
// (`POST /api/assistants`). With `editing` it is the same creator changing the figure of one that exists
// (`PATCH /api/assistants/<id>`). Nothing here depends on how many entries the catalog has.
import { Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { ASSISTANT_NAME_MAX, ASSISTANT_TONES, type AssistantTone } from "@/lib/assistants/names";
import { FIGURE_COLORS, checkLook, offered, type FigureCategory, type FigureLook } from "@/lib/figure/look";
import { curatedLook } from "@/lib/figure/random";

import { ModalShell } from "../modal-shell";
import { AssistantFigure } from "./figure";
import { LiveFigure } from "./live-figure";
import { tintOf } from "@/lib/figure/tint";

type Failure = "name" | "nameTaken" | "projectHas" | "ownerOnly" | "generic" | "figure";

const FAILURE_OF_CODE: Readonly<Record<string, Failure>> = { name_taken: "nameTaken", project_has_assistant: "projectHas", solo_dueno: "ownerOnly" };
const CATEGORIES: readonly { id: FigureCategory; label: string }[] = [
  { id: "shape", label: "ownAssistant.creator.shape" },
  { id: "eyes", label: "ownAssistant.creator.eyes" },
  { id: "eyewear", label: "ownAssistant.creator.eyewear" },
  { id: "accessory", label: "ownAssistant.creator.accessory" },
];
const seed = () => Math.floor(Math.random() * 0xffffffff);
/** A group's name: small, quiet, apart from what it names. */
const LABEL = "text-[11px] font-medium uppercase tracking-[0.06em] fg-faint";

export function AssistantCreatorDialog({
  open,
  projectId,
  onClose,
  onCreated,
  initial,
  editing,
  onSaved,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: (created: { id: string; slug: string; name: string }) => void;
  /** The look it opens with: what Len suggested. Without it, one that goes well together, by chance. */
  initial?: FigureLook;
  /** One that exists: only her figure is changed. */
  editing?: { id: string; name: string; look: FigureLook };
  onSaved?: (look: FigureLook) => void;
}) {
  const t = useTranslations("panelsChat");
  const [name, setName] = useState("");
  const [look, setLook] = useState<FigureLook>(() => editing?.look ?? initial ?? curatedLook(seed()));
  const [tone, setTone] = useState<AssistantTone>("friendly");
  // The morning summary (phase 4D, spec §6.9): offered, unticked.
  const [morningSummary, setMorningSummary] = useState(false);
  const [naming, setNaming] = useState(false);
  const locale = useLocale();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  /** One part changed; whatever the catalog would not take is not picked. */
  const pick = (patch: Partial<FigureLook>) => {
    const next = checkLook({ ...look, ...patch });
    if (next.ok) setLook(next.value);
  };

  const create = async () => {
    setSaving(true);
    setFailure(null);
    try {
      const res = editing
        ? await fetch(`/api/assistants/${encodeURIComponent(editing.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ look }) })
        : await fetch("/api/assistants", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId, name, look, tone, morningSummary, locale }),
          });
      const body = (await res.json().catch(() => ({}))) as { id?: string; slug?: string; field?: string; error?: string };
      if (editing && res.ok) {
        onSaved?.(look);
        return;
      }
      if (!editing && res.ok && body.id && body.slug) {
        onCreated({ id: body.id, slug: body.slug, name: name.trim().replace(/\s+/g, " ") });
        return;
      }
      setFailure(editing ? "figure" : body.field === "name" ? "name" : (body.error && FAILURE_OF_CODE[body.error]) || "generic");
    } catch {
      setFailure(editing ? "figure" : "generic");
    } finally {
      setSaving(false);
    }
  };

  const shown = editing?.name ?? name;
  // «Sorpréndeme» is the creator's best button: it wears the figure's color, with the ink that reads over it.
  const tint = tintOf(look.color);
  return (
    <ModalShell open={open} onClose={onClose} titleId="assistant-creator-title" title={editing ? editing.name : t("ownAssistant.creator.title")} size="lg" dismissable={!saving} closeLabel={t("ownAssistant.creator.cancel")}>
      {/* Three bands: her figure on a wash of her color, what is chosen (it scrolls), and the two buttons, always in
          sight. */}
      <div className="flex max-h-[min(80vh,700px)] flex-col">
        <div
          className="flex shrink-0 flex-col items-center gap-3 px-5 pb-4 pt-5"
          style={{ background: `radial-gradient(120% 100% at 50% 0%, color-mix(in srgb, ${look.color} 24%, transparent), transparent 72%)` }}
        >
          {/* Alive only while the dialog is open: a closed dialog must not hold the screen's one live figure. */}
          {open ? <LiveFigure look={look} size={132} activity={naming ? "listening" : "ready"} label={shown || undefined} /> : <AssistantFigure look={look} size={132} />}
          <button
            type="button"
            data-figure-surprise=""
            onClick={() => setLook(curatedLook(seed()))}
            className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold shadow-sm transition-transform hover:scale-[1.04] active:scale-95"
            style={tint ? { background: tint.tint, color: tint.ink, boxShadow: `inset 0 0 0 1px ${tint.edge}` } : undefined}
          >
            <Sparkles size={14} aria-hidden="true" />
            {t("ownAssistant.creator.surprise")}
          </button>
        </div>
        <div className="nice-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5 pt-1">
          {!editing && (
            <label className={`flex w-full flex-col gap-1.5 ${LABEL}`}>
              {t("ownAssistant.creator.name")}
              <input
                data-assistant-name=""
                className="h-10 rounded-[10px] border bd bg-side px-3 text-[14px] font-normal normal-case tracking-normal fg"
                value={name}
                maxLength={ASSISTANT_NAME_MAX}
                placeholder={t("ownAssistant.creator.namePlaceholder")}
                onChange={(e) => setName(e.target.value)}
                onFocus={() => setNaming(true)}
                onBlur={() => setNaming(false)}
              />
            </label>
          )}
          {CATEGORIES.map((category) => (
            <fieldset key={category.id} className="w-full" data-figure-category={category.id}>
              <legend className={`mb-1.5 ${LABEL}`}>{t(category.label)}</legend>
              <div className="flex flex-wrap gap-1.5">
                {offered(category.id).map((id) => {
                  const picked = look[category.id] === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      data-figure-option={id}
                      aria-label={t(`ownAssistant.creator.option.${category.id}.${id}`)}
                      title={t(`ownAssistant.creator.option.${category.id}.${id}`)}
                      aria-pressed={picked}
                      onClick={() => pick({ [category.id]: id })}
                      className={`flex h-12 w-12 items-center justify-center rounded-[14px] transition ${picked ? "" : "bg-side hover:bg-hover"}`}
                      style={picked ? { background: `color-mix(in srgb, ${look.color} 18%, transparent)`, boxShadow: `0 0 0 2px ${tint?.tint ?? look.color}` } : undefined}
                    >
                      <AssistantFigure look={{ ...look, [category.id]: id } as FigureLook} size={34} />
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <fieldset className="w-full">
            <legend className={`mb-1.5 ${LABEL}`}>{t("ownAssistant.creator.color")}</legend>
            <div className="flex flex-wrap items-center gap-2.5">
              {FIGURE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  data-assistant-color={c}
                  aria-pressed={look.color === c}
                  aria-label={t(`ownAssistant.creator.colors.${c.slice(1)}`)}
                  title={t(`ownAssistant.creator.colors.${c.slice(1)}`)}
                  onClick={() => pick({ color: c })}
                  className="h-7 w-7 rounded-full transition-transform hover:scale-110"
                  style={{ background: c, boxShadow: look.color === c ? `0 0 0 2px var(--bg-elev), 0 0 0 4px ${c}` : "inset 0 0 0 1px rgba(0,0,0,0.12)" }}
                />
              ))}
              {/* Any other color: the wheel is the swatch, the browser's picker is under it. */}
              <label
                className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full transition-transform hover:scale-110 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--nc-accent-text)]"
                title={t("ownAssistant.creator.freeColor")}
                style={{
                  background: "conic-gradient(#ff5f5f, #ffc21a, #7ed321, #19c3b1, #2f8bff, #9b6cff, #ff5fa8, #ff5f5f)",
                  boxShadow: FIGURE_COLORS.includes(look.color) ? "inset 0 0 0 1px rgba(0,0,0,0.12)" : `0 0 0 2px var(--bg-elev), 0 0 0 4px ${look.color}`,
                }}
              >
                <input
                  type="color"
                  data-assistant-free-color=""
                  aria-label={t("ownAssistant.creator.freeColor")}
                  value={look.color}
                  onChange={(e) => pick({ color: e.target.value })}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
            </div>
          </fieldset>
          {!editing && (
            <>
              <fieldset className="w-full">
                <legend className={`mb-1.5 ${LABEL}`}>{t("ownAssistant.creator.tone")}</legend>
                <div className="flex gap-0.5 rounded-[10px] bg-side p-0.5">
                  {ASSISTANT_TONES.map((x) => (
                    <button
                      key={x}
                      type="button"
                      data-assistant-tone={x}
                      aria-pressed={tone === x}
                      onClick={() => setTone(x)}
                      className={`flex-1 rounded-[8px] px-2 py-1.5 text-[12.5px] transition-colors ${tone === x ? "seg-active font-medium" : "fg-muted hover:fg"}`}
                    >
                      {t(`ownAssistant.tones.${x}`)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="flex w-full items-center gap-2.5 text-[13px] fg">
                <input type="checkbox" data-assistant-morning="" checked={morningSummary} onChange={(e) => setMorningSummary(e.target.checked)} className="h-4 w-4" style={{ accentColor: tint?.tint ?? look.color }} />
                {t("ownAssistant.creator.morningSummary")}
              </label>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t bd bg-side px-5 py-3">
          {failure && (
            <p data-assistant-error="" role="alert" className="min-w-0 flex-1 text-[12px] leading-snug text-[var(--nc-danger,#d93636)]">
              {failure === "figure" ? t("ownAssistant.place.figureFailed") : t(`ownAssistant.errors.${failure}`)}
            </p>
          )}
          <button type="button" disabled={saving} onClick={onClose} className="ml-auto inline-flex h-9 items-center rounded-[10px] bg-hover px-4 text-[13px] font-medium fg transition hover:brightness-110 disabled:opacity-45">
            {t("ownAssistant.creator.cancel")}
          </button>
          <button
            type="button"
            data-assistant-done=""
            disabled={saving || (!editing && name.trim() === "")}
            onClick={() => void create()}
            className="inline-flex h-9 min-w-[88px] items-center justify-center rounded-[10px] px-5 text-[13px] font-semibold transition hover:brightness-105 active:scale-[0.98] disabled:opacity-45"
            style={tint ? { background: tint.tint, color: tint.ink, boxShadow: `inset 0 0 0 1px ${tint.edge}` } : undefined}
          >
            {t("ownAssistant.creator.done")}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
