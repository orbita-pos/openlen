// Pages mode panel — recent projects with mini thumbnails.

"use client";

import { Plus } from "../icons";
import { MOCK_PROJECTS } from "../mock-data";
import { PROJ_THUMBS } from "../thumbs";
import { Button, StatusDot } from "../ui";

export function PagesPanel() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 shrink-0">
        <Button variant="outline" size="sm" className="w-full justify-center">
          <Plus size={12} /> New page
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto nice-scroll px-2 pb-2 space-y-1">
        {MOCK_PROJECTS.map((p, i) => {
          const T = PROJ_THUMBS[p.thumb];
          const isCurrent = i === 0;
          return (
            <button
              key={p.id}
              type="button"
              className={`group relative flex items-start gap-2.5 w-full p-1.5 rounded-md border transition text-left ${
                isCurrent
                  ? "border-[color:var(--accent)]/40 bg-accent-soft/40"
                  : "border-transparent hover:bg-hover hover:border-[color:var(--border)]"
              }`}
            >
              <div className="relative shrink-0 h-12 w-[72px] rounded overflow-hidden ring-1 ring-[color:var(--border)] bg-elev">
                {T && <T />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12.5px] font-medium fg truncate flex-1">
                    {p.name}
                  </span>
                  {isCurrent && (
                    <span className="text-[9px] uppercase tracking-wider text-accent font-semibold ui-small">
                      Active
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] fg-faint truncate">
                  {p.editedAt}
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  {p.status === "published" ? (
                    <span className="inline-flex items-center gap-1 text-[10.5px] text-emerald-600 dark:text-emerald-400 ui-small truncate">
                      <StatusDot color="#10B981" pulse />
                      <span className="truncate">{p.deploy}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10.5px] text-amber-600 dark:text-amber-400 ui-small">
                      <StatusDot color="#F59E0B" /> Draft
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
