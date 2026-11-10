"use client";

// THE MORNING SUMMARY'S SWITCH IN HER PLACE (spec local 2026-11-06-asistente-propio, §6.9, phase 4D): off unless the
// owner turns it on; on, she tells them at 8 in the morning what happened yesterday, only when something did
// (lib/assistants/summary/). It keeps the language of the page that turned it on.
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

export function MorningSummarySwitch({ assistantId, initial }: { assistantId: string; initial: boolean }) {
  const t = useTranslations("panelsChat");
  const locale = useLocale();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  const flip = async () => {
    const next = !on;
    setBusy(true);
    setOn(next);
    try {
      const res = await fetch(`/api/assistants/${encodeURIComponent(assistantId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ morningSummary: next, locale }),
      });
      const body = (await res.json().catch(() => ({}))) as { morningSummary?: boolean };
      if (!res.ok || typeof body.morningSummary !== "boolean") throw new Error(String(res.status));
      setOn(body.morningSummary);
    } catch {
      setOn(!next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-2" data-morning-summary="">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={busy}
        onClick={() => void flip()}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-[var(--nc-accent-text)]" : "bg-hover"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} />
        <span className="sr-only">{t("ownAssistant.summary.switch")}</span>
      </button>
      <span className="text-[12.5px] fg" aria-hidden>
        {t("ownAssistant.summary.switch")}
      </span>
      {on && <span className="text-[11.5px] fg-faint">{t("ownAssistant.summary.hint")}</span>}
    </div>
  );
}
