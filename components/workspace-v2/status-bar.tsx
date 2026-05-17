// Bottom status bar — save state + cost/time/gate counters + rotating
// activity log + ⌘K hint.

"use client";

import { Check, Cloud, CloudCheck } from "./icons";
import { ACTIVITY_LOG } from "./mock-data";
import { StatusDot } from "./ui";

interface StatusBarProps {
  activityIdx: number;
  saving: boolean;
}

export function StatusBar({ activityIdx, saving }: StatusBarProps) {
  return (
    <div className="h-6 shrink-0 px-3 flex items-center justify-between text-[10.5px] fg-faint border-t bd bg-side ui-small">
      <div className="flex items-center gap-3 tabular">
        <span className="inline-flex items-center gap-1.5">
          {saving ? (
            <>
              <Cloud size={11} className="fg-faint pulse-soft" />
              <span className="fg-muted font-medium">Saving…</span>
            </>
          ) : (
            <>
              <CloudCheck size={11} className="text-emerald-500" />
              <span className="fg-muted font-medium">Saved 2s ago</span>
            </>
          )}
        </span>
        <span className="fg-faint">·</span>
        <span className="inline-flex items-center gap-1.5">
          <StatusDot color="#FF5A36" />
          <span className="text-accent font-semibold">$0.014</span>{" "}
          <span className="fg-faint">spent</span>
        </span>
        <span className="fg-faint">·</span>
        <span>
          <span className="fg-muted font-medium">12s</span> generation
        </span>
        <span className="fg-faint">·</span>
        <span className="inline-flex items-center gap-1">
          <Check size={10} stroke={3} className="text-emerald-500" />{" "}
          <span className="fg-muted font-medium">6/6</span> quality gates
        </span>
      </div>
      <div className="flex-1 text-center truncate fg-faint">
        <span key={activityIdx} className="fade-in inline-block">
          {ACTIVITY_LOG[activityIdx]}
        </span>
      </div>
      <div className="flex items-center gap-1.5 fg-faint">
        <kbd className="inline-flex items-center px-1 rounded bg-elev border bd font-mono text-[10px]">
          ⌘K
        </kbd>
        <span>command palette</span>
      </div>
    </div>
  );
}
