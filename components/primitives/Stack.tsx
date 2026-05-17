// Stack primitive — variants: vertical-cards, alternating-rows, icon-grid-3col.
// Ported from claude.ai layout-primitives artifact (May 2026).

import { Icon, SectionHead, Slot } from "./_shared";
import type { StackProps, StackSlots } from "./types";

function StackVerticalCards({ id, slots }: { id: string; slots: StackSlots }) {
  return (
    <div style={{ background: "var(--primitive-section-bg, var(--color-bg))" }}>
      <div className="max-w-[64rem] mx-auto px-6 md:px-10 py-20 md:py-24">
        <SectionHead id={id} eyebrow={slots.eyebrow} title={slots.title} sub={slots.sub} align="center" />
        <div className="mt-14 max-w-[42rem] mx-auto flex flex-col gap-4">
          {slots.items.map((it, i) => (
            <article
              key={i}
              className="relative p-7 md:p-8"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                borderLeft: it.accent
                  ? "3px solid var(--color-accent)"
                  : "1px solid var(--color-border)",
              }}
            >
              <div className="flex items-start gap-5">
                <div
                  className="shrink-0 w-10 h-10 rounded-[10px] flex items-center justify-center"
                  style={{
                    background: it.accent ? "var(--color-accent-soft)" : "var(--color-bg)",
                    color: it.accent ? "var(--color-accent-strong)" : "var(--color-fg)",
                    boxShadow: it.accent ? "none" : "inset 0 0 0 1px var(--color-border)",
                  }}
                >
                  <Icon name={it.icon} size={20} />
                </div>
                <div className="min-w-0">
                  <h3
                    className="font-display text-[22px] md:text-[24px] tracking-[-0.01em] leading-tight"
                    style={{ color: "var(--color-fg)" }}
                  >
                    <Slot path={`${id}.items[${i}].title`}>{it.title}</Slot>
                  </h3>
                  <p
                    className="mt-2 text-[15px] leading-[1.55] text-pretty"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    <Slot path={`${id}.items[${i}].body`}>{it.body}</Slot>
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function StackAlternatingRows({ id, slots }: { id: string; slots: StackSlots }) {
  return (
    <div style={{ background: "var(--primitive-section-bg, var(--color-bg))" }}>
      <div className="max-w-[72rem] mx-auto px-6 md:px-10 py-20 md:py-24">
        <SectionHead id={id} eyebrow={slots.eyebrow} title={slots.title} sub={slots.sub} align="left" />
        <div className="mt-16 flex flex-col gap-16 md:gap-20">
          {slots.items.map((it, i) => {
            const right = i % 2 === 1;
            return (
              <div key={i} className={`grid md:grid-cols-12 gap-6 ${right ? "md:text-right" : ""}`}>
                <div className={right ? "md:col-start-5 md:col-end-13" : "md:col-start-1 md:col-end-9"}>
                  <div className={`flex items-center gap-3 ${right ? "md:justify-end" : ""}`}>
                    <span
                      className="font-mono text-[11px] uppercase tracking-[0.18em]"
                      style={{ color: "var(--color-text-dim)" }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      className="block h-px flex-1 max-w-[60px]"
                      style={{ background: "var(--color-border-strong)" }}
                    />
                    <Icon
                      name={it.icon}
                      size={20}
                      style={{
                        color: it.accent ? "var(--color-accent-strong)" : "var(--color-fg)",
                      }}
                    />
                  </div>
                  <h3
                    className="mt-4 font-display text-[34px] md:text-[44px] leading-[1.04] tracking-[-0.02em] text-balance"
                    style={{ color: "var(--color-fg)" }}
                  >
                    <Slot path={`${id}.items[${i}].title`}>{it.title}</Slot>
                  </h3>
                  <p
                    className={`mt-4 text-[17px] leading-[1.55] max-w-[36rem] text-pretty ${right ? "md:ml-auto" : ""}`}
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    <Slot path={`${id}.items[${i}].body`}>{it.body}</Slot>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StackIconGrid3({ id, slots }: { id: string; slots: StackSlots }) {
  return (
    <div style={{ background: "var(--primitive-section-bg, var(--color-bg))" }}>
      <div className="max-w-[80rem] mx-auto px-6 md:px-10 py-20 md:py-24">
        <SectionHead id={id} eyebrow={slots.eyebrow} title={slots.title} sub={slots.sub} align="left" />
        <div
          className="mt-14 grid grid-cols-1 md:grid-cols-3"
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            overflow: "hidden",
          }}
        >
          {slots.items.map((it, i) => (
            <div
              key={i}
              className="p-7 md:p-8"
              style={{
                background: "var(--color-bg)",
                borderRight: "1px solid var(--color-border)",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <div
                className="w-9 h-9 rounded-[9px] flex items-center justify-center"
                style={{
                  color: it.accent ? "var(--color-accent-strong)" : "var(--color-fg)",
                  background: it.accent ? "var(--color-accent-soft)" : "var(--color-surface)",
                }}
              >
                <Icon name={it.icon} size={20} />
              </div>
              <h3
                className="mt-5 font-display text-[22px] tracking-[-0.01em] leading-tight"
                style={{ color: "var(--color-fg)" }}
              >
                <Slot path={`${id}.items[${i}].title`}>{it.title}</Slot>
              </h3>
              <p
                className="mt-2 text-[14.5px] leading-[1.55] text-pretty"
                style={{ color: "var(--color-text-muted)" }}
              >
                <Slot path={`${id}.items[${i}].body`}>{it.body}</Slot>
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Stack({ id, variant, slots }: StackProps) {
  if (variant === "vertical-cards") return <StackVerticalCards id={id} slots={slots} />;
  if (variant === "alternating-rows") return <StackAlternatingRows id={id} slots={slots} />;
  if (variant === "icon-grid-3col") return <StackIconGrid3 id={id} slots={slots} />;
  return null;
}
