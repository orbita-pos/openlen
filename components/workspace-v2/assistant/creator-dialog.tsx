"use client";

// THE CREATOR, LIKE MUSE (spec local 2026-11-06-asistente-propio, §4.4; option B, Jesús's pick): the figure in big, its
// name, its shape, its color and how it talks. «Listo» creates it (`POST /api/assistants`). The shapes and colors are
// placeholders until the figures' design pass (phase 6).
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { ASSISTANT_NAME_MAX, ASSISTANT_SHAPES, ASSISTANT_TONES, type AssistantShape, type AssistantTone } from "@/lib/assistants/names";

import { ModalShell } from "../modal-shell";
import { AssistantFigure } from "./figure";

export const ASSISTANT_COLORS = ["#F4A48B", "#5FB8A6", "#A99BE0", "#F2C35B", "#7DB3F0"] as const;

type Failure = "name" | "nameTaken" | "projectHas" | "ownerOnly" | "generic";

const FAILURE_OF_CODE: Readonly<Record<string, Failure>> = { name_taken: "nameTaken", project_has_assistant: "projectHas", solo_dueno: "ownerOnly" };

export function AssistantCreatorDialog({
  open,
  projectId,
  onClose,
  onCreated,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: (created: { id: string; slug: string; name: string }) => void;
}) {
  const t = useTranslations("panelsChat");
  const [name, setName] = useState("");
  const [shape, setShape] = useState<AssistantShape>("blob");
  const [color, setColor] = useState<string>(ASSISTANT_COLORS[0]);
  const [tone, setTone] = useState<AssistantTone>("friendly");
  // The morning summary (phase 4D, spec §6.9): offered, unticked.
  const [morningSummary, setMorningSummary] = useState(false);
  const locale = useLocale();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const create = async () => {
    setSaving(true);
    setFailure(null);
    try {
      const res = await fetch("/api/assistants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, name, shape, color, tone, morningSummary, locale }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; slug?: string; field?: string; error?: string };
      if (res.ok && body.id && body.slug) {
        onCreated({ id: body.id, slug: body.slug, name: name.trim().replace(/\s+/g, " ") });
        return;
      }
      setFailure(body.field === "name" ? "name" : (body.error && FAILURE_OF_CODE[body.error]) || "generic");
    } catch {
      setFailure("generic");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell open={open} onClose={onClose} titleId="assistant-creator-title" title={t("ownAssistant.creator.title")} size="lg" dismissable={!saving} closeLabel={t("ownAssistant.creator.cancel")}>
      <div className="flex flex-col items-center gap-4 p-5">
        <AssistantFigure shape={shape} color={color} size={96} label={name || undefined} />
        <label className="flex w-full flex-col gap-1 text-[12px] fg-muted">
          {t("ownAssistant.creator.name")}
          <input
            data-assistant-name=""
            className="rounded-lg border bd bg-elev px-3 py-2 text-[14px] fg"
            value={name}
            maxLength={ASSISTANT_NAME_MAX}
            placeholder={t("ownAssistant.creator.namePlaceholder")}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {failure && (
          <p data-assistant-error="" role="alert" className="w-full text-[12px] text-[var(--nc-danger,#d93636)]">
            {t(`ownAssistant.errors.${failure}`)}
          </p>
        )}
        <fieldset className="w-full">
          <legend className="mb-1 text-[12px] fg-muted">{t("ownAssistant.creator.shape")}</legend>
          <div className="flex gap-2">
            {ASSISTANT_SHAPES.map((s) => (
              <button
                key={s}
                type="button"
                data-assistant-shape={s}
                aria-pressed={shape === s}
                onClick={() => setShape(s)}
                className={`rounded-xl border-2 p-1.5 ${shape === s ? "border-[var(--nc-accent-text)]" : "border-transparent bg-elev"}`}
              >
                <AssistantFigure shape={s} color={color} size={28} />
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="w-full">
          <legend className="mb-1 text-[12px] fg-muted">{t("ownAssistant.creator.color")}</legend>
          <div className="flex gap-2">
            {ASSISTANT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                data-assistant-color={c}
                aria-pressed={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={`h-6 w-6 rounded-full ${color === c ? "ring-2 ring-[var(--nc-accent-text)] ring-offset-2" : ""}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </fieldset>
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
        <button
          type="button"
          data-assistant-done=""
          disabled={saving || name.trim() === ""}
          onClick={() => void create()}
          className="w-full rounded-lg bg-[var(--nc-accent-text)] px-3 py-2 text-[14px] font-medium text-white disabled:opacity-50"
        >
          {t("ownAssistant.creator.done")}
        </button>
      </div>
    </ModalShell>
  );
}
