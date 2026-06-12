// Módulos — the one-click backend modules hub. Top: compact cards (Miembros
// configurable inline; the rest jump to their existing surfaces). Below,
// when Miembros is on: invite + member list, mirroring the leads panel's
// fetch/skeleton/empty patterns. Deterministic features, zero credits.

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { MembersSettings } from "@/lib/projects/types";
import {
  BarChart3,
  Inbox,
  Loader,
  LockIcon,
  Sparkles,
  Trash,
  Users,
} from "../icons";

interface MemberItem {
  id: string;
  email: string;
  name: string | null;
  status: "active" | "invited";
  createdAt: string;
  lastLoginAt: string | null;
}

interface ModulesPanelProps {
  currentProjectId?: string | null;
  membersSettings?: MembersSettings;
  /** How many pages currently carry the members-only flag. */
  gatedCount: number;
  /** PATCH settings.members; resolves false on failure (panel reverts). */
  onUpdateMembers?: (patch: MembersSettings) => Promise<boolean>;
  onShowLeads?: () => void;
  onShowAnalytics?: () => void;
  onShowAssistant?: () => void;
}

export function ModulesPanel({
  currentProjectId,
  membersSettings,
  gatedCount,
  onUpdateMembers,
  onShowLeads,
  onShowAnalytics,
  onShowAssistant,
}: ModulesPanelProps) {
  const t = useTranslations("members");
  const enabled = membersSettings?.enabled === true;
  const mode = membersSettings?.mode === "invite" ? "invite" : "open";
  const [busy, setBusy] = useState(false);

  if (!currentProjectId) {
    return (
      <div className="h-full flex items-center justify-center px-6 py-8 text-center">
        <div className="max-w-[220px]">
          <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev fg-faint">
            <Users size={14} />
          </div>
          <p className="text-[11.5px] fg-muted leading-relaxed">{t("perProject")}</p>
        </div>
      </div>
    );
  }

  const setEnabled = async (next: boolean) => {
    if (busy || !onUpdateMembers) return;
    setBusy(true);
    await onUpdateMembers({ enabled: next });
    setBusy(false);
  };
  const setMode = async (next: "open" | "invite") => {
    if (busy || !onUpdateMembers || next === mode) return;
    setBusy(true);
    await onUpdateMembers({ mode: next });
    setBusy(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-1.5 shrink-0">
        <div className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
          {t("title")}
        </div>
        <div className="text-[11px] fg-faint mt-0.5">{t("subtitle")}</div>
      </div>

      <div className="flex-1 overflow-y-auto nice-scroll px-3 pb-3 space-y-2">
        {/* Miembros — the live module, configured inline. */}
        <div className="rounded-lg ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] p-2.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-elev ring-1 ring-[color:var(--border)] text-accent">
              <Users size={13} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold fg leading-tight">
                {t("module.title")}
              </div>
              <div className="text-[10.5px] fg-faint leading-snug">
                {t("module.tagline")}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={t("module.toggle")}
              disabled={busy}
              onClick={() => void setEnabled(!enabled)}
              className={`relative h-[18px] w-[32px] shrink-0 rounded-full transition ${
                enabled ? "bg-[var(--accent-strong)]" : "bg-zinc-300 dark:bg-zinc-700"
              } disabled:opacity-50`}
            >
              <span
                className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all ${
                  enabled ? "left-[16px]" : "left-[2px]"
                }`}
              />
            </button>
          </div>

          {enabled && (
            <div className="mt-2.5 space-y-2 fade-in">
              <div className="flex rounded-md bg-elev ring-1 ring-[color:var(--border)] p-0.5">
                {(["open", "invite"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={busy}
                    onClick={() => void setMode(m)}
                    className={`flex-1 h-6 rounded text-[10.5px] font-medium transition ${
                      mode === m
                        ? "bg-[color:var(--bg)] fg shadow-card"
                        : "fg-faint hover:fg"
                    }`}
                  >
                    {t(`module.mode.${m}`)}
                  </button>
                ))}
              </div>
              <p className="text-[10.5px] fg-faint leading-relaxed">
                {t(`module.mode.${mode}Hint`)}
              </p>
              <p className="text-[10.5px] leading-relaxed fg-muted inline-flex items-start gap-1.5">
                <LockIcon size={11} className="mt-[1px] shrink-0" />
                <span>
                  {gatedCount > 0
                    ? t("module.gatedCount", { count: gatedCount })
                    : t("module.gatedNone")}
                </span>
              </p>
            </div>
          )}
        </div>

        {enabled && <MembersList projectId={currentProjectId} />}

        {/* Already-built capabilities — one click to their surfaces. */}
        <div className="pt-1">
          <div className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small px-0.5 pb-1.5">
            {t("included.title")}
          </div>
          <div className="space-y-1.5">
            <ModuleCard
              icon={<Inbox size={13} />}
              title={t("included.forms")}
              hint={t("included.formsHint")}
              onOpen={onShowLeads}
              openLabel={t("included.open")}
            />
            <ModuleCard
              icon={<BarChart3 size={13} />}
              title={t("included.analytics")}
              hint={t("included.analyticsHint")}
              onOpen={onShowAnalytics}
              openLabel={t("included.open")}
            />
            <ModuleCard
              icon={<Sparkles size={13} />}
              title={t("included.assistant")}
              hint={t("included.assistantHint")}
              onOpen={onShowAssistant}
              openLabel={t("included.open")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ModuleCard({
  icon,
  title,
  hint,
  onOpen,
  openLabel,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onOpen?: () => void;
  openLabel: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] px-2.5 py-2">
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-elev ring-1 ring-[color:var(--border)] fg-muted">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-medium fg leading-tight">{title}</div>
        <div className="text-[10px] fg-faint leading-snug truncate">{hint}</div>
      </div>
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 h-6 px-2 rounded-md text-[10.5px] font-medium fg-muted hover:fg bg-elev ring-1 ring-[color:var(--border)] hover:bg-hover transition"
        >
          {openLabel}
        </button>
      )}
    </div>
  );
}

function MembersList({ projectId }: { projectId: string }) {
  const t = useTranslations("members");
  const [items, setItems] = useState<MemberItem[] | null>(null);
  const [count, setCount] = useState(0);
  const [cap, setCap] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = () => {
    setError(null);
    void fetch(`/api/projects/${projectId}/members`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ members: MemberItem[]; count: number; cap: number }>;
      })
      .then((d) => {
        setItems(d.members);
        setCount(d.count);
        setCap(d.cap);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t("list.loadError"));
        setItems([]);
      });
  };

  useEffect(() => {
    setItems(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const invite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || inviting) return;
    setInviting(true);
    setInviteMsg(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (r.status === 409) setInviteMsg(t("invite.duplicate"));
      else if (r.status === 402) setInviteMsg(t("invite.cap"));
      else if (!r.ok) setInviteMsg(t("invite.error"));
      else {
        setInviteEmail("");
        const d = (await r.json()) as { emailed?: boolean };
        setInviteMsg(d.emailed ? t("invite.sentEmailed") : t("invite.sent"));
        load();
      }
    } catch {
      setInviteMsg(t("invite.error"));
    }
    setInviting(false);
  };

  const remove = async (memberId: string) => {
    setRemoving(memberId);
    try {
      const r = await fetch(`/api/projects/${projectId}/members/${memberId}`, {
        method: "DELETE",
      });
      if (r.ok) load();
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="rounded-lg ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] p-2.5">
      <div className="flex items-center justify-between pb-2">
        <span className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
          {t("list.title")}
        </span>
        {cap > 0 && (
          <span className="text-[10px] fg-faint tabular">
            {count}/{cap}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 pb-1">
        <input
          value={inviteEmail}
          onChange={(e) => {
            setInviteEmail(e.target.value);
            setInviteMsg(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void invite();
          }}
          type="email"
          placeholder={t("invite.placeholder")}
          className="flex-1 min-w-0 bg-app border bd rounded px-2 h-7 text-[11.5px] fg outline-none focus:border-[color:var(--accent)]"
        />
        <button
          type="button"
          disabled={inviting || !inviteEmail.trim()}
          onClick={() => void invite()}
          className="shrink-0 h-7 px-2.5 rounded-md bg-[var(--accent-strong)] text-white text-[11px] font-medium hover:brightness-105 transition disabled:opacity-50 inline-flex items-center gap-1"
        >
          {inviting && <Loader size={10} className="animate-spin" />}
          {t("invite.cta")}
        </button>
      </div>
      {inviteMsg && (
        <div className="pb-1.5 text-[10.5px] fg-muted leading-snug">{inviteMsg}</div>
      )}
      {error && (
        <div className="mb-1.5 rounded-md ring-1 ring-red-500/40 bg-red-500/5 px-2 py-1.5 text-[10.5px] text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {items === null && (
        <div className="space-y-1.5 pt-1">
          {[0, 1].map((i) => (
            <div key={i} className="h-8 rounded-md bg-zinc-200/60 dark:bg-zinc-800/50 animate-pulse" />
          ))}
        </div>
      )}
      {items !== null && items.length === 0 && !error && (
        <p className="pt-1 text-[10.5px] fg-faint leading-relaxed">{t("list.empty")}</p>
      )}
      {items !== null && items.length > 0 && (
        <ul className="pt-1 space-y-1">
          {items.map((m) => (
            <li
              key={m.id}
              className="group flex items-center gap-2 rounded-md px-1.5 h-8 hover:bg-hover transition"
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  m.status === "active" ? "bg-emerald-500" : "bg-zinc-400 dark:bg-zinc-600"
                }`}
                title={t(`list.status.${m.status}`)}
              />
              <span className="flex-1 min-w-0 text-[11.5px] fg truncate">{m.email}</span>
              <span className="text-[9.5px] fg-faint ui-small shrink-0 hidden group-hover:hidden sm:inline">
                {m.status === "invited" ? t("list.status.invited") : ""}
              </span>
              <button
                type="button"
                disabled={removing === m.id}
                aria-label={t("list.remove", { email: m.email })}
                title={t("list.remove", { email: m.email })}
                onClick={() => void remove(m.id)}
                className="h-6 w-6 hidden group-hover:inline-flex items-center justify-center rounded fg-faint hover:text-red-500 hover:bg-hover transition disabled:opacity-50 shrink-0"
              >
                {removing === m.id ? (
                  <Loader size={10} className="animate-spin" />
                ) : (
                  <Trash size={10} />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
