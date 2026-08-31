// Page Coach — the P3 product surface. Renders ONE funnel-derived, one-tap
// improvement at the top of the Insights tab; the raw funnel bar sits below as
// a secondary, honestly-labeled view. "Apply with AI" hands a localized
// instruction to the parent, which loads it into the Chat composer and switches
// to the Chat tab — reusing the entire ai-design flow (stream + undo + persist).

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LenMark, Wand, X } from "../icons";
import { getCoachTip, isActionable } from "@/lib/analytics/coach";
import type { Funnel } from "@/lib/analytics/queries";

export function PageCoach({
  funnel,
  onApplyTip,
}: {
  funnel: Funnel;
  onApplyTip?: (instruction: string) => void;
}) {
  const t = useTranslations("panelsB");
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const tip = getCoachTip(funnel);
  const action = isActionable(tip);
  const message = t(`coach.tip.${tip.id}`, tip.params);

  const toneRing =
    tip.tone === "action"
      ? "ring-[color:var(--accent)]/30 bg-accent-soft"
      : "bd bg-elev";

  return (
    <div className={`rounded-md ring-1 ${toneRing} p-2.5`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${
            tip.tone === "action" ? "text-accent" : "fg-faint"
          }`}
        >
          <LenMark size={12} />
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] font-semibold ui-small fg-muted">
          {t("coach.title")}
        </span>
      </div>
      <p className="text-[12px] fg leading-relaxed">{message}</p>
      {action && onApplyTip && (
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              onApplyTip(t(`coach.instruction.${tip.id}`));
              setDismissed(true);
            }}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11.5px] font-medium bg-[var(--accent-strong)] text-white shadow-coral hover:brightness-105 transition"
          >
            <Wand size={12} />
            <span>{t("coach.apply")}</span>
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] fg-faint hover:fg hover:bg-hover transition"
          >
            <X size={11} />
            <span>{t("coach.dismiss")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

const STAGES = ["saw", "clicked", "submitted", "booked"] as const;

export function FunnelBar({ funnel }: { funnel: Funnel }) {
  const t = useTranslations("panelsB");
  const max = Math.max(1, funnel.saw);
  const untracked = funnel.untrackedLeads + funnel.untrackedBookings;
  return (
    <div className="rounded-md border bd bg-elev p-2">
      <div className="text-[9.5px] uppercase tracking-[0.14em] fg-faint font-semibold ui-small mb-1.5 px-1">
        {t("coach.funnel.title")}
      </div>
      <ul className="space-y-1">
        {STAGES.map((key) => {
          const n = funnel[key];
          // booked/submitted come from different tables and can exceed saw —
          // clamp so a later stage never renders a wider-than-100% bar.
          const pct = Math.min(100, Math.round((n / max) * 100));
          return (
            <li key={key} className="flex items-center gap-2 px-1">
              <span className="w-[68px] shrink-0 text-[11px] fg-muted truncate">
                {t(`coach.funnel.${key}`)}
              </span>
              <span
                className="flex-1 h-2 rounded-full bg-app overflow-hidden"
                aria-hidden
              >
                <span
                  className="block h-full rounded-full bg-[color:var(--accent)]/70"
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="shrink-0 min-w-[34px] text-right text-[11.5px] fg font-semibold tabular-nums">
                {n.toLocaleString()}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-1.5 px-1 text-[9.5px] fg-faint leading-relaxed">
        {t("coach.funnel.approx")}
        {untracked > 0 && ` · ${t("coach.funnel.untracked", { count: untracked })}`}
      </div>
    </div>
  );
}
