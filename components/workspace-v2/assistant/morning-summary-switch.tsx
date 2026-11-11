"use client";

// THE MORNING SUMMARY'S SWITCH IN HER PLACE (spec local 2026-11-06-asistente-propio, §6.9, phase 4D): off unless the
// owner turns it on; on, she tells them at 8 in the morning what happened yesterday, only when something did
// (lib/assistants/summary/). It keeps the language of the page that turned it on.
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { herKnob, herSwitch } from "./her-sheet";

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
    <div className="flex min-w-0 items-center gap-3 px-2.5 py-[7px]" data-morning-summary="">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] fg" aria-hidden>
          {t("ownAssistant.summary.switch")}
        </p>
        {on && <p className="text-[11.5px] leading-snug fg-faint">{t("ownAssistant.summary.hint")}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={busy}
        onClick={() => void flip()}
        className={herSwitch(on)}
      >
        <span className={herKnob(on)} />
        <span className="sr-only">{t("ownAssistant.summary.switch")}</span>
      </button>
    </div>
  );
}
