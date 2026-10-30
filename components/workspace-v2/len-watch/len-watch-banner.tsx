"use client";

// THE LEN WATCH NOTICE over the chat (spec local 2026-10-30-len-watch, §5.7): the published site isn't
// loading, and where its fix stands — with «Fix with Len» while nobody is on it, and «Publish the fix»
// when Len has one. A publish gate (428) opens the usual Publish review.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";

import { useLenWatch } from "./use-len-watch";
import { bannerState } from "./view-model";

export function LenWatchBanner({ projectId, soloLectura, onOpenPublish }: { projectId: string; soloLectura?: boolean; onOpenPublish?: () => void }) {
  const t = useTranslations("panelsChat");
  const { status, reload } = useLenWatch(projectId);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<"review" | "failed" | null>(null);
  const view = bannerState(status?.incident ?? null);
  if (view.kind === "hidden") return null;

  const act = async (path: "fix" | "approve") => {
    setBusy(true);
    setNote(null);
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/len-watch/${path}`, { method: "POST" }).catch(() => null);
    setBusy(false);
    if (r?.status === 428) {
      setNote("review");
      onOpenPublish?.();
    } else if (!r?.ok) {
      setNote("failed");
    }
    await reload();
  };

  const text = view.kind === "working" ? t("lenWatch.working") : view.kind === "down" ? t("lenWatch.down") : t("lenWatch.ready");
  return (
    <div className="mx-4 mt-3 flex shrink-0 flex-col gap-2 rounded-xl border bd bg-elev px-3 py-2.5 text-[12.5px]" role="status" data-len-watch-banner={view.kind}>
      <div className="flex items-start gap-2">
        <ShieldAlert size={14} className="mt-0.5 shrink-0 text-[var(--nc-accent-text)]" />
        <span className="fg">
          {text}
          {view.kind === "ready" && view.shipsUnpublished && <> {t("lenWatch.shipsUnpublished")}</>}
        </span>
      </div>
      {!soloLectura && view.kind !== "working" && (
        <div className="flex items-center gap-2 pl-[22px]">
          <button type="button" disabled={busy} onClick={() => void act(view.kind === "ready" ? "approve" : "fix")} className="rounded-lg bg-[var(--nc-accent)] px-2.5 py-1 font-medium text-white disabled:opacity-60">
            {view.kind === "ready" ? t("lenWatch.approve") : t("lenWatch.fix")}
          </button>
          {note === "review" && <span className="fg-muted">{t("lenWatch.review")}</span>}
          {note === "failed" && <span className="fg-muted">{t("lenWatch.failed")}</span>}
        </div>
      )}
    </div>
  );
}
