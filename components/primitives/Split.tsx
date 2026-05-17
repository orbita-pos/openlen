// Split primitive — variants: side-by-side, comparison-table, before-after.
// Ported from claude.ai layout-primitives artifact (May 2026).

import { Fragment } from "react";
import { Icon, SectionHead, Slot } from "./_shared";
import type { SplitProps, SplitSlots, SplitSide } from "./types";

function SplitSideBySide({ id, slots }: { id: string; slots: SplitSlots }) {
  return (
    <div style={{ background: "var(--primitive-section-bg, var(--color-bg))" }}>
      <div className="max-w-[80rem] mx-auto px-6 md:px-10 py-20 md:py-24">
        <SectionHead id={id} eyebrow={slots.eyebrow} title={slots.title} sub={slots.sub} align="left" />
        <div
          className="mt-14 grid md:grid-cols-2"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          {(["left", "right"] as const).map((side, i) => {
            const s = slots[side];
            return (
              <div
                key={side}
                className="p-8 md:p-10"
                style={{
                  borderRight: i === 0 ? "1px solid var(--color-border)" : undefined,
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <span
                  className="font-mono text-[11px] uppercase tracking-[0.18em]"
                  style={{ color: "var(--color-text-dim)" }}
                >
                  {String(i + 1).padStart(2, "0")} / 02
                </span>
                <h3
                  className="mt-4 font-display text-[32px] md:text-[38px] tracking-[-0.02em] leading-[1.06] text-balance"
                  style={{ color: "var(--color-fg)" }}
                >
                  <Slot path={`${id}.${side}.title`}>{s.title}</Slot>
                </h3>
                <p
                  className="mt-4 text-[16px] leading-[1.6] text-pretty"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  <Slot path={`${id}.${side}.body`}>{s.body}</Slot>
                </p>
                {s.bullets && (
                  <ul className="mt-6 flex flex-col gap-3">
                    {s.bullets.map((b, j) => (
                      <li
                        key={j}
                        className="flex items-start gap-3 text-[15px]"
                        style={{ color: "var(--color-fg)" }}
                      >
                        <span
                          className="mt-[7px] w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: "var(--color-accent)" }}
                        />
                        <Slot path={`${id}.${side}.bullets[${j}]`}>{b}</Slot>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SplitComparisonTable({ id, slots }: { id: string; slots: SplitSlots }) {
  // 8 feature rows; ours/theirs as cell values
  const rows: Array<[label: string, ours: true | false | "soft", theirs: true | false | "soft"]> = [
    ["You own the HTML output", true, false],
    ["AGPL open source", true, false],
    ["No platform lock-in", true, false],
    ["AI-composed sections", true, true],
    ["Live edit in the browser", true, true],
    ["Headless CMS adapters", true, false],
    ["Self-host on $5 VPS", true, false],
    ["Free tier", "soft", true],
  ];

  const renderCell = (v: true | false | "soft", accent: boolean) => {
    if (v === true)
      return (
        <Icon
          name="check"
          size={18}
          style={{ color: accent ? "var(--color-accent-strong)" : "var(--color-fg)" }}
        />
      );
    if (v === false) return <Icon name="x" size={18} style={{ color: "var(--color-text-dim)" }} />;
    return (
      <span className="text-[13px]" style={{ color: "var(--color-text-muted)" }}>
        Limited
      </span>
    );
  };

  return (
    <div style={{ background: "var(--primitive-section-bg, var(--color-bg))" }}>
      <div className="max-w-[72rem] mx-auto px-6 md:px-10 py-20 md:py-24">
        <SectionHead id={id} eyebrow={slots.eyebrow} title={slots.title} sub={slots.sub} align="center" />
        <div
          className="mt-14 grid"
          style={{
            gridTemplateColumns: "1.5fr 1fr 1fr",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            overflow: "hidden",
            background: "var(--color-bg)",
          }}
        >
          <div className="p-5" style={{ background: "var(--color-surface)" }} />
          <div className="p-5 text-center" style={{ background: "var(--color-surface)" }}>
            <div
              className="font-mono text-[10.5px] uppercase tracking-[0.18em]"
              style={{ color: "var(--color-text-dim)" }}
            >
              Other tools
            </div>
            <div className="mt-1 font-display text-[20px]" style={{ color: "var(--color-text-muted)" }}>
              Lovable
            </div>
          </div>
          <div className="p-5 text-center" style={{ background: "var(--color-accent-soft)" }}>
            <div
              className="font-mono text-[10.5px] uppercase tracking-[0.18em]"
              style={{ color: "var(--color-accent-strong)" }}
            >
              You
            </div>
            <div className="mt-1 font-display text-[20px]" style={{ color: "var(--color-accent-strong)" }}>
              OpenLen
            </div>
          </div>

          {rows.map(([label, ours, theirs], i) => (
            <Fragment key={i}>
              <div
                className="px-5 py-4 text-[15px]"
                style={{ color: "var(--color-fg)", borderTop: "1px solid var(--color-border)" }}
              >
                <Slot path={`${id}.rows[${i}].label`}>{label}</Slot>
              </div>
              <div
                className="px-5 py-4 flex items-center justify-center"
                style={{ borderTop: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}
              >
                {renderCell(theirs, false)}
              </div>
              <div
                className="px-5 py-4 flex items-center justify-center"
                style={{
                  borderTop: "1px solid var(--color-border)",
                  background: "oklch(0.97 0.02 12 / 0.55)",
                }}
              >
                {renderCell(ours, true)}
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function BeforeAfterPanel({
  side,
  id,
  slot,
}: {
  side: "before" | "after";
  id: string;
  slot: SplitSide;
}) {
  const isBefore = side === "before";
  return (
    <div
      className="relative p-7 md:p-9"
      style={{
        background: isBefore ? "var(--color-surface)" : "var(--color-bg)",
        borderRadius: "var(--radius)",
        border: "1px solid var(--color-border)",
        minHeight: 360,
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="font-mono text-[10.5px] uppercase tracking-[0.2em] px-2.5 py-1 rounded-full"
          style={{
            color: isBefore ? "var(--color-text-muted)" : "var(--color-accent-fg)",
            background: isBefore ? "var(--color-bg)" : "var(--color-accent)",
            boxShadow: isBefore ? "inset 0 0 0 1px var(--color-border)" : "none",
          }}
        >
          {isBefore ? "Before" : "After"}
        </span>
        <span className="font-mono text-[11px]" style={{ color: "var(--color-text-dim)" }}>
          {isBefore ? "Mon · 3 days in" : "Tue · 11 minutes"}
        </span>
      </div>

      <h3
        className="mt-6 font-display text-[28px] md:text-[34px] tracking-[-0.018em] leading-[1.06] text-balance"
        style={{ color: "var(--color-fg)" }}
      >
        <Slot path={`${id}.${side === "before" ? "left" : "right"}.title`}>{slot.title}</Slot>
      </h3>
      <p
        className="mt-3 text-[15.5px] leading-[1.6] max-w-[28rem]"
        style={{ color: "var(--color-text-muted)" }}
      >
        <Slot path={`${id}.${side === "before" ? "left" : "right"}.body`}>{slot.body}</Slot>
      </p>

      <div className="mt-8 grid gap-2">
        {(isBefore
          ? ["Read 6 docs", "Fork starter repo", "Wire Tailwind", "Pick fonts", "Hand-design hero", "Ship later"]
          : ["Write 50-word brief", "Press Generate", "Edit in place", "Ship"]
        ).map((step, i) => (
          <div
            key={i}
            className="flex items-center gap-3 text-[14px]"
            style={{
              color: "var(--color-fg)",
              padding: "10px 14px",
              borderRadius: 10,
              background: "var(--color-bg)",
              boxShadow: "inset 0 0 0 1px var(--color-border)",
              opacity: isBefore ? 0.85 : 1,
            }}
          >
            <span className="font-mono text-[11px] w-5" style={{ color: "var(--color-text-dim)" }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>{step}</span>
            {!isBefore && i === 3 && (
              <span
                className="ml-auto font-mono text-[11px] uppercase tracking-[0.16em]"
                style={{ color: "var(--color-accent-strong)" }}
              >
                done
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SplitBeforeAfter({ id, slots }: { id: string; slots: SplitSlots }) {
  return (
    <div style={{ background: "var(--primitive-section-bg, var(--color-bg))" }}>
      <div className="max-w-[80rem] mx-auto px-6 md:px-10 py-20 md:py-24">
        <SectionHead id={id} eyebrow={slots.eyebrow} title={slots.title} sub={slots.sub} align="center" />
        <div className="mt-14 relative grid md:grid-cols-2 gap-6 md:gap-10">
          <BeforeAfterPanel side="before" id={id} slot={slots.left} />
          <BeforeAfterPanel side="after" id={id} slot={slots.right} />
          <div
            aria-hidden
            className="hidden md:flex absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 items-center gap-2 px-3 py-2 rounded-full font-mono text-[11px] uppercase tracking-[0.18em]"
            style={{
              color: "var(--color-fg)",
              background: "var(--color-bg)",
              boxShadow:
                "0 6px 24px -8px oklch(0% 0 0 / 0.18), inset 0 0 0 1px var(--color-border-strong)",
            }}
          >
            <Icon name="arrow" size={14} style={{ transform: "rotate(180deg)" }} />
            Drag
            <Icon name="arrow" size={14} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function Split({ id, variant, slots }: SplitProps) {
  if (variant === "side-by-side") return <SplitSideBySide id={id} slots={slots} />;
  if (variant === "comparison-table") return <SplitComparisonTable id={id} slots={slots} />;
  if (variant === "before-after") return <SplitBeforeAfter id={id} slots={slots} />;
  return null;
}
