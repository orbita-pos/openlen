// Versions mode panel — timeline of regen / edit / preset events.

"use client";

const ENTRIES = [
  {
    label: "Hero regenerated",
    at: "4s ago",
    author: "Orchestra AI",
    current: true,
    milestone: false,
  },
  {
    label: "Pricing copy edited",
    at: "14s ago",
    author: "Jesus B.",
    current: false,
    milestone: false,
  },
  {
    label: "Background → Conic",
    at: "38s ago",
    author: "Jesus B.",
    current: false,
    milestone: false,
  },
  {
    label: "FAQ section added",
    at: "1m ago",
    author: "Orchestra AI",
    current: false,
    milestone: false,
  },
  {
    label: "Palette → Indigo Cool",
    at: "2m ago",
    author: "Jesus B.",
    current: false,
    milestone: false,
  },
  {
    label: "First generation",
    at: "12m ago",
    author: "Orchestra AI",
    current: false,
    milestone: true,
  },
] as const;

export function VersionsPanel() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small shrink-0">
        Today
      </div>
      <div className="flex-1 overflow-y-auto nice-scroll px-3 pb-3 space-y-1">
        {ENTRIES.map((v, i) => (
          <div
            key={i}
            className={`relative flex items-start gap-2.5 px-2 py-2 rounded-md transition cursor-pointer hover:bg-hover ${
              v.current ? "bg-accent-soft/40 ring-1 ring-[color:var(--accent)]/30" : ""
            }`}
          >
            <span className="relative shrink-0 mt-0.5">
              <span
                className={`block h-2 w-2 rounded-full ${
                  v.current
                    ? "bg-[var(--accent)]"
                    : v.milestone
                      ? "bg-emerald-500"
                      : "bg-[color:var(--border-strong)]"
                }`}
              />
              {i < ENTRIES.length - 1 && (
                <span className="absolute left-1/2 top-3 -translate-x-1/2 h-6 w-px bg-[color:var(--border)]" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium fg truncate">
                {v.label}
              </div>
              <div className="text-[10.5px] fg-faint tabular truncate ui-small">
                {v.at} · {v.author}
              </div>
            </div>
            {v.current && (
              <span className="shrink-0 text-[9.5px] uppercase tracking-wider text-accent font-semibold ui-small">
                Current
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="px-3 py-2 border-t bd shrink-0">
        <button
          type="button"
          className="w-full inline-flex items-center justify-center gap-1.5 h-7 fg-muted hover:fg text-[11.5px] transition"
        >
          Restore previous version…
        </button>
      </div>
    </div>
  );
}
