"use client";

/**
 * LEN'S SUBAGENTS IN THE CHAT (spec local 2026-11-01-subagentes-de-len, §4.8): a card per child the turn
 * launched, in place of its launch step, as Claude Code shows an agent's block in the conversation. Closed, its
 * description, its type, how it goes and its steps so far; open, those steps and what it told Len. Its ■ stops
 * that one child (the turn's ■ doesn't). Live from the stream while the turn is open, and re-read every 3 s
 * while one still runs — after a reload too.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Bot, ChevronRight, Square } from "lucide-react";

import { SUBAGENT_CARD_TOOLS, subagentRefFrom } from "@/lib/agent/subagents/card";
import { SEND_MESSAGE_TOOL, SUBAGENT_FORK_TOOL } from "@/lib/agent/subagents/enabled";

import { AgentActionCard, type AgentAction } from "../agent-action-card";
import { subagentsLive, type SubagentRunView } from "./subagents-live";

const REREAD_MS = 3_000;

export function SubagentCard({ run, forked = false, onStop }: { run: SubagentRunView; forked?: boolean; onStop(id: string): void }) {
  const t = useTranslations("panelsChat");
  const [open, setOpen] = useState(false);
  const running = run.status === "running";
  return (
    <div className="nc-up rounded-lg border bd bg-elev text-[12.5px]" data-subagent-card={run.id}>
      <div className="flex items-center gap-2 py-2 pl-2.5 pr-1.5">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronRight size={13} className={`shrink-0 fg-faint transition-transform ${open ? "rotate-90" : ""}`} />
          <Bot size={15} className="shrink-0 text-[var(--nc-accent-text)]" />
          <span className="min-w-0 truncate font-medium fg">{t("subagent.title", { description: run.description })}</span>
          {(forked || run.forked) && (
            <span className="shrink-0 rounded-full border bd px-1.5 py-px text-[10.5px] fg-muted" data-subagent-forked="">
              {t("subagent.forked")}
            </span>
          )}
          {run.preset !== "general-purpose" && (
            <span className="shrink-0 rounded-full border bd px-1.5 py-px text-[10.5px] fg-muted" data-subagent-preset="">
              {run.preset}
            </span>
          )}
        </button>
        {run.toolUses > 0 && <span className="shrink-0 text-[11px] tabular-nums fg-faint">{t("subagent.steps", { n: run.toolUses })}</span>}
        <span className={`shrink-0 text-[11px] ${running ? "nc-shimmer fg-muted" : "fg-faint"}`} data-subagent-status={run.status}>
          {t(`subagent.status.${run.status}`)}
        </span>
        {running && (
          <button
            type="button"
            onClick={() => onStop(run.id)}
            aria-label={t("subagent.stop")}
            title={t("subagent.stop")}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full border bd-strong fg-muted hover:border-[color:var(--accent-ring)] hover:text-[var(--nc-accent-text)]"
          >
            <Square size={8} className="fill-current" />
          </button>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-1.5 border-t bd px-2.5 py-2">
          {run.actions.map((a, i) => (
            <AgentActionCard key={i} action={a} />
          ))}
          {run.finalText && (
            <details>
              <summary className="cursor-pointer text-[11.5px] font-medium fg-muted">{t("subagent.closing")}</summary>
              <div className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed fg">{run.finalText}</div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/** The turn's launches, forks and the children it woke, each with its card. `rowId` is the turn's row, where the
 *  server keeps what it launched; a woken child hangs from an earlier row, so it is read by id. */
export function SubagentCards({ actions, projectId, rowId }: { actions: readonly AgentAction[] | undefined; projectId: string; rowId: string }) {
  const launched = useMemo(() => {
    // One card per run: a turn that launched a child and then woke it, or woke it twice, shows it once.
    const byId = new Map<string, { id: string; preset: string; description: string; forked: boolean; woken: boolean }>();
    for (const a of actions ?? []) {
      if (!SUBAGENT_CARD_TOOLS.has(a.tool) || !a.subagent) continue;
      const l = { ...a.subagent, description: a.summary, forked: a.tool === SUBAGENT_FORK_TOOL, woken: a.tool === SEND_MESSAGE_TOOL };
      const prev = byId.get(l.id);
      byId.set(l.id, prev ? { ...prev, forked: prev.forked || l.forked, woken: prev.woken && l.woken } : l);
    }
    return [...byId.values()];
  }, [actions]);
  const runs = useSyncExternalStore(subagentsLive.subscribe, subagentsLive.snapshot, subagentsLive.snapshot);
  const ids = launched.map((l) => l.id).join(",");
  const woken = [...new Set(launched.filter((l) => l.woken).map((l) => l.id))].join(",");
  useEffect(() => {
    if (!ids) return;
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const query = `project=${encodeURIComponent(projectId)}&row=${encodeURIComponent(rowId)}${woken ? `&ids=${encodeURIComponent(woken)}` : ""}`;
        const res = await fetch(`/api/agent/subagents?${query}`, { cache: "no-store" });
        if (res.ok) subagentsLive.fromServer(projectId, ((await res.json()) as { runs?: unknown }).runs);
      } catch {
        // The next read tries again.
      }
      if (gone) return;
      const all = subagentsLive.snapshot();
      if (ids.split(",").some((id) => (all.get(id)?.status ?? "running") === "running")) timer = setTimeout(() => void read(), REREAD_MS);
    };
    void read();
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [ids, woken, projectId, rowId]);
  if (launched.length === 0) return null;
  const stop = (id: string) => void fetch(`/api/agent/subagents/${encodeURIComponent(id)}/stop`, { method: "POST" }).catch(() => undefined);
  return (
    <div className="flex flex-col gap-1.5">
      {launched.map((l) => {
        const ref = subagentRefFrom(l);
        if (!ref) return null;
        const run = runs.get(ref.id) ?? {
          id: ref.id,
          projectId,
          preset: ref.preset,
          description: l.description,
          status: "running" as const,
          actions: [],
          finalText: null,
          toolUses: 0,
          durationMs: null,
        };
        return <SubagentCard key={ref.id} run={run} forked={l.forked} onStop={stop} />;
      })}
    </div>
  );
}
