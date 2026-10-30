"use client";

// LEN WATCH'S SWITCHES in Publish (spec local 2026-10-30-len-watch, §4): watch and notify (on for
// everyone), fix on its own and publish on its own (the owner turns them on; they spend the owner's
// credits). Only shown for a published project.
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { useLenWatch } from "./use-len-watch";
import { patchFor, settingsRows, type SettingKey } from "./view-model";

export function LenWatchSettings({ projectId }: { projectId: string }) {
  const t = useTranslations("modalsDeploy");
  const locale = useLocale();
  const { status, setStatus } = useLenWatch(projectId);
  const [saving, setSaving] = useState(false);
  if (!status?.enabled) return null;

  const label: Record<SettingKey, { name: string; hint: string | null }> = {
    watch: { name: t("lenWatch.watch"), hint: null },
    autoFix: { name: t("lenWatch.autoFix"), hint: t("lenWatch.autoFixHint") },
    autoPublish: { name: t("lenWatch.autoPublish"), hint: t("lenWatch.autoPublishHint") },
  };

  const change = async (key: SettingKey, checked: boolean) => {
    setSaving(true);
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/len-watch`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...patchFor(key, checked), locale }),
    }).catch(() => null);
    setSaving(false);
    if (r?.ok) setStatus({ ...status, settings: ((await r.json()) as { settings: typeof status.settings }).settings });
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg ring-1 ring-zinc-200 dark:ring-white/10 px-3 py-2.5" data-len-watch-settings="">
      <div className="text-[12.5px] font-semibold">{t("lenWatch.title")}</div>
      <div className="text-[11.5px] text-zinc-500 leading-relaxed">{t("lenWatch.intro")}</div>
      {settingsRows(status.settings, status.isOwner).map((row) => (
        <label key={row.key} className={`flex items-start gap-2 text-[12px] ${row.disabled ? "opacity-60" : "cursor-pointer"}`}>
          <input type="checkbox" className="mt-0.5" checked={row.checked} disabled={row.disabled || saving} onChange={(e) => void change(row.key, e.currentTarget.checked)} />
          <span>
            {label[row.key].name}
            {label[row.key].hint && <span className="block text-[11px] text-zinc-500">{label[row.key].hint}</span>}
          </span>
        </label>
      ))}
      {!status.isOwner && <div className="text-[11px] text-zinc-500">{t("lenWatch.ownerOnly")}</div>}
    </div>
  );
}
