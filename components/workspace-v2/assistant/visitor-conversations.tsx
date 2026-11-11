"use client";

// HER CONVERSATIONS WITH VISITORS (spec local 2026-11-06-asistente-propio, §4.6.2 «Conversaciones», §6.2, §6.5; phase
// 2A): what the page's visitors said and what she answered, newest first — with her visuals (phase 2B) —, and what they
// may spend this month.
import { Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { VisualFrame } from "../chat/visual-frame";
import { HER_PRIMARY, HER_QUIET } from "./her-sheet";

interface Line {
  role: "visitor" | "assistant";
  text: string;
  at: string;
  visuals?: { title: string | null; code: string }[];
}
interface Visit {
  id: string;
  /** Which of her projects it came from (phase 4). */
  projectId?: string;
  projectTitle?: string | null;
  lastAt: string;
  messageCount: number;
  handedOff: boolean;
  lines: Line[];
}
interface Budget {
  spent: number;
  cap: number;
  explicit: number | null;
  /** The plan's allotment: the highest cap, in centicredits. */
  max: number;
}

export function VisitorConversations({ assistantId, name }: { assistantId: string; name: string }) {
  const t = useTranslations("panelsChat");
  const locale = useLocale();
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [budgetError, setBudgetError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/assistants/${assistantId}/visits`)
      .then((r) => (r.ok ? (r.json() as Promise<{ visits: Visit[] }>) : Promise.reject(r.status)))
      .then((b) => {
        if (!live) return;
        setVisits(b.visits);
        // Phase 4E: this list mounts the first time Conversaciones is shown, so what it got is what her owner saw — read,
        // as the page's inbox marks it. Best effort: a failed mark only leaves them unread for `list_messages`.
        // Each up to the last line it showed (final review I1).
        const seen = b.visits.slice(0, 50).map((v) => ({ id: v.id, lastAt: v.lastAt }));
        if (seen.length)
          void fetch(`/api/assistants/${assistantId}/visits/read`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seen }) }).catch(() => {});
      })
      .catch(() => live && setFailed(true));
    fetch("/api/assistants/visitor-budget")
      .then((r) => (r.ok ? (r.json() as Promise<Budget>) : null))
      .then((b) => live && b && setBudget(b))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [assistantId]);

  // Several projects among them: each says which one it came from (phase 4).
  const several = new Set((visits ?? []).map((v) => v.projectId).filter(Boolean)).size > 1;

  /** Centicredits as credits, in the reader's language. */
  const credits = (centis: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(centis / 100);

  const save = async () => {
    if (!budget) return;
    const value = draft.trim() === "" ? null : Math.round(Number(draft) * 100);
    // Out of range says what it can be, instead of doing nothing.
    const range = t("ownAssistant.place.budgetRange", { max: credits(budget.max) });
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > budget.max)) {
      setBudgetError(range);
      return;
    }
    const res = await fetch("/api/assistants/visitor-budget", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ cap: value }) }).catch(() => null);
    if (!res?.ok) {
      setBudgetError(res?.status === 400 ? range : t("ownAssistant.place.budgetError"));
      return;
    }
    setBudgetError(null);
    setEditing(false);
    const fresh = await fetch("/api/assistants/visitor-budget").then((r) => (r.ok ? (r.json() as Promise<Budget>) : null)).catch(() => null);
    if (fresh) setBudget(fresh);
  };

  return (
    <div className="nice-scroll min-h-0 flex-1 overflow-y-auto" data-visitor-conversations="">
     <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4 px-5 pb-10 pt-9">
      <h1 className="text-[22px] font-semibold tracking-tight fg">{t("ownAssistant.place.conversations")}</h1>
      {budget && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border bd bg-elev px-4 py-3 text-[12.5px] fg-muted" data-visitor-budget="">
          <div className="min-w-0 flex-1 basis-56">
            <span>{t("ownAssistant.place.budget", { spent: credits(budget.spent), cap: credits(budget.cap) })}</span>
            {/* How much of the month's cap her visitors have used. */}
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden="true">
              <div className="her-on h-full rounded-full" style={{ width: `${budget.cap > 0 ? Math.min(100, Math.round((budget.spent / budget.cap) * 100)) : 0}%` }} />
            </div>
          </div>
          {editing ? (
            <>
              <label className="sr-only" htmlFor="visitor-cap">
                {t("ownAssistant.place.budgetLabel")}
              </label>
              <input
                id="visitor-cap"
                type="number"
                min={0}
                max={budget.max / 100}
                step="1"
                aria-invalid={budgetError !== null}
                aria-describedby={budgetError ? "visitor-cap-error" : undefined}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="her-ring h-8 w-24 rounded-[8px] border bd bg-side px-2.5 text-[13px] fg"
                placeholder={credits(budget.cap)}
              />
              <button type="button" onClick={() => void save()} className={HER_PRIMARY.replace("h-9", "h-8")}>
                {t("ownAssistant.place.budgetSave")}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => (setDraft(budget.explicit === null ? "" : String(budget.explicit / 100)), setEditing(true))} className={HER_QUIET.replace("h-9", "h-8")}>
              {t("ownAssistant.place.budgetChange")}
            </button>
          )}
          {editing && budgetError && (
            <span id="visitor-cap-error" role="alert" className="basis-full text-[12px] text-[var(--nc-danger,#c2410c)]">
              {budgetError}
            </span>
          )}
        </div>
      )}
      {failed && <p className="py-10 text-center text-[13px] fg-muted">{t("ownAssistant.place.loadError")}</p>}
      {visits && visits.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="her-wash flex h-12 w-12 items-center justify-center rounded-full fg-muted" aria-hidden="true">
            <Users size={20} strokeWidth={1.7} />
          </span>
          <p className="max-w-[320px] text-[13.5px] leading-relaxed fg-muted">{t("ownAssistant.place.empty", { name })}</p>
        </div>
      )}
      {visits?.map((v) => (
        <article key={v.id} className="rounded-[16px] border bd bg-elev p-4" data-visit="">
          <header className="mb-3 flex flex-wrap items-center gap-2 text-[11.5px] fg-faint">
            <time dateTime={v.lastAt}>{new Date(v.lastAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}</time>
            <span>· {t("ownAssistant.place.messages", { count: v.messageCount })}</span>
            {several && v.projectTitle && <span>· {t("ownAssistant.place.inProject", { project: v.projectTitle })}</span>}
            {v.handedOff && <span className="rounded-full bg-hover px-2 py-0.5 fg-muted">{t("ownAssistant.place.handedOff")}</span>}
          </header>
          <div className="flex flex-col gap-2">
            {v.lines.map((l, i) => (
              <div key={i} className={`flex max-w-[85%] flex-col ${l.role === "visitor" ? "items-end self-end" : "w-full items-start self-start"}`}>
                {l.text && (
                  <p className={`whitespace-pre-wrap px-3 py-2 text-[13.5px] leading-relaxed fg ${l.role === "visitor" ? "rounded-[16px_16px_4px_16px] bg-hover" : "rounded-[16px_16px_16px_4px] bg-side"}`}>
                    <span className="sr-only">{l.role === "visitor" ? t("ownAssistant.place.visitor") : name}: </span>
                    {l.text}
                  </p>
                )}
                {/* Her visuals, as the visitor saw them (phase 2B): isolated — a visitor could steer this code, so it
                    never runs on the visuals origin next to the owner's own. The owner only looks: no sendPrompt. */}
                {l.visuals?.map((vis, j) => (
                  <VisualFrame key={j} widget={{ title: vis.title, loadingMessages: [], code: vis.code }} final isolated />
                ))}
              </div>
            ))}
          </div>
        </article>
      ))}
     </div>
    </div>
  );
}
