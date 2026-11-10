"use client";

// «EN MI PÁGINA» (spec local 2026-11-06-asistente-propio, §4.4.5; phases 2A and 2B): her bubble on the published page.
// Off is immediate; on shows after the next publish, which bakes her bubble — and says so, after a reload too. Apps and
// games can have her too (phase 2B: their public data is something for her to know); published with nothing for her to
// know — no text, no public data — it says that instead.
import { useTranslations } from "next-intl";
import { useState } from "react";

export function OnPageSwitch({
  assistantId,
  projectId,
  initial,
  initialNeedsPublish = false,
  nothingToKnow = false,
}: {
  assistantId: string;
  /** One of the projects she serves (phase 4); without it, her home. */
  projectId?: string;
  initial: boolean;
  initialNeedsPublish?: boolean;
  /** Published with her, and nothing for her to know. */
  nothingToKnow?: boolean;
}) {
  const t = useTranslations("panelsChat");
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [needsPublish, setNeedsPublish] = useState(initialNeedsPublish);
  const [nothing, setNothing] = useState(nothingToKnow);

  const flip = async () => {
    const next = !on;
    setBusy(true);
    setOn(next);
    try {
      const res = await fetch(projectId ? `/api/assistants/${assistantId}/projects/${encodeURIComponent(projectId)}` : `/api/assistants/${assistantId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ onPage: next }),
      });
      const body = (await res.json().catch(() => ({}))) as { onPage?: boolean; needsPublish?: boolean };
      if (!res.ok || typeof body.onPage !== "boolean") throw new Error(String(res.status));
      setOn(body.onPage);
      setNeedsPublish(body.needsPublish === true);
      // A change forgets that her bubble was baked (lib/assistants/visitor/store.ts): the next publish says again.
      setNothing(false);
    } catch {
      setOn(!next);
    } finally {
      setBusy(false);
    }
  };

  const hint = !on ? null : needsPublish ? t("ownAssistant.place.onPageHint") : nothing ? t("ownAssistant.place.nothingToKnow") : null;

  return (
    <div className="flex min-w-0 items-center gap-2" data-on-page="">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={busy}
        onClick={() => void flip()}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-[var(--nc-accent-text)]" : "bg-hover"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} />
        <span className="sr-only">{t("ownAssistant.place.onPage")}</span>
      </button>
      <span className="text-[12.5px] fg" aria-hidden>
        {t("ownAssistant.place.onPage")}
      </span>
      {hint && <span className="truncate text-[11.5px] fg-faint">{hint}</span>}
    </div>
  );
}
