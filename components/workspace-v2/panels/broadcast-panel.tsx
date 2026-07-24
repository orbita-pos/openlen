// Broadcast — compose + send a campaign to your members, with history.
// Audience = active members minus unsubscribed (resolved server-side). The
// compose area is plain subject + lightweight-markdown body; "Send now" has an
// inline confirm step. Saved drafts can be re-opened (Edit) or sent (Send)
// straight from the history list. Mirrors ModulesPanel header + SubmissionsPanel list.

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/workspace-v2/toast";
import { Loader, Megaphone, Pencil, SendUp, Trash, Users } from "../icons";

interface BroadcastItem {
  id: string;
  subject: string;
  body: string;
  status: "draft" | "sending" | "sent" | "failed";
  audienceCount: number | null;
  sentCount: number | null;
  sentAt: string | null;
  createdAt: string;
}

interface Preview {
  audienceCount: number;
  remaining: number;
}

export function BroadcastPanel({
  currentProjectId,
  membersEnabled = false,
}: {
  currentProjectId?: string | null;
  membersEnabled?: boolean;
}) {
  const t = useTranslations("broadcast");
  const toast = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<BroadcastItem[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmingRow, setConfirmingRow] = useState<string | null>(null);
  const [busy, setBusy] = useState<"saving" | "sending" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadHistory = (pid: string) => {
    void fetch(`/api/projects/${pid}/broadcasts`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { broadcasts: BroadcastItem[] } | null) => {
        if (d) setHistory(d.broadcasts);
      })
      .catch(() => setHistory([]));
  };
  const loadPreview = (pid: string) => {
    void fetch(`/api/projects/${pid}/broadcasts/preview`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Preview | null) => d && setPreview(d))
      .catch(() => {});
  };

  useEffect(() => {
    if (!currentProjectId) {
      setHistory([]);
      return;
    }
    setHistory(null);
    setPreview(null);
    setEditingId(null);
    setSubject("");
    setBody("");
    loadHistory(currentProjectId);
    loadPreview(currentProjectId);
  }, [currentProjectId]);

  if (!currentProjectId) {
    return <Empty icon={<Megaphone size={14} />} text={t("perProject")} />;
  }

  const audience = preview?.audienceCount ?? 0;
  const remaining = preview?.remaining ?? 0;
  const canCompose = subject.trim().length > 0 && body.trim().length > 0;

  const resetCompose = () => {
    setSubject("");
    setBody("");
    setEditingId(null);
    setConfirming(false);
  };

  // Create a new draft, or persist edits to the draft being edited. Returns id.
  const persistDraft = async (): Promise<string | null> => {
    if (editingId) {
      const r = await fetch(
        `/api/projects/${currentProjectId}/broadcasts/${editingId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ subject: subject.trim(), body: body.trim() }),
        },
      );
      return r.ok ? editingId : null;
    }
    const r = await fetch(`/api/projects/${currentProjectId}/broadcasts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: subject.trim(), body: body.trim() }),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { broadcast: { id: string } };
    return d.broadcast.id;
  };

  const saveDraft = async () => {
    if (!canCompose || busy) return;
    setBusy("saving");
    setMsg(null);
    const id = await persistDraft();
    setBusy(null);
    if (id) {
      resetCompose();
      setMsg(t("compose.saved"));
      loadHistory(currentProjectId);
    } else {
      setMsg(t("send.error"));
    }
  };

  // POST the send for an existing broadcast id; handle every status the route
  // can return. Clears the compose editor when the sent campaign is loaded there.
  const sendById = async (id: string, clearComposeOnOk: boolean) => {
    try {
      const r = await fetch(
        `/api/projects/${currentProjectId}/broadcasts/${id}/send`,
        { method: "POST" },
      );
      const d = (await r.json().catch(() => ({}))) as {
        sentCount?: number;
        remaining?: number;
        audienceCount?: number;
      };
      if (r.status === 402) {
        setMsg(
          t("send.capBlocked", {
            needed: d.audienceCount ?? audience,
            remaining: d.remaining ?? remaining,
          }),
        );
      } else if (r.status === 403) {
        setMsg(t("module.needsMembers"));
      } else if (r.status === 409) {
        setMsg(t("send.notPublished"));
      } else if (r.status === 503) {
        // Broadcast está en pausa a propósito: decirlo, en vez de invitar a
        // reintentar para siempre con el mensaje transitorio.
        setMsg(t("send.paused"));
      } else if (!r.ok) {
        setMsg(t("send.error"));
      } else {
        if (clearComposeOnOk) resetCompose();
        setMsg(t("send.sent", { count: d.sentCount ?? 0 }));
      }
    } catch {
      setMsg(t("send.error"));
    }
  };

  // Compose "Send now" — persist (create or update) then send.
  const send = async () => {
    if (!canCompose || busy) return;
    setBusy("sending");
    setMsg(null);
    setConfirming(false);
    const id = await persistDraft();
    if (!id) {
      setBusy(null);
      setMsg(t("send.error"));
      return;
    }
    await sendById(id, true);
    setBusy(null);
    loadHistory(currentProjectId);
    loadPreview(currentProjectId);
  };

  // Send a saved draft straight from its history row (two-tap confirm).
  const sendRow = async (id: string) => {
    if (busy) return;
    if (confirmingRow !== id) {
      setConfirmingRow(id);
      return;
    }
    setConfirmingRow(null);
    setBusy("sending");
    setMsg(null);
    await sendById(id, editingId === id);
    setBusy(null);
    loadHistory(currentProjectId);
    loadPreview(currentProjectId);
  };

  const startEdit = (b: BroadcastItem) => {
    setEditingId(b.id);
    setSubject(b.subject);
    setBody(b.body);
    setConfirming(false);
    setConfirmingRow(null);
    setMsg(null);
  };

  const remove = async (id: string) => {
    setDeleting(id);
    try {
      const r = await fetch(
        `/api/projects/${currentProjectId}/broadcasts/${id}`,
        { method: "DELETE" },
      );
      if (r.ok) {
        if (editingId === id) resetCompose();
        if (confirmingRow === id) setConfirmingRow(null);
        loadHistory(currentProjectId);
        toast.success(t("toast.deleted"));
      } else {
        toast.error(t("toast.deleteError"));
      }
    } catch {
      toast.error(t("toast.deleteError"));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-1.5 shrink-0">
        <div className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
          {t("title")}
        </div>
        <div className="text-[11px] fg-faint mt-0.5">{t("subtitle")}</div>
      </div>

      <div className="flex-1 overflow-y-auto nice-scroll px-3 pb-3 space-y-3">
        {!membersEnabled && (
          <div className="rounded-lg ring-1 ring-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10.5px] leading-relaxed text-amber-700 dark:text-amber-400 inline-flex items-start gap-1.5">
            <Users size={12} className="mt-[1px] shrink-0" />
            <span>{t("module.needsMembers")}</span>
          </div>
        )}

        {/* Compose */}
        <div className="rounded-lg ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] p-2.5 space-y-2">
          {editingId && (
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold ui-small px-1.5 h-[18px] rounded bg-elev fg-muted">
                <Pencil size={9} /> {t("compose.editing")}
              </span>
              <button
                type="button"
                onClick={resetCompose}
                aria-label={t("compose.cancelEdit")}
                className="h-5 px-1.5 rounded text-[10.5px] fg-faint hover:fg hover:bg-hover transition"
              >
                ×
              </button>
            </div>
          )}
          <input
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setMsg(null);
              setConfirming(false);
            }}
            maxLength={200}
            placeholder={t("compose.subjectPlaceholder")}
            aria-label={t("compose.subjectLabel")}
            className="w-full bg-app border bd rounded px-2 h-8 text-[12.5px] font-medium fg outline-none focus:border-[color:var(--accent)]"
          />
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setMsg(null);
              setConfirming(false);
            }}
            maxLength={20000}
            rows={7}
            placeholder={t("compose.bodyPlaceholder")}
            aria-label={t("compose.bodyLabel")}
            className="w-full bg-app border bd rounded px-2 py-1.5 text-[12px] fg outline-none focus:border-[color:var(--accent)] resize-none leading-relaxed"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] fg-faint">
              {audience > 0
                ? t("compose.sendTo", { count: audience })
                : t("compose.sendToNone")}
              {preview && ` · ${t("compose.remaining", { count: remaining })}`}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!canCompose || busy !== null}
              onClick={() => void saveDraft()}
              className="h-7 px-2.5 rounded-md text-[11px] font-medium fg-muted hover:fg bg-elev ring-1 ring-[color:var(--border)] hover:bg-hover transition disabled:opacity-50"
            >
              {busy === "saving" ? t("compose.sending") : t("compose.save")}
            </button>
            <button
              type="button"
              disabled={!canCompose || busy !== null || audience === 0}
              onClick={() => (confirming ? void send() : setConfirming(true))}
              className="flex-1 h-7 rounded-md text-[11.5px] font-semibold text-white bg-[var(--accent-strong)] hover:brightness-105 transition disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
            >
              {busy === "sending" && <Loader size={11} className="animate-spin" />}
              {busy === "sending"
                ? t("compose.sending")
                : confirming
                  ? t("compose.confirm", { count: audience })
                  : t("compose.send")}
            </button>
          </div>
          {msg && (
            <div className="text-[10.5px] fg-muted leading-relaxed">{msg}</div>
          )}
        </div>

        {/* History */}
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small px-0.5 pb-1.5">
            {t("history.title")}
          </div>
          {history === null && (
            <div className="space-y-1.5">
              {[0, 1].map((i) => (
                <div key={i} className="h-10 rounded-md bg-zinc-200/60 dark:bg-zinc-800/50 animate-pulse" />
              ))}
            </div>
          )}
          {history !== null && history.length === 0 && (
            <p className="px-0.5 text-[10.5px] fg-faint">{t("history.empty")}</p>
          )}
          {history !== null && history.length > 0 && (
            <ul className="space-y-1.5">
              {history.map((b) => (
                <li
                  key={b.id}
                  className="group rounded-lg ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] px-2.5 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 text-[12px] font-medium fg truncate">
                      {b.subject}
                    </span>
                    <StatusPill t={t} status={b.status} />
                    {b.status === "draft" && editingId !== b.id && (
                      <>
                        <button
                          type="button"
                          disabled={busy !== null || deleting === b.id}
                          aria-label={t("history.edit")}
                          onClick={() => startEdit(b)}
                          className="h-6 w-6 hidden group-hover:inline-flex items-center justify-center rounded fg-faint hover:fg hover:bg-hover transition disabled:opacity-50 shrink-0"
                        >
                          <Pencil size={10} />
                        </button>
                        <button
                          type="button"
                          disabled={busy !== null || audience === 0}
                          aria-label={t("history.send")}
                          onClick={() => void sendRow(b.id)}
                          className={`h-6 items-center justify-center rounded text-[var(--accent-strong)] hover:bg-hover transition disabled:opacity-50 shrink-0 ${
                            confirmingRow === b.id
                              ? "inline-flex px-1.5 text-[9.5px] font-semibold"
                              : "w-6 hidden group-hover:inline-flex"
                          }`}
                        >
                          {confirmingRow === b.id ? (
                            t("history.confirmSend")
                          ) : (
                            <SendUp size={10} />
                          )}
                        </button>
                      </>
                    )}
                    {(b.status === "draft" ||
                      b.status === "sent" ||
                      b.status === "failed") && (
                      <button
                        type="button"
                        disabled={deleting === b.id || busy !== null}
                        aria-label={t("history.delete")}
                        onClick={() => void remove(b.id)}
                        className="h-6 w-6 hidden group-hover:inline-flex items-center justify-center rounded fg-faint hover:text-red-500 hover:bg-hover transition disabled:opacity-50 shrink-0"
                      >
                        {deleting === b.id ? (
                          <Loader size={10} className="animate-spin" />
                        ) : (
                          <Trash size={10} />
                        )}
                      </button>
                    )}
                  </div>
                  {b.status === "sent" && b.sentCount !== null && (
                    <div className="mt-0.5 text-[10px] fg-faint ui-small">
                      {t("history.delivered", { count: b.sentCount })}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({
  t,
  status,
}: {
  t: (k: string) => string;
  status: BroadcastItem["status"];
}) {
  const map: Record<BroadcastItem["status"], { label: string; cls: string }> = {
    draft: { label: t("history.draft"), cls: "bg-elev fg-muted" },
    sending: { label: t("history.statusSending"), cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
    sent: { label: t("history.sent"), cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
    failed: { label: t("history.failed"), cls: "bg-red-500/15 text-red-600 dark:text-red-400" },
  };
  const s = map[status];
  return (
    <span className={`shrink-0 inline-flex items-center px-1.5 h-[16px] rounded text-[9.5px] font-semibold ui-small ${s.cls}`}>
      {s.label}
    </span>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="h-full flex items-center justify-center px-6 py-8 text-center">
      <div className="max-w-[220px]">
        <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev fg-faint">
          {icon}
        </div>
        <p className="text-[11.5px] fg-muted leading-relaxed">{text}</p>
      </div>
    </div>
  );
}
