"use client";

// THE LEN WATCH NOTICE over the chat (spec local 2026-10-30-len-watch, §5.7): the published site isn't
// loading, and where its fix stands — with «Fix with Len» while nobody is on it, and «Publish the fix»
// when Len has one. A publish gate (428) opens the usual Publish review.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";

import { notifyFolderChanged } from "@/lib/lienzo/carpeta-cambiada";
import type { ReviewView } from "@/lib/security-review/types";

import { SecurityPanel } from "../security-findings";
import { useLenWatch } from "./use-len-watch";
import { bannerState } from "./view-model";

export function LenWatchBanner({ projectId, soloLectura, onOpenPublish }: { projectId: string; soloLectura?: boolean; onOpenPublish?: () => void }) {
  const t = useTranslations("panelsChat");
  const tFix = useTranslations("modalsDeploy.lenWatch.fixPending");
  const { status, reload } = useLenWatch(projectId);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<"review" | "failed" | "changed" | null>(null);
  const [bringNote, setBringNote] = useState<"handedToLen" | "queued" | "failed" | null>(null);
  // What the security review found in Len's fix on its branch (spec §5.5): answered here, with «Publicar igual».
  const [findings, setFindings] = useState<ReviewView | null>(null);
  const view = bannerState(status?.incident ?? null, status?.pendingFix ?? null);
  if (view.kind === "hidden") return null;

  // The crash's own fix (it changes tables) is in the draft: the owner's publish carries it, with its migration.
  if (view.kind === "publish") {
    return (
      <div className="mx-4 mt-3 flex shrink-0 flex-col gap-2 rounded-xl border bd bg-elev px-3 py-2.5 text-[12.5px]" role="status" data-len-watch-banner="publish">
        <div className="flex items-start gap-2">
          <ShieldAlert size={14} className="mt-0.5 shrink-0 text-[var(--nc-accent-text)]" />
          <span className="fg">{t("lenWatch.publishBrought")}</span>
        </div>
        {!soloLectura && onOpenPublish && (
          <div className="pl-[22px]">
            <button type="button" onClick={onOpenPublish} className="inline-flex h-7 items-center rounded-md bg-[var(--accent-strong)] px-3 text-[11.5px] font-medium text-white shadow-coral transition hover:brightness-105">
              {t("lenWatch.publishNow")}
            </button>
          </div>
        )}
      </div>
    );
  }

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
      // The draft has the fix now: the canvas reloads it (and this notice looks again, through the same event).
      if (answer === "brought") notifyFolderChanged(projectId);
      else await reload();
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

  const act = async (path: "fix" | "approve", o: { confirmChanged?: true; acceptSecurityFingerprint?: string } = {}) => {
    setBusy(true);
    setNote(null);
    setFindings(null);
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/len-watch/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(o),
    }).catch(() => null);
    setBusy(false);
    if (r?.status === 428) {
      const gate = (await r.json().catch(() => null)) as ({ error?: string; branch?: boolean } & Partial<ReviewView>) | null;
      if (gate?.branch) {
        // Len's fix is on its branch: the Publish modal publishes the draft, never this. A finding is answered here.
        if (gate.error === "security_findings" && gate.fingerprint) setFindings(gate as ReviewView);
        else setNote("failed");
      } else {
        setNote("review");
        onOpenPublish?.();
      }
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
          <button type="button" disabled={busy} onClick={() => void act("approve", { confirmChanged: true })} className="inline-flex h-7 items-center rounded-md border bd px-3 text-[11.5px] font-medium fg hover:bg-hover disabled:opacity-50">
            {t("lenWatch.publishAnyway")}
          </button>
        </div>
      )}
      {!soloLectura && findings && (
        <div className="pl-[22px]">
          <SecurityPanel
            view={findings}
            busy={busy}
            onPublishAnyway={() => void act("approve", { acceptSecurityFingerprint: findings.fingerprint })}
            onCancel={() => setFindings(null)}
          />
        </div>
      )}
    </div>
  );
}
