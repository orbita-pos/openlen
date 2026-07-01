"use client";

// Owner Desk — cross-project inbox. Lists every conversation grouped by the
// project it belongs to; selecting one opens a thread with live polling + a
// reply composer. Every message body / username is rendered as a React text
// child (auto-escaped) — never dangerouslySetInnerHTML — so a hostile visitor
// name or message can't inject markup. Talks to the P3-5 owner Desk API.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { ArrowLeft, Inbox, Loader2, MessageSquare, Send } from "lucide-react";

interface Conversation {
  id: string;
  otherUserId: string;
  otherUsername: string;
  otherDisplayName: string | null;
  lastMessageAt: string | null;
  assignedUserId: string | null;
  assigneeName: string | null;
  assignedAt: string | null;
  origin: string | null;
}
interface ProjectGroup {
  projectId: string;
  projectTitle: string;
  conversations: Conversation[];
}
interface Message {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  mine: boolean;
}

const POLL_MS = 3000;

export function InboxDesk() {
  const t = useTranslations("inbox");
  const locale = useLocale();
  const { data: session } = useSession();
  const myUserId = session?.user?.id ?? null;

  const [inbox, setInbox] = useState<ProjectGroup[] | null>(null);
  const [inboxError, setInboxError] = useState(false);
  const [selected, setSelected] = useState<Conversation | null>(null);
  // Assignment state for the selected thread (kept separate so SSE can update it
  // without replacing the whole selected conversation object).
  const [assignment, setAssignment] = useState<{
    assignedUserId: string | null;
    assigneeName: string | null;
    assignedAt: string | null;
  } | null>(null);
  const [assigning, setAssigning] = useState(false);

  const [messages, setMessages] = useState<Message[] | null>(null);
  const [threadError, setThreadError] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  // otherReadAt: the OTHER participant's last-read timestamp (visitor, for the owner desk).
  const [otherReadAt, setOtherReadAt] = useState<Date | null>(null);
  // Outgoing typing ping state — debounce timer + last value sent (avoids spam).
  const typingPing = useRef<{ timer: ReturnType<typeof setTimeout> | null; on: boolean }>({
    timer: null,
    on: false,
  });

  const loadInbox = useCallback(async () => {
    setInboxError(false);
    try {
      const res = await fetch("/api/inbox");
      if (!res.ok) {
        setInbox([]);
        setInboxError(true);
        return;
      }
      const data = (await res.json()) as { inbox?: ProjectGroup[] };
      setInbox(data.inbox ?? []);
    } catch {
      setInbox([]);
      setInboxError(true);
    }
  }, []);

  // Patch an assignment update into both the list and the selected-thread state.
  const applyAssignment = useCallback(
    (
      conversationId: string,
      patch: { assignedUserId: string | null; assigneeName: string | null; assignedAt: string | null },
    ) => {
      setInbox((prev) => {
        if (!prev) return prev;
        return prev.map((g) => ({
          ...g,
          conversations: g.conversations.map((c) =>
            c.id === conversationId ? { ...c, ...patch } : c,
          ),
        }));
      });
      setSelected((prev) => (prev?.id === conversationId ? { ...prev, ...patch } : prev));
      setAssignment((prev) =>
        prev === null || selected?.id === conversationId ? patch : prev,
      );
    },
    [selected?.id],
  );

  const doAssign = useCallback(
    async (body: { userId?: string | null }) => {
      if (!selected || assigning) return;
      setAssigning(true);
      try {
        const res = await fetch(`/api/inbox/${selected.id}/assign`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          assignedUserId: string | null;
          assigneeName: string | null;
          assignedAt: string | null;
        };
        applyAssignment(selected.id, data);
      } catch {
        // leave state as-is; user can retry
      } finally {
        setAssigning(false);
      }
    },
    [selected, assigning, applyAssignment],
  );

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  // Append only genuinely-new messages (poll overlaps + the optimistic reply
  // append can both deliver the same row — dedupe by id).
  const appendMessages = useCallback((incoming: Message[]) => {
    setMessages((prev) => {
      const base = prev ?? [];
      const known = new Set(base.map((m) => m.id));
      const fresh = incoming.filter((m) => !known.has(m.id));
      return fresh.length ? [...base, ...fresh] : base;
    });
  }, []);

  // Sync assignment state when the selected conversation changes.
  useEffect(() => {
    if (!selected) {
      setAssignment(null);
      return;
    }
    setAssignment({
      assignedUserId: selected.assignedUserId,
      assigneeName: selected.assigneeName,
      assignedAt: selected.assignedAt,
    });
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the selected thread + poll for new messages every POLL_MS. Cursor is
  // an effect-local so the interval closure always sees the latest value; the
  // whole effect tears down (interval cleared) on unmount or conversation switch.
  useEffect(() => {
    if (!selected) return;
    const conversationId = selected.id;
    let cancelled = false;
    let cursor: string | null = null;
    setMessages(null);
    setThreadError(false);
    setOtherReadAt(null);

    const load = async (since: string | null) => {
      try {
        const url = since
          ? `/api/inbox/${conversationId}/messages?since=${encodeURIComponent(since)}`
          : `/api/inbox/${conversationId}/messages`;
        const res = await fetch(url);
        if (!res.ok) {
          if (!since && !cancelled) setThreadError(true);
          return;
        }
        const data = (await res.json()) as {
          messages?: Message[];
          nextCursor?: string | null;
          otherReadAt?: string | null;
        };
        if (cancelled) return;
        cursor = data.nextCursor ?? cursor;
        // Update otherReadAt from the initial load only (since === null) —
        // polling responses don't change the read pointer unless a read event fires.
        if (!since && data.otherReadAt) setOtherReadAt(new Date(data.otherReadAt));
        const incoming = data.messages ?? [];
        if (since) {
          if (incoming.length) appendMessages(incoming);
        } else {
          setMessages(incoming);
        }
      } catch {
        if (!since && !cancelled) setThreadError(true);
      }
    };

    void load(null);
    const interval = setInterval(() => void load(cursor), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selected, appendMessages]);

  // Live SSE layered on the poll (fallback). Streamed messages are RAW — compute
  // `mine` (a streamed message authored by the visitor → not ours). Presence +
  // typing drive the header. On error we close and let the 3s poll carry on.
  useEffect(() => {
    if (!selected) return;
    const conversationId = selected.id;
    const otherUserId = selected.otherUserId;
    setPeerOnline(false);
    setPeerTyping(false);
    let typingTimer: ReturnType<typeof setTimeout> | null = null;
    let es: EventSource | null = null;

    const onFrame = (raw: string) => {
      let evt: {
        type?: string;
        message?: { id: string; authorId: string; body: string; createdAt: string };
        userId?: string;
        online?: boolean;
        isTyping?: boolean;
        readAt?: string;
        conversationId?: string;
        assignedUserId?: string | null;
        assigneeName?: string | null;
        assignedAt?: string | null;
      };
      try {
        evt = JSON.parse(raw);
      } catch {
        return;
      }
      if (evt.type === "message" && evt.message) {
        const m = evt.message;
        appendMessages([{ ...m, mine: m.authorId !== otherUserId }]);
      } else if (evt.type === "presence") {
        if (evt.userId === otherUserId) setPeerOnline(!!evt.online);
      } else if (evt.type === "typing") {
        if (evt.userId !== otherUserId) return;
        setPeerTyping(!!evt.isTyping);
        if (typingTimer) clearTimeout(typingTimer);
        if (evt.isTyping) typingTimer = setTimeout(() => setPeerTyping(false), 4000);
      } else if (evt.type === "read" && evt.userId === otherUserId && evt.readAt) {
        // Visitor read our messages — advance their last-read pointer.
        setOtherReadAt(new Date(evt.readAt));
      } else if (evt.type === "assignment" && evt.conversationId) {
        applyAssignment(evt.conversationId, {
          assignedUserId: evt.assignedUserId ?? null,
          assigneeName: evt.assigneeName ?? null,
          assignedAt: evt.assignedAt ?? null,
        });
      }
    };

    try {
      es = new EventSource(`/api/inbox/${conversationId}/stream`);
    } catch {
      return;
    }
    es.addEventListener("message", (e: MessageEvent) => onFrame(e.data));
    es.addEventListener("presence", (e) => onFrame((e as MessageEvent).data));
    es.addEventListener("typing", (e) => onFrame((e as MessageEvent).data));
    es.addEventListener("read", (e) => onFrame((e as MessageEvent).data));
    es.addEventListener("assignment", (e) => onFrame((e as MessageEvent).data));
    es.onerror = () => {
      es?.close();
      es = null;
    };

    return () => {
      if (typingTimer) clearTimeout(typingTimer);
      const ping = typingPing.current;
      if (ping.timer) {
        clearTimeout(ping.timer);
        ping.timer = null;
      }
      ping.on = false;
      es?.close();
      es = null;
    };
  }, [selected, appendMessages, applyAssignment]);

  // Auto-scroll the thread to the newest message.
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, selected]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !selected || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/inbox/${selected.id}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { message?: Message };
      if (data.message) appendMessages([data.message]);
      setDraft("");
    } catch {
      /* leave the draft in place so the owner can retry */
    } finally {
      setSending(false);
    }
  }, [draft, selected, sending, appendMessages]);

  // Fire a typing ping (deduped against the last value sent) to the peer.
  const pingTyping = useCallback(
    (isTyping: boolean) => {
      const st = typingPing.current;
      if (st.on === isTyping || !selected) return;
      st.on = isTyping;
      void fetch(`/api/inbox/${selected.id}/typing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isTyping }),
      }).catch(() => {});
    },
    [selected],
  );

  // On every keystroke: signal typing, then debounce a "stopped" after idle.
  const onDraftChange = useCallback(
    (value: string) => {
      setDraft(value);
      const st = typingPing.current;
      pingTyping(true);
      if (st.timer) clearTimeout(st.timer);
      st.timer = setTimeout(() => pingTyping(false), 1500);
    },
    [pingTyping],
  );

  // The id of the owner's LAST own message that the visitor has read
  // (createdAt <= otherReadAt). Only the last qualifying message shows the
  // "✓✓" indicator — one indicator per thread, not per message.
  const lastSeenMsgId = useMemo<string | null>(() => {
    if (!otherReadAt || !messages) return null;
    const orat = otherReadAt.getTime();
    let lastId: string | null = null;
    for (const m of messages) {
      if (m.mine && new Date(m.createdAt).getTime() <= orat) lastId = m.id;
    }
    return lastId;
  }, [messages, otherReadAt]);

  const hasAny = !!inbox && inbox.some((g) => g.conversations.length > 0);

  return (
    <div className="flex min-h-0 flex-1 bg-white text-zinc-900 dark:bg-[#0a0a0a] dark:text-zinc-100">
        {/* Conversation list */}
        <aside
          className={`w-full shrink-0 overflow-y-auto border-r border-zinc-200 dark:border-zinc-800 md:w-80 lg:w-96 ${
            selected ? "hidden md:block" : "block"
          }`}
        >
          {inbox === null ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          ) : !hasAny ? (
            <EmptyState
              title={t("empty")}
              hint={inboxError ? t("loadError") : t("emptyHint")}
            />
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {inbox.map((group) => (
                <li key={group.projectId}>
                  <p className="px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    {group.projectTitle}
                  </p>
                  <ul>
                    {group.conversations.map((c) => {
                      const name =
                        c.otherDisplayName || c.otherUsername || t("visitor");
                      const active = selected?.id === c.id;
                      const assignLabel =
                        c.assignedUserId && myUserId && c.assignedUserId === myUserId
                          ? "Tú"
                          : c.assigneeName ?? null;
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => setSelected(c)}
                            className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                              active ? "bg-zinc-50 dark:bg-zinc-900" : ""
                            }`}
                          >
                            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[13px] font-semibold uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
                              {initial(name)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-[14px] font-medium">
                                  {name}
                                </span>
                                {c.origin === "ai_handoff" && (
                                  <span
                                    title={t("fromAssistantTitle")}
                                    className="shrink-0 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-violet-600 dark:text-violet-400"
                                  >
                                    ✨ {t("fromAssistant")}
                                  </span>
                                )}
                              </span>
                              <span className="block truncate text-[12px] text-zinc-400 dark:text-zinc-500">
                                @{c.otherUsername}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1">
                              {c.lastMessageAt && (
                                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                                  {formatRelative(c.lastMessageAt, locale)}
                                </span>
                              )}
                              {assignLabel ? (
                                <span className="rounded-full bg-coral-500/10 px-1.5 py-0.5 text-[10px] font-medium text-coral-600 dark:text-coral-400">
                                  {assignLabel}
                                </span>
                              ) : (
                                <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
                                  Libre
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Thread pane */}
        <section
          className={`min-w-0 flex-1 flex-col ${
            selected ? "flex" : "hidden md:flex"
          }`}
        >
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center text-zinc-400 dark:text-zinc-500">
              <MessageSquare size={24} className="mb-3" />
              <p className="text-[13px]">{t("selectPrompt")}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800 sm:px-4">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label={t("back")}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 md:hidden"
                >
                  <ArrowLeft size={18} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[14px] font-semibold">
                    {selected.otherDisplayName ||
                      selected.otherUsername ||
                      t("visitor")}
                    {peerOnline && (
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                        aria-hidden
                      />
                    )}
                  </p>
                  {peerTyping ? (
                    <span className="inline-flex items-center gap-0.5 py-[3px]" aria-label="typing">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
                    </span>
                  ) : (
                    <p className="truncate text-[12px] text-zinc-400 dark:text-zinc-500">
                      @{selected.otherUsername}
                    </p>
                  )}
                </div>
                {/* Assignment control */}
                <AssignmentControl
                  assignment={assignment}
                  myUserId={myUserId}
                  assigning={assigning}
                  onClaim={() => void doAssign({})}
                  onRelease={() => void doAssign({ userId: null })}
                />
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-4">
                {messages === null ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                  </div>
                ) : threadError ? (
                  <p className="py-8 text-center text-[13px] text-zinc-400">
                    {t("loadError")}
                  </p>
                ) : messages.length === 0 ? (
                  <p className="py-8 text-center text-[13px] text-zinc-400">
                    {t("threadEmpty")}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {messages.map((m) => (
                      <li
                        key={m.id}
                        className={`flex ${m.mine ? "flex-col items-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[14px] leading-snug ${
                            m.mine
                              ? "rounded-br-sm bg-coral-500 text-white"
                              : "rounded-bl-sm bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          <span
                            className={`mt-1 block text-[10.5px] ${
                              m.mine ? "text-white/70" : "text-zinc-400 dark:text-zinc-500"
                            }`}
                          >
                            {formatTime(m.createdAt, locale)}
                          </span>
                        </div>
                        {m.mine && lastSeenMsgId === m.id && (
                          <span className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                            ✓✓ Visto
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div ref={threadEndRef} />
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  pingTyping(false);
                  void send();
                }}
                className="flex items-end gap-2 border-t border-zinc-200 px-3 py-2.5 dark:border-zinc-800 sm:px-4"
              >
                <textarea
                  value={draft}
                  onChange={(e) => onDraftChange(e.target.value)}
                  onBlur={() => pingTyping(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      pingTyping(false);
                      void send();
                    }
                  }}
                  rows={1}
                  placeholder={t("placeholder")}
                  className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[14px] outline-none placeholder:text-zinc-400 focus:border-coral-400 dark:border-zinc-700 dark:bg-zinc-900"
                />
                <button
                  type="submit"
                  disabled={sending || draft.trim().length === 0}
                  aria-label={t("send")}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-coral-500 text-white transition hover:bg-coral-600 disabled:opacity-40"
                >
                  {sending ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Send size={18} />
                  )}
                </button>
              </form>
            </>
          )}
        </section>
    </div>
  );
}

function AssignmentControl({
  assignment,
  myUserId,
  assigning,
  onClaim,
  onRelease,
}: {
  assignment: { assignedUserId: string | null; assigneeName: string | null; assignedAt: string | null } | null;
  myUserId: string | null;
  assigning: boolean;
  onClaim: () => void;
  onRelease: () => void;
}) {
  const isMine = !!assignment?.assignedUserId && myUserId === assignment.assignedUserId;
  const isAssigned = !!assignment?.assignedUserId;

  if (!isAssigned) {
    return (
      <button
        type="button"
        onClick={onClaim}
        disabled={assigning}
        className="shrink-0 rounded-lg border border-zinc-200 px-2.5 py-1 text-[12px] font-medium text-zinc-600 transition hover:border-coral-400 hover:text-coral-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400"
      >
        {assigning ? <Loader2 size={12} className="animate-spin" /> : "Atender"}
      </button>
    );
  }

  if (isMine) {
    return (
      <button
        type="button"
        onClick={onRelease}
        disabled={assigning}
        className="shrink-0 rounded-lg border border-coral-200 bg-coral-500/5 px-2.5 py-1 text-[12px] font-medium text-coral-600 transition hover:bg-coral-500/10 disabled:opacity-40 dark:border-coral-800 dark:text-coral-400"
      >
        {assigning ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          "Liberar"
        )}
      </button>
    );
  }

  // Assigned to someone else — show who + a release option
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        {assignment.assigneeName ?? "Otro"}
      </span>
      <button
        type="button"
        onClick={onRelease}
        disabled={assigning}
        title="Liberar conversación"
        className="rounded-lg border border-zinc-200 px-2 py-1 text-[11px] text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400"
      >
        {assigning ? <Loader2 size={11} className="animate-spin" /> : "Liberar"}
      </button>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
        <Inbox size={22} />
      </span>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        {hint}
      </p>
    </div>
  );
}

function initial(name: string): string {
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

function formatTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function formatRelative(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = d.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (abs < hour) return rtf.format(Math.round(diffMs / min), "minute");
  if (abs < day) return rtf.format(Math.round(diffMs / hour), "hour");
  if (abs < 7 * day) return rtf.format(Math.round(diffMs / day), "day");
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}
