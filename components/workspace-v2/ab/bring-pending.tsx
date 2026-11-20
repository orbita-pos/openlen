"use client";

// THE PUBLISH THAT WAITS FOR A PROMOTED A/B WINNER (review item 26). Variant B is live (the owner promoted it) but it
// isn't in their draft: it clashed with their edits, or Len was working when it was promoted. Publishing the draft now would
// send the page WITHOUT it and undo the promotion, so the publish waits for one of two answers: «Bring in, then publish»
// (POST …/ab/<id>/bring) or «Discard and publish» (the same route with `action: "discard"`: the draft stays as it is).
// Shared by the Publish dialog and Len's publish card; it looks like `LenWatchFixPending`, its neighbour there.
import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";

import { notifyFolderChanged } from "@/lib/lienzo/carpeta-cambiada";

type Note = "working" | "queued" | "conflict" | "failed" | null;

export function AbBringPending({
  projectId,
  experimentId,
  name,
  busy,
  onPublishAgain,
  onCancel,
}: {
  projectId: string;
  experimentId: string;
  /** The promoted test's name, when the answer carried it. */
  name?: string;
  busy: boolean;
  /** B is in the draft (or the owner gave it up): publish as they first asked. */
  onPublishAgain: () => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("modalsDeploy.abBringPending");
  const [note, setNote] = useState<Note>(null);

  const send = async (action: "retry" | "discard") => {
    setNote("working");
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/ab/${encodeURIComponent(experimentId)}/bring`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string };
      if (!res.ok) return setNote("failed");
      if (action === "discard" || data.status === "brought" || data.status === "nothing") {
        setNote(null);
        if (data.status === "brought") notifyFolderChanged(projectId, { outside: true });
        onPublishAgain();
        return;
      }
      setNote(data.status === "queued" ? "queued" : data.status === "conflict" ? "conflict" : "failed");
    } catch {
      setNote("failed");
    }
  };

  const working = busy || note === "working";
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50/70 px-2.5 py-2 text-[11.5px] dark:border-amber-500/40 dark:bg-amber-500/10" role="alert" data-ab-bring-pending>
      <div className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-200">
        <FlaskConical size={13} className="shrink-0" />
        {t("title")}
      </div>
      <p className="m-0 mt-0.5 fg-muted">{t("body")}</p>
      {name ? <p className="m-0 mt-1 fg-faint">{name}</p> : null}
      {note && note !== "working" && <p className={`m-0 mt-2 ${note === "failed" ? "text-red-600 dark:text-red-400" : "fg"}`}>{t(note)}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void send("retry")}
          disabled={working}
          className="inline-flex h-7 items-center rounded-md bg-[var(--accent-strong)] px-3 text-[11.5px] font-medium text-white disabled:opacity-50"
        >
          {note === "working" ? t("bringing") : t("bring")}
        </button>
        <button type="button" onClick={() => void send("discard")} disabled={working} className="h-7 rounded-md px-2.5 text-[11.5px] font-medium fg hover:bg-hover">
          {t("discard")}
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
