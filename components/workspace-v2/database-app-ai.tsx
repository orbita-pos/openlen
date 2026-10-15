"use client";
// THE AI OF THE APPS in the Database view (spec local 2026-10-15, 4.6): what
// the account's apps spent this month against their limit, this project's
// share by environment, and the limit itself. Only the owner gets here (the
// API answers 403 to members and the tab doesn't show).

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import type { AppAiOverview } from "@/lib/app-ai/overview";
import { CENTICREDITOS_POR_CREDITO, formatCredits } from "@/lib/credits-client";

export function AppAiTab({ projectId, overview, onChange }: { projectId: string; overview: AppAiOverview; onChange(next: AppAiOverview): void }) {
  const t = useTranslations("wsChrome.database.ai");
  const locale = useLocale();
  const [draft, setDraft] = useState(String(overview.capCenticredits / CENTICREDITOS_POR_CREDITO));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const { capCenticredits: cap, spentCenticredits: spent } = overview;
  const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 100;
  const bar = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-coral-500";

  async function save(capCredits: number | null) {
    setSaving(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/projects/${projectId}/app-ai`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capCredits }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = (await res.json()) as AppAiOverview;
      onChange(next);
      setDraft(String(next.capCenticredits / CENTICREDITOS_POR_CREDITO));
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5">
      <div className="max-w-xl">
        <div className="flex items-baseline justify-between text-[12.5px]">
          <span>{t("account", { spent: formatCredits(spent), cap: formatCredits(cap) })}</span>
          <span className="tabular-nums text-zinc-500">{pct}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t("accountLabel")}
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900"
        >
          <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-[12px] text-zinc-500">{cap === 0 ? t("off") : t("accountNote")}</p>
      </div>

      <h2 className="mb-2 mt-6 text-[13px] font-semibold">{t("thisProject")}</h2>
      <ul className="max-w-xl divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
        {(["draft", "live"] as const).map((env) => (
          <li key={env} className="flex items-center justify-between px-3 py-2 text-[12.5px]">
            <span>{t(env)}</span>
            <span className="tabular-nums text-zinc-500">
              {t("usage", { credits: formatCredits(overview.project[env].centicredits), calls: overview.project[env].calls.toLocaleString(locale) })}
            </span>
          </li>
        ))}
      </ul>

      <form
        className="mt-6 max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          // An empty field is not a 0: saving it would turn the AI of every app off.
          const n = draft.trim() === "" ? Number.NaN : Number(draft);
          if (Number.isInteger(n) && n >= 0) void save(n);
          else setFailed(true);
        }}
      >
        <label htmlFor="app-ai-cap" className="block text-[12.5px] font-medium">
          {t("capLabel")}
        </label>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <input
            id="app-ai-cap"
            type="number"
            min={0}
            max={overview.allotmentCenticredits / CENTICREDITOS_POR_CREDITO}
            step={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-28 rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-[13px] dark:border-zinc-800"
          />
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-coral-500 px-3 py-1 text-[12.5px] font-medium text-white hover:bg-coral-600 disabled:opacity-60"
          >
            {saving ? t("saving") : t("save")}
          </button>
          {overview.explicit && (
            <button type="button" disabled={saving} onClick={() => void save(null)} className="text-[12.5px] font-medium text-coral-600 hover:underline disabled:opacity-60">
              {t("useDefault")}
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[12px] text-zinc-500">
          {t("capHint", { credits: formatCredits(overview.defaultCapCenticredits), max: formatCredits(overview.allotmentCenticredits) })}
        </p>
        {failed && (
          <p role="alert" className="mt-2 text-[12px] text-red-600 dark:text-red-400">
            {t("saveError")}
          </p>
        )}
      </form>
    </div>
  );
}
