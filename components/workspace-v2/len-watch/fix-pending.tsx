"use client";

// THE PUBLISH THAT WAITS FOR THE LEN WATCH FIX (spec local 2026-10-30-len-watch, §5.5 step 5): Len published a fix
// from its branch and the draft doesn't have it yet — publishing it as it is would bring the crash back. «Traer el
// arreglo» brings it in (POST …/len-watch/bring) and, if it came in, publishes again; «Publicar igual» publishes
// without it. Shared by the publish modal and Len's publish card; it looks like `MissingSecrets`, its neighbour there.
import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { notifyFolderChanged } from "@/lib/lienzo/carpeta-cambiada";

type Note = "bringing" | "handedToLen" | "queued" | "failed" | null;

export function LenWatchFixPending({
  projectId,
  incidentId,
  busy,
  onPublishAgain,
  onPublishAnyway,
  onCancel,
}: {
  projectId: string;
  incidentId: string;
  busy: boolean;
  /** The fix is in the draft now: publish as before. */
  onPublishAgain: () => void;
  /** Publish without it (`acceptLenWatchFix`). */
  onPublishAnyway: () => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("modalsDeploy.lenWatch.fixPending");
  const [note, setNote] = useState<Note>(null);

  const bring = async () => {
    setNote("bringing");
    try {
      const res = await fetch(`/api/projects/${projectId}/len-watch/bring`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId }),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string };
      if (!res.ok && res.status !== 202) return setNote("failed");
      if (data.status === "brought" || data.status === "nothing") {
        setNote(null);
        if (data.status === "brought") notifyFolderChanged(projectId, { outside: true });
        onPublishAgain();
        return;
      }
      setNote(data.status === "queued" ? "queued" : data.status === "handed_to_len" ? "handedToLen" : "failed");
    } catch {
      setNote("failed");
    }
  };

  const working = busy || note === "bringing";
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50/70 px-2.5 py-2 text-[11.5px] dark:border-amber-500/40 dark:bg-amber-500/10" role="alert" data-len-watch-fix-pending>
      <div className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-200">
        <ShieldAlert size={13} className="shrink-0" />
        {t("title")}
      </div>
      <p className="m-0 mt-0.5 fg-muted">{t("body")}</p>
      {note && note !== "bringing" && <p className={`m-0 mt-2 ${note === "failed" ? "text-red-600 dark:text-red-400" : "fg"}`}>{t(note)}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void bring()}
          disabled={working}
          className="inline-flex h-7 items-center rounded-md bg-[var(--accent-strong)] px-3 text-[11.5px] font-medium text-white disabled:opacity-50"
        >
          {note === "bringing" ? t("bringing") : t("bring")}
        </button>
        <button type="button" onClick={onPublishAnyway} disabled={working} className="h-7 rounded-md px-2.5 text-[11.5px] font-medium fg hover:bg-hover">
          {t("publishAnyway")}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={working} className="h-7 rounded-md px-2.5 text-[11.5px] font-medium fg-faint hover:bg-hover hover:fg">
            {t("cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
