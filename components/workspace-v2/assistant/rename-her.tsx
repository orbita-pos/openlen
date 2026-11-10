"use client";

// RENAMING HER FROM HER PLACE (spec local 2026-11-06-asistente-propio, §6.8, phase 4D): as Claude Code's /rename, the
// owner changes her name and her address follows it; the old address redirects (app/[locale]/assistant/[name]/page.tsx).
// Her bubble on a published page keeps the name it was baked with until that page's next publish: it says so.
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

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
  const ghost = "rounded-full border bd px-2.5 py-1 text-[11.5px] font-medium fg-muted hover:fg disabled:opacity-50";

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

  if (!editing) {
    return (
      <button type="button" data-rename-open="" onClick={() => (setEditing(true), setValue(name))} className={ghost}>
        {t("ownAssistant.place.rename")}
      </button>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-rename="">
      <input
        data-rename-input=""
        aria-label={t("ownAssistant.place.rename")}
        value={value}
        maxLength={40}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => (e.key === "Enter" ? void save() : e.key === "Escape" ? setEditing(false) : undefined)}
        className="min-w-0 rounded-md border bd bg-elev px-2 py-1 text-[12.5px] fg"
      />
      <button type="button" data-rename-save="" disabled={busy || !value.trim()} onClick={() => void save()} className={ghost}>
        {t("ownAssistant.place.renameSave")}
      </button>
      <button type="button" onClick={() => (setEditing(false), setError(null))} className="text-[11.5px] fg-muted hover:fg">
        {t("ownAssistant.place.renameCancel")}
      </button>
      {onPage && <p className="w-full text-[11.5px] fg-faint">{t("ownAssistant.place.renamePublish")}</p>}
      {error && (
        <p role="alert" className="w-full text-[12px] nc-bad">
          {t(error)}
        </p>
      )}
    </div>
  );
}
