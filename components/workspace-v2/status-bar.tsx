// Bottom status bar — real publish/save state on the left, saving pill +
// ⌘K hint on the right. The Session 12-era mock activity rotation is gone;
// callers now pass `published` + `lastSavedAt` and we render a single,
// honest line based on the current project state.

"use client";

import { useEffect, useState } from "react";
import { Cloud, CloudCheck, Globe } from "./icons";
import { StatusDot } from "./ui";

interface StatusBarProps {
  saving: boolean;
  published?: { subdomain: string; hasUnpublishedChanges: boolean } | null;
  lastSavedAt?: Date | null;
}

function fmtAgo(seconds: number): string {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function StatusBar({ saving, published, lastSavedAt }: StatusBarProps) {
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
          Drift from {published.subdomain}.openlen.com
        </span>
      </span>
    );
  } else if (recentSave) {
    main = (
      <span className="inline-flex items-center gap-1.5">
        <CloudCheck size={11} className="text-emerald-500" />
        <span className="fg-muted font-medium">
          Saved · {fmtAgo(savedSeconds!)}
        </span>
      </span>
    );
  } else if (published) {
    main = (
      <span className="inline-flex items-center gap-1.5">
        <StatusDot color="#10B981" pulse />
        <span className="fg-muted font-medium truncate">
          Live at {published.subdomain}.openlen.com
        </span>
      </span>
    );
  } else {
    main = (
      <span className="inline-flex items-center gap-1.5">
        <Globe size={11} className="fg-faint" />
        <span className="fg-faint font-medium">Ready to ship</span>
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
          <span className="font-semibold">Saving…</span>
        </span>
        <kbd className="inline-flex items-center px-1 rounded bg-elev border bd font-mono text-[10px]">
          ⌘K
        </kbd>
        <span>command palette</span>
      </div>
    </div>
  );
}
