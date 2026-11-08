"use client";

// «EN MI PÁGINA» (spec local 2026-11-06-asistente-propio, §4.4.5; phase 2A): her bubble on the published page. Off is
// immediate; on shows after the next publish, which bakes her bubble — and says so, after a reload too. An app or a
// game can't have it yet (phase 2B): the switch says so and stays off.
import { useTranslations } from "next-intl";
import { useState } from "react";

export function OnPageSwitch({
  assistantId,
  initial,
  initialNeedsPublish = false,
  forApp = false,
}: {
  assistantId: string;
  initial: boolean;
  initialNeedsPublish?: boolean;
  forApp?: boolean;
}) {
  const t = useTranslations("panelsChat");
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [needsPublish, setNeedsPublish] = useState(initialNeedsPublish);

  const flip = async () => {
    if (forApp) return;
    const next = !on;
    setBusy(true);
    setOn(next);
    try {
      const res = await fetch(`/api/assistants/${assistantId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ onPage: next }),
      });
      const body = (await res.json().catch(() => ({}))) as { onPage?: boolean; needsPublish?: boolean };
      if (!res.ok || typeof body.onPage !== "boolean") throw new Error(String(res.status));
      setOn(body.onPage);
      setNeedsPublish(body.needsPublish === true);
    } catch {
      setOn(!next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-2" data-on-page="">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={busy || forApp}
        onClick={() => void flip()}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-[var(--nc-accent-text)]" : "bg-hover"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} />
        <span className="sr-only">{t("ownAssistant.place.onPage")}</span>
      </button>
      <span className="text-[12.5px] fg" aria-hidden>
        {t("ownAssistant.place.onPage")}
      </span>
      {forApp ? (
        <span className="truncate text-[11.5px] fg-faint">{t("ownAssistant.place.onPageApps")}</span>
      ) : (
        on && needsPublish && <span className="truncate text-[11.5px] fg-faint">{t("ownAssistant.place.onPageHint")}</span>
      )}
    </div>
  );
}
