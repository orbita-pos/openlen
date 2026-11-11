"use client";

// THE CREATOR, LIKE MUSE (spec local 2026-11-06-asistente-propio, §4.4; her figure: spec local
// 2026-11-10-figuras-del-asistente, §5.6): the figure alive in big, reacting to every pick; its name; its shape,
// eyes, glasses and accessory from the catalog; its color, free; and how it talks. «Listo» creates it
// (`POST /api/assistants`). With `editing` it is the same creator changing the figure of one that exists
// (`PATCH /api/assistants/<id>`). Nothing here depends on how many entries the catalog has.
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { ASSISTANT_NAME_MAX, ASSISTANT_TONES, type AssistantTone } from "@/lib/assistants/names";
import { FIGURE_COLORS, checkLook, offered, type FigureCategory, type FigureLook } from "@/lib/figure/look";
import { curatedLook } from "@/lib/figure/random";

import { ModalShell } from "../modal-shell";
import { AssistantFigure } from "./figure";
import { LiveFigure } from "./live-figure";

type Failure = "name" | "nameTaken" | "projectHas" | "ownerOnly" | "generic" | "figure";

const FAILURE_OF_CODE: Readonly<Record<string, Failure>> = { name_taken: "nameTaken", project_has_assistant: "projectHas", solo_dueno: "ownerOnly" };
const CATEGORIES: readonly { id: FigureCategory; label: string }[] = [
  { id: "shape", label: "ownAssistant.creator.shape" },
  { id: "eyes", label: "ownAssistant.creator.eyes" },
  { id: "eyewear", label: "ownAssistant.creator.eyewear" },
  { id: "accessory", label: "ownAssistant.creator.accessory" },
];
const seed = () => Math.floor(Math.random() * 0xffffffff);

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
  return (
    <ModalShell open={open} onClose={onClose} titleId="assistant-creator-title" title={editing ? editing.name : t("ownAssistant.creator.title")} size="lg" dismissable={!saving} closeLabel={t("ownAssistant.creator.cancel")}>
      <div className="flex flex-col items-center gap-4 p-5">
        <div className="flex flex-col items-center gap-2">
          {/* Alive only while the dialog is open: a closed dialog must not hold the screen's one live figure. */}
          {open ? <LiveFigure look={look} size={160} activity={naming ? "listening" : "ready"} label={shown || undefined} /> : <AssistantFigure look={look} size={160} />}
          <button type="button" data-figure-surprise="" onClick={() => setLook(curatedLook(seed()))} className="rounded-full border bd px-3 py-1 text-[12px] font-medium fg-muted hover:fg">
            {t("ownAssistant.creator.surprise")}
          </button>
        </div>
        {!editing && (
          <label className="flex w-full flex-col gap-1 text-[12px] fg-muted">
            {t("ownAssistant.creator.name")}
            <input
              data-assistant-name=""
              className="rounded-lg border bd bg-elev px-3 py-2 text-[14px] fg"
              value={name}
              maxLength={ASSISTANT_NAME_MAX}
              placeholder={t("ownAssistant.creator.namePlaceholder")}
              onChange={(e) => setName(e.target.value)}
              onFocus={() => setNaming(true)}
              onBlur={() => setNaming(false)}
            />
          </label>
        )}
        {failure && (
          <p data-assistant-error="" role="alert" className="w-full text-[12px] text-[var(--nc-danger,#d93636)]">
            {failure === "figure" ? t("ownAssistant.place.figureFailed") : t(`ownAssistant.errors.${failure}`)}
          </p>
        )}
        {CATEGORIES.map((category) => (
          <fieldset key={category.id} className="w-full" data-figure-category={category.id}>
            <legend className="mb-1 text-[12px] fg-muted">{t(category.label)}</legend>
            <div className="flex flex-wrap gap-1.5">
              {offered(category.id).map((id) => (
                <button
                  key={id}
                  type="button"
                  data-figure-option={id}
                  aria-label={id}
                  aria-pressed={look[category.id] === id}
                  onClick={() => pick({ [category.id]: id })}
                  className={`rounded-xl border-2 p-1 ${look[category.id] === id ? "border-[var(--nc-accent-text)]" : "border-transparent bg-elev"}`}
                >
                  <AssistantFigure look={{ ...look, [category.id]: id } as FigureLook} size={32} />
                </button>
              ))}
            </div>
          </fieldset>
        ))}
        <fieldset className="w-full">
          <legend className="mb-1 text-[12px] fg-muted">{t("ownAssistant.creator.color")}</legend>
          <div className="flex flex-wrap items-center gap-2">
            {FIGURE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                data-assistant-color={c}
                aria-pressed={look.color === c}
                aria-label={c}
                onClick={() => pick({ color: c })}
                className={`h-6 w-6 rounded-full ${look.color === c ? "ring-2 ring-[var(--nc-accent-text)] ring-offset-2" : ""}`}
                style={{ background: c }}
              />
            ))}
            <input
              type="color"
              data-assistant-free-color=""
              aria-label={t("ownAssistant.creator.freeColor")}
              title={t("ownAssistant.creator.freeColor")}
              value={look.color}
              onChange={(e) => pick({ color: e.target.value })}
              className="h-7 w-9 cursor-pointer rounded border bd bg-transparent p-0"
            />
          </div>
        </fieldset>
        {!editing && (
          <>
            <fieldset className="w-full">
              <legend className="mb-1 text-[12px] fg-muted">{t("ownAssistant.creator.tone")}</legend>
              <div className="flex gap-1.5">
                {ASSISTANT_TONES.map((x) => (
                  <button
                    key={x}
                    type="button"
                    data-assistant-tone={x}
                    aria-pressed={tone === x}
                    onClick={() => setTone(x)}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-[12px] ${tone === x ? "seg-active" : "bd fg-muted"}`}
                  >
                    {t(`ownAssistant.tones.${x}`)}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="flex w-full items-center gap-2 text-[12.5px] fg">
              <input type="checkbox" data-assistant-morning="" checked={morningSummary} onChange={(e) => setMorningSummary(e.target.checked)} />
              {t("ownAssistant.creator.morningSummary")}
            </label>
          </>
        )}
        <button
          type="button"
          data-assistant-done=""
          disabled={saving || (!editing && name.trim() === "")}
          onClick={() => void create()}
          className="w-full rounded-lg bg-[var(--nc-accent-text)] px-3 py-2 text-[14px] font-medium text-white disabled:opacity-50"
        >
          {t("ownAssistant.creator.done")}
        </button>
      </div>
    </ModalShell>
  );
}
