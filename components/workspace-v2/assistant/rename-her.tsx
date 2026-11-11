"use client";

// RENAMING HER FROM HER PLACE (spec local 2026-11-06-asistente-propio, §6.8, phase 4D): as Claude Code's /rename, the
// owner changes her name and her address follows it; the old address redirects (app/[locale]/assistant/[name]/page.tsx).
// Her bubble on a published page keeps the name it was baked with until that page's next publish: it says so.
import { Pencil } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { HER_PRIMARY, HER_QUIET, HER_ROW, HerSheet } from "./her-sheet";

export function RenameHer({
  assistantId,
  name,
  onPage,
  leave = (href: string) => window.location.assign(href),
}: {
  assistantId: string;
  name: string;
  /** Her bubble is on her home's page: a publish shows the new name there. */
  onPage: boolean;
  /** Where the page goes after renaming her (tests watch it). */
  leave?: (href: string) => void;
}) {
  const t = useTranslations("panelsChat");
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/assistants/${encodeURIComponent(assistantId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: value }),
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as { slug?: string; error?: string };
    setBusy(false);
    if (res?.ok && body.slug) return leave(`/${locale}/assistant/${body.slug}`);
    setError(body.error === "name_taken" ? "ownAssistant.errors.nameTaken" : body.error === "invalid" ? "ownAssistant.errors.name" : "ownAssistant.place.renameFailed");
  };

  const close = () => (setEditing(false), setError(null));
  return (
    <>
      <button type="button" data-rename-open="" onClick={() => (setEditing(true), setValue(name))} className={HER_ROW}>
        <Pencil size={15} strokeWidth={1.8} className="shrink-0 fg-muted" aria-hidden="true" />
        {t("ownAssistant.place.rename")}
      </button>
      <HerSheet open={editing} onClose={close} titleId="rename-her-title" title={t("ownAssistant.place.rename")} note={onPage ? t("ownAssistant.place.renamePublish") : undefined} dismissable={!busy}>
        <div className="flex flex-col gap-3" data-rename="">
          <input
            data-rename-input=""
            aria-label={t("ownAssistant.place.rename")}
            autoFocus
            value={value}
            maxLength={40}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => (e.key === "Enter" && value.trim() && !busy ? void save() : undefined)}
            className="her-ring h-10 w-full rounded-[10px] border bd bg-side px-3 text-center text-[15px] font-medium fg"
          />
          {error && (
            <p role="alert" className="text-center text-[12px] nc-bad">
              {t(error)}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={close} className={HER_QUIET}>
              {t("ownAssistant.place.renameCancel")}
            </button>
            <button type="button" data-rename-save="" disabled={busy || !value.trim()} onClick={() => void save()} className={HER_PRIMARY}>
              {t("ownAssistant.place.renameSave")}
            </button>
          </div>
        </div>
      </HerSheet>
    </>
  );
}
