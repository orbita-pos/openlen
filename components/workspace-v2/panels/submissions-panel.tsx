// Leads mode panel — form submissions captured from the project's published
// page. Read-only list, newest-first. Submissions arrive via the public
// /api/f/<sub> endpoint (forms are wired at publish — lib/publish/forms.ts).

"use client";

import { useEffect, useState } from "react";
import { Inbox } from "../icons";

interface SubmissionItem {
  id: string;
  data: Record<string, string>;
  createdAt: string;
}

export function SubmissionsPanel({
  currentProjectId,
}: {
  currentProjectId?: string | null;
}) {
  const [items, setItems] = useState<SubmissionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentProjectId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setItems(null);
    setError(null);
    void fetch(`/api/projects/${currentProjectId}/submissions`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ submissions: SubmissionItem[] }>;
      })
      .then((d) => {
        if (!cancelled) setItems(d.submissions);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load leads");
        setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProjectId]);

  if (!currentProjectId) {
    return (
      <div className="h-full flex items-center justify-center px-6 py-8 text-center">
        <div className="max-w-[220px]">
          <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev fg-faint">
            <Inbox size={14} />
          </div>
          <p className="text-[11.5px] fg-muted leading-relaxed">
            Leads live per project.
          </p>
          <p className="mt-1.5 text-[10.5px] fg-faint leading-relaxed">
            Open a project from the Pages tab to see its submissions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-1.5 shrink-0">
        <div className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
          Leads
        </div>
        <div className="text-[11px] fg-faint mt-0.5">
          Form submissions from your published page.
        </div>
      </div>
      {error && (
        <div className="mx-3 mt-1 mb-2 rounded-md ring-1 ring-red-500/40 bg-red-500/5 px-2 py-1.5 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
      <div className="flex-1 overflow-y-auto nice-scroll px-3 pb-3">
        {items === null && <Skeletons />}
        {items !== null && items.length === 0 && !error && (
          <div className="px-2 py-8 text-center">
            <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev text-accent">
              <Inbox size={14} />
            </div>
            <p className="text-[12px] fg-muted leading-relaxed">
              No leads yet.
            </p>
            <p className="mt-1 text-[10.5px] fg-faint leading-relaxed">
              Publish your page — every form submission lands here.
            </p>
          </div>
        )}
        {items !== null && items.length > 0 && (
          <div className="space-y-2">
            {items.map((s) => (
              <SubmissionCard key={s.id} item={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SubmissionCard({ item }: { item: SubmissionItem }) {
  const fields = Object.entries(item.data);
  return (
    <div className="rounded-lg ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] px-2.5 py-2">
      <div className="text-[10px] fg-faint ui-small mb-1.5">
        {relativeTime(item.createdAt)}
      </div>
      {fields.length === 0 ? (
        <span className="text-[11.5px] fg-faint italic">Empty submission</span>
      ) : (
        <dl className="space-y-1">
          {fields.map(([k, v]) => (
            <div key={k} className="flex gap-1.5 text-[11.5px] leading-snug">
              <dt className="fg-faint shrink-0 max-w-[40%] truncate">{k}</dt>
              <dd className="fg flex-1 break-words whitespace-pre-wrap">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Skeletons() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-lg ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] px-2.5 py-2 animate-pulse"
        >
          <div className="h-2.5 w-1/4 rounded bg-zinc-200/70 dark:bg-zinc-800/60 mb-2" />
          <div className="h-3 w-3/4 rounded bg-zinc-200/70 dark:bg-zinc-800/60 mb-1.5" />
          <div className="h-3 w-1/2 rounded bg-zinc-200/70 dark:bg-zinc-800/60" />
        </div>
      ))}
    </div>
  );
}

function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const ms = Date.now() - date.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  return date.toLocaleDateString();
}
