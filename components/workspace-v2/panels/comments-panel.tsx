// Comments mode panel — mock review threads per section.

"use client";

import { Plus } from "../icons";
import { StatusDot } from "../ui";

const COMMENTS = [
  {
    author: "Ana Reyes",
    initials: "AR",
    color: "#22D3EE",
    at: "12m",
    section: "Hero",
    body: "The headline feels a bit long. Can we trim it?",
    unread: true,
  },
  {
    author: "Mika Kondo",
    initials: "MK",
    color: "#A78BFA",
    at: "1h",
    section: "Pricing",
    body: "Studio tier could be $39 instead of $29. Let's a/b it.",
    unread: false,
  },
  {
    author: "Jesus B.",
    initials: "J",
    color: "#FF7E55",
    at: "yesterday",
    section: "FAQ",
    body: "Added the self-hosting question.",
    unread: false,
  },
] as const;

export function CommentsPanel() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto nice-scroll px-3 py-3 space-y-2">
        {COMMENTS.map((c, i) => (
          <div
            key={i}
            className={`relative rounded-lg border p-2.5 transition hover:bg-hover cursor-pointer ${
              c.unread
                ? "border-[color:var(--accent)]/30 bg-accent-soft/30"
                : "bd"
            }`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-white text-[9.5px] font-semibold shrink-0"
                style={{ background: c.color }}
              >
                {c.initials}
              </span>
              <span className="text-[12px] font-medium fg flex-1 truncate">
                {c.author}
              </span>
              <span className="text-[10.5px] fg-faint tabular ui-small shrink-0">
                {c.at}
              </span>
            </div>
            <div className="text-[11.5px] fg-muted leading-relaxed">
              {c.body}
            </div>
            <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] fg-faint">
              <span className="px-1.5 py-0.5 rounded bg-elev border bd font-medium ui-small">
                {c.section}
              </span>
              {c.unread && (
                <span className="ml-1 inline-flex items-center gap-1 text-accent font-semibold ui-small">
                  <StatusDot color="#FF5A36" /> new
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="px-3 py-2 border-t bd shrink-0">
        <button
          type="button"
          className="w-full inline-flex items-center justify-center gap-1.5 h-7 fg-muted hover:fg text-[11.5px] transition"
        >
          <Plus size={11} /> New comment
        </button>
      </div>
    </div>
  );
}
