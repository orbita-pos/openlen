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
  const tFix = useTranslations("modalsDeploy.lenWatch.fixPending");
  const { status, reload } = useLenWatch(projectId);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<"review" | "failed" | "changed" | null>(null);
  const [bringNote, setBringNote] = useState<"handedToLen" | "queued" | "failed" | null>(null);
  const view = bannerState(status?.incident ?? null, status?.pendingFix ?? null);
  if (view.kind === "hidden") return null;

  // «Traer el arreglo» (spec §5.5): the fix Len published from its branch comes into the draft.
  if (view.kind === "bring") {
    const bring = async () => {
      setBusy(true);
      setBringNote(null);
      const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/len-watch/bring`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId: view.incidentId }),
      }).catch(() => null);
      const answer = r && (r.ok || r.status === 202) ? (((await r.json().catch(() => null)) as { status?: string } | null)?.status ?? null) : null;
      setBusy(false);
      if (answer === "handed_to_len") setBringNote("handedToLen");
      else if (answer === "queued") setBringNote("queued");
      else if (answer !== "brought" && answer !== "nothing") setBringNote("failed");
      await reload();
    };
    return (
      <div className="mx-4 mt-3 flex shrink-0 flex-col gap-2 rounded-xl border bd bg-elev px-3 py-2.5 text-[12.5px]" role="status" data-len-watch-banner="bring">
        <div className="flex items-start gap-2">
          <ShieldAlert size={14} className="mt-0.5 shrink-0 text-[var(--nc-accent-text)]" />
          <span className="fg">
            {tFix("title")}. {tFix("body")}
          </span>
        </div>
        {!soloLectura && (
          <div className="flex flex-col items-start gap-1.5 pl-[22px]">
            <button type="button" disabled={busy} onClick={() => void bring()} className="inline-flex h-7 items-center rounded-md bg-[var(--accent-strong)] px-3 text-[11.5px] font-medium text-white shadow-coral transition hover:brightness-105 disabled:opacity-50">
              {busy ? tFix("bringing") : tFix("bring")}
            </button>
            {bringNote && <span className="fg-muted">{tFix(bringNote)}</span>}
          </div>
        )}
      </div>
    );
  }

  const act = async (path: "fix" | "approve", confirmChanged = false) => {
    setBusy(true);
    setNote(null);
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/len-watch/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(confirmChanged ? { confirmChanged: true } : {}),
    }).catch(() => null);
    setBusy(false);
    if (r?.status === 428) {
      setNote("review");
      onOpenPublish?.();
    } else if (r?.status === 409 && ((await r.json().catch(() => null)) as { error?: string } | null)?.error === "changed_since_fix") {
      // The draft moved after Len's fix: publishing would carry those edits too. Ask, don't guess.
      setNote("changed");
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
          <button type="button" disabled={busy} onClick={() => void act(view.kind === "ready" ? "approve" : "fix")} className="inline-flex h-7 items-center rounded-md bg-[var(--accent-strong)] px-3 text-[11.5px] font-medium text-white shadow-coral transition hover:brightness-105 disabled:opacity-50">
            {view.kind === "ready" ? t("lenWatch.approve") : t("lenWatch.fix")}
          </button>
          {note === "review" && <span className="fg-muted">{t("lenWatch.review")}</span>}
          {note === "failed" && <span className="fg-muted">{t("lenWatch.failed")}</span>}
        </div>
      )}
      {!soloLectura && note === "changed" && (
        <div className="flex flex-col items-start gap-1.5 pl-[22px]">
          <span className="fg-muted">{t("lenWatch.changed")}</span>
          <button type="button" disabled={busy} onClick={() => void act("approve", true)} className="inline-flex h-7 items-center rounded-md border bd px-3 text-[11.5px] font-medium fg hover:bg-hover disabled:opacity-50">
            {t("lenWatch.publishAnyway")}
          </button>
        </div>
      )}
    </div>
  );
}
