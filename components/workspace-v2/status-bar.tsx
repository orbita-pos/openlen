// Bottom status bar — real publish/save state on the left, saving pill +
// ⌘K hint on the right. The Session 12-era mock activity rotation is gone;
// callers now pass `published` + `lastSavedAt` and we render a single,
// honest line based on the current project state.

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Cloud, CloudCheck, Globe } from "./icons";
import { StatusDot } from "./ui";
import { publishedHost } from "@/lib/publish/base-host";

interface StatusBarProps {
  saving: boolean;
  published?: { subdomain: string; hasUnpublishedChanges: boolean } | null;
  lastSavedAt?: Date | null;
}

function fmtAgo(
  seconds: number,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (seconds < 5) return t("status.ago.justNow");
  if (seconds < 60) return t("status.ago.seconds", { count: seconds });
  if (seconds < 3600)
    return t("status.ago.minutes", { count: Math.floor(seconds / 60) });
  if (seconds < 86400)
    return t("status.ago.hours", { count: Math.floor(seconds / 3600) });
  return t("status.ago.days", { count: Math.floor(seconds / 86400) });
}

export function StatusBar({ saving, published, lastSavedAt }: StatusBarProps) {
  const t = useTranslations("wsChrome");
  // Tick once a second only when we have a save timestamp to keep the
  // "Saved · Xs ago" label fresh. No timestamp = no timer.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastSavedAt) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [lastSavedAt]);

  const savedSeconds = lastSavedAt
    ? Math.max(0, Math.floor((Date.now() - lastSavedAt.getTime()) / 1000))
    : null;
  const recentSave = savedSeconds !== null && savedSeconds < 60;

  let main: React.ReactNode;
  if (published?.hasUnpublishedChanges) {
    main = (
      <span className="inline-flex items-center gap-1.5">
        <StatusDot color="#F59E0B" />
        <span className="fg-muted font-medium">
          {t("status.drift", { domain: publishedHost(published.subdomain) })}
        </span>
      </span>
    );
  } else if (recentSave) {
    main = (
      <span className="inline-flex items-center gap-1.5">
        <CloudCheck size={11} className="text-emerald-500" />
        <span className="fg-muted font-medium">
          {t("status.saved", { ago: fmtAgo(savedSeconds!, t) })}
        </span>
      </span>
    );
  } else if (published) {
    main = (
      <span className="inline-flex items-center gap-1.5">
        <StatusDot color="#10B981" pulse />
        <span className="fg-muted font-medium truncate">
          {t("status.live", { domain: publishedHost(published.subdomain) })}
        </span>
      </span>
    );
  } else {
    main = (
      <span className="inline-flex items-center gap-1.5">
        <Globe size={11} className="fg-faint" />
        <span className="fg-faint font-medium">{t("status.ready")}</span>
      </span>
    );
  }

  return (
    <div className="h-6 shrink-0 px-3 flex items-center justify-between text-[10.5px] fg-faint border-t bd bg-side ui-small">
      <div className="flex items-center gap-2 min-w-0 tabular">{main}</div>
      <div className="flex items-center gap-2 fg-faint">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full bg-accent-soft text-accent border border-[color:var(--accent)]/30 px-1.5 py-0.5 transition-opacity duration-200 ${
            saving ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          aria-hidden={!saving}
        >
          <Cloud size={10} className="pulse-soft" />
          <span className="font-semibold">{t("status.saving")}</span>
        </span>
        <kbd className="hidden md:inline-flex items-center px-1 rounded bg-elev border bd font-mono text-[10px]">
          ⌘K
        </kbd>
        <span className="hidden md:inline">{t("status.commandPalette")}</span>
      </div>
    </div>
  );
}
