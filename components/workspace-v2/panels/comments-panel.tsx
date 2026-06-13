// Comments moderation — the owner's queue of member comments. Approve / hide /
// delete + ban the author. Mirrors SubmissionsPanel's fetch/skeleton/empty
// pattern. Bodies render as plain text (the server stores plain text; React
// escapes by default — never dangerouslySetInnerHTML).

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, EyeOff, Loader, MessageSq, Trash, Users } from "../icons";

interface CommentItem {
  id: string;
  page: string | null;
  memberId: string | null;
  authorName: string | null;
  body: string;
  status: "visible" | "hidden";
  createdAt: string;
}

type Filter = "all" | "hidden" | "visible";

export function CommentsPanel({
  currentProjectId,
}: {
  currentProjectId?: string | null;
}) {
  const t = useTranslations("comments");
  const [items, setItems] = useState<CommentItem[] | null>(null);
  const [pending, setPending] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmBan, setConfirmBan] = useState<string | null>(null);

  const load = (pid: string, f: Filter) => {
    setError(null);
    const q = f === "all" ? "" : `?status=${f}`;
    void fetch(`/api/projects/${pid}/comments${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { comments: CommentItem[]; pending: number }) => {
        setItems(d.comments);
        setPending(d.pending);
      })
      .catch(() => {
        setError(t("list.loadError"));
        setItems([]);
      });
  };

  useEffect(() => {
    if (!currentProjectId) {
      setItems([]);
      return;
    }
    setItems(null);
    load(currentProjectId, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, filter]);

  if (!currentProjectId) {
    return (
      <div className="h-full flex items-center justify-center px-6 py-8 text-center">
        <div className="max-w-[220px]">
          <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev fg-faint">
            <MessageSq size={14} />
          </div>
          <p className="text-[11.5px] fg-muted leading-relaxed">{t("perProject")}</p>
        </div>
      </div>
    );
  }

  const act = async (id: string, fn: () => Promise<Response>) => {
    setBusy(id);
    try {
      const r = await fn();
      if (r.ok && currentProjectId) load(currentProjectId, filter);
    } finally {
      setBusy(null);
      setConfirmBan(null);
    }
  };
  const setStatus = (id: string, status: "visible" | "hidden") =>
    act(id, () =>
      fetch(`/api/projects/${currentProjectId}/comments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      }),
    );
  const remove = (id: string) =>
    act(id, () =>
      fetch(`/api/projects/${currentProjectId}/comments/${id}`, { method: "DELETE" }),
    );
  const ban = (id: string) =>
    act(id, () =>
      fetch(`/api/projects/${currentProjectId}/comments/${id}/ban`, { method: "POST" }),
    );

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-1.5 shrink-0">
        <div className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
          {t("title")}
        </div>
        <div className="text-[11px] fg-faint mt-0.5">{t("subtitle")}</div>
      </div>

      <div className="px-3 pb-2 shrink-0">
        <div className="flex rounded-md bg-elev ring-1 ring-[color:var(--border)] p-0.5">
          {(["all", "hidden", "visible"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`flex-1 h-6 rounded text-[10.5px] font-medium transition ${
                filter === f ? "bg-[color:var(--bg)] fg shadow-card" : "fg-faint hover:fg"
              }`}
            >
              {t(`filter.${f === "hidden" ? "pending" : f}`)}
              {f === "hidden" && pending > 0 ? ` (${pending})` : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto nice-scroll px-3 pb-3">
        {error && (
          <div className="mb-2 rounded-md ring-1 ring-red-500/40 bg-red-500/5 px-2 py-1.5 text-[11px] text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
        {items === null && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 rounded-lg bg-zinc-200/60 dark:bg-zinc-800/50 animate-pulse" />
            ))}
          </div>
        )}
        {items !== null && items.length === 0 && !error && (
          <p className="px-1 py-8 text-center text-[11.5px] fg-faint">{t("list.empty")}</p>
        )}
        {items !== null && items.length > 0 && (
          <ul className="space-y-2">
            {items.map((c) => (
              <li
                key={c.id}
                className="group rounded-lg ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] px-2.5 py-2"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[12px] font-semibold fg truncate max-w-[45%]">
                    {c.authorName || t("list.deletedMember")}
                  </span>
                  {c.page && (
                    <span className="inline-flex items-center px-1.5 h-[15px] rounded text-[9px] font-semibold ui-small bg-elev fg-muted ring-1 ring-[color:var(--border)] max-w-[90px]">
                      <span className="truncate">/{c.page}</span>
                    </span>
                  )}
                  <span
                    className={`ml-auto inline-flex items-center px-1.5 h-[15px] rounded text-[9px] font-semibold ui-small ${
                      c.status === "visible"
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {c.status === "visible" ? t("list.visible") : t("list.pending")}
                  </span>
                </div>
                <p className="text-[12px] fg leading-snug whitespace-pre-wrap break-words">
                  {c.body}
                </p>
                <div className="mt-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                  {c.status === "hidden" ? (
                    <ModBtn label={t("list.approve")} onClick={() => setStatus(c.id, "visible")} busy={busy === c.id}>
                      <Check size={11} />
                    </ModBtn>
                  ) : (
                    <ModBtn label={t("list.hide")} onClick={() => setStatus(c.id, "hidden")} busy={busy === c.id}>
                      <EyeOff size={11} />
                    </ModBtn>
                  )}
                  <ModBtn label={t("list.delete")} onClick={() => remove(c.id)} busy={busy === c.id} danger>
                    <Trash size={11} />
                  </ModBtn>
                  {c.memberId &&
                    (confirmBan === c.id ? (
                      <button
                        type="button"
                        onClick={() => ban(c.id)}
                        className="h-6 px-2 rounded text-[10px] font-semibold bg-red-600 text-white hover:bg-red-700 transition"
                      >
                        {t("list.banConfirm")}
                      </button>
                    ) : (
                      <ModBtn label={t("list.ban")} onClick={() => setConfirmBan(c.id)} busy={false}>
                        <Users size={11} />
                      </ModBtn>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ModBtn({
  label,
  onClick,
  busy,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      className={`h-6 w-6 inline-flex items-center justify-center rounded fg-faint hover:bg-hover transition disabled:opacity-50 ${
        danger ? "hover:text-red-500" : "hover:fg"
      }`}
    >
      {busy ? <Loader size={10} className="animate-spin" /> : children}
    </button>
  );
}
