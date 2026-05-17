// Grid primitive — variants: logo-bar, feature-3col, testimonial-masonry,
// stats-4-grid, pricing-3tier.
// Ported from claude.ai layout-primitives artifact (May 2026).

import { Btn, Icon, LogoTile, SectionHead, Slot } from "./_shared";
import type { GridItem, GridProps, GridSlots } from "./types";

function GridLogoBar({ id, slots }: { id: string; slots: GridSlots }) {
  return (
    <div style={{ background: "var(--primitive-section-bg, var(--color-bg))" }}>
      <div className="max-w-[80rem] mx-auto px-6 md:px-10 py-16 md:py-20">
        {slots.title && (
          <div className="text-center">
            <span
              className="font-mono text-[11px] uppercase tracking-[0.22em]"
              style={{ color: "var(--color-text-dim)" }}
            >
              <Slot path={`${id}.title`}>{slots.title}</Slot>
            </span>
          </div>
        )}
        <div
          className="mt-8 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-x-8 gap-y-6 items-center"
          style={{ filter: "grayscale(1)", opacity: 0.6 }}
        >
          {slots.items.map((it, i) => {
            const label =
              it.media && it.media.kind === "text"
                ? it.media.value
                : (it.title ?? "");
            return (
              <div key={i} className="flex justify-center">
                <LogoTile label={label} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GridFeature3({ id, slots }: { id: string; slots: GridSlots }) {
  return (
    <div style={{ background: "var(--primitive-section-bg, var(--color-bg))" }}>
      <div className="max-w-[80rem] mx-auto px-6 md:px-10 py-20 md:py-24">
        <SectionHead id={id} eyebrow={slots.eyebrow} title={slots.title} sub={slots.sub} align="left" />
        <div className="mt-14 grid md:grid-cols-3 gap-5">
          {slots.items.map((it, i) => {
            const iconName = it.media && it.media.kind === "icon" ? it.media.name : "spark";
            return (
              <article
                key={i}
                className="p-7 md:p-8 relative"
                style={{
                  background: it.accent ? "var(--color-fg)" : "var(--color-surface)",
                  color: it.accent ? "var(--color-bg)" : "var(--color-fg)",
                  border: `1px solid ${it.accent ? "var(--color-fg)" : "var(--color-border)"}`,
                  borderRadius: "var(--radius)",
                }}
              >
                <div
                  className="w-10 h-10 rounded-[10px] flex items-center justify-center"
                  style={{
                    background: it.accent ? "var(--color-accent)" : "var(--color-bg)",
                    color: it.accent ? "var(--color-accent-fg)" : "var(--color-fg)",
                    boxShadow: it.accent ? "none" : "inset 0 0 0 1px var(--color-border)",
                  }}
                >
                  <Icon name={iconName} size={20} />
                </div>
                <h3 className="mt-6 font-display text-[24px] tracking-[-0.012em] leading-tight">
                  <Slot path={`${id}.items[${i}].title`}>{it.title}</Slot>
                </h3>
                <p
                  className="mt-3 text-[15px] leading-[1.55] text-pretty"
                  style={{ color: it.accent ? "oklch(1 0 0 / 0.7)" : "var(--color-text-muted)" }}
                >
                  <Slot path={`${id}.items[${i}].body`}>{it.body}</Slot>
                </p>
                {it.cta && (
                  <a
                    href={it.cta.href}
                    className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium"
                    style={{ color: it.accent ? "var(--color-bg)" : "var(--color-accent-strong)" }}
                  >
                    <Slot path={`${id}.items[${i}].cta.label`}>{it.cta.label}</Slot>
                    <Icon name="arrow" size={14} />
                  </a>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Initials({ name }: { name: string }) {
  const parts = name.split(" ").filter(Boolean);
  const ini = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center font-medium text-[12px]"
      style={{ background: "var(--color-accent-soft)", color: "var(--color-accent-strong)" }}
    >
      {ini.toUpperCase()}
    </div>
  );
}

function TestimonialCard({ id, i, it }: { id: string; i: number; it: GridItem }) {
  const mediaText = it.media && it.media.kind === "text" ? it.media.value : "";
  return (
    <article
      className="mb-5 break-inside-avoid p-6 md:p-7"
      style={{
        background: it.accent ? "var(--color-fg)" : "var(--color-surface)",
        color: it.accent ? "var(--color-bg)" : "var(--color-fg)",
        borderRadius: "var(--radius)",
        border: `1px solid ${it.accent ? "var(--color-fg)" : "var(--color-border)"}`,
        boxShadow: "0 1px 0 oklch(0% 0 0 / 0.02), 0 8px 24px -16px oklch(0% 0 0 / 0.12)",
      }}
    >
      <Icon
        name="quote"
        size={22}
        style={{
          color: it.accent ? "var(--color-accent)" : "var(--color-accent-strong)",
          opacity: 0.85,
        }}
      />
      <p
        className="mt-3 text-[15.5px] leading-[1.55] text-pretty"
        style={{ color: it.accent ? "oklch(1 0 0 / 0.92)" : "var(--color-fg)" }}
      >
        <Slot path={`${id}.items[${i}].body`}>{it.body}</Slot>
      </p>
      <div className="mt-5 flex items-center gap-3">
        <Initials name={it.title ?? ""} />
        <div className="min-w-0">
          <div
            className="text-[13.5px] font-medium"
            style={{ color: it.accent ? "var(--color-bg)" : "var(--color-fg)" }}
          >
            <Slot path={`${id}.items[${i}].title`}>{it.title}</Slot>
          </div>
          <div
            className="text-[12.5px]"
            style={{ color: it.accent ? "oklch(1 0 0 / 0.55)" : "var(--color-text-dim)" }}
          >
            <Slot path={`${id}.items[${i}].media.value`}>{mediaText}</Slot>
          </div>
        </div>
      </div>
    </article>
  );
}

function GridTestimonialMasonry({ id, slots }: { id: string; slots: GridSlots }) {
  return (
    <div style={{ background: "var(--primitive-section-bg, var(--color-bg))" }}>
      <div className="max-w-[80rem] mx-auto px-6 md:px-10 py-20 md:py-24">
        <SectionHead id={id} eyebrow={slots.eyebrow} title={slots.title} sub={slots.sub} align="center" />
        <div className="mt-14">
          <div className="hidden md:block" style={{ columnCount: 3, columnGap: "1.25rem" }}>
            {slots.items.map((it, i) => (
              <TestimonialCard key={i} id={id} i={i} it={it} />
            ))}
          </div>
          <div className="md:hidden grid grid-cols-1 gap-5">
            {slots.items.map((it, i) => (
              <TestimonialCard key={i} id={id} i={i} it={it} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function GridStats4({ id, slots }: { id: string; slots: GridSlots }) {
  return (
    <div style={{ background: "var(--primitive-section-bg, var(--color-bg))" }}>
      <div className="max-w-[80rem] mx-auto px-6 md:px-10 py-20 md:py-24">
        {(slots.eyebrow || slots.title) && (
          <SectionHead id={id} eyebrow={slots.eyebrow} title={slots.title} sub={slots.sub} align="left" />
        )}
        <div
          className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            overflow: "hidden",
          }}
        >
          {slots.items.map((it, i) => {
            const value = it.media && it.media.kind === "text" ? it.media.value : "";
            return (
              <div
                key={i}
                className="p-8 md:p-9"
                style={{
                  background: "var(--color-bg)",
                  borderRight: "1px solid var(--color-border)",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <div
                  className="font-mono text-[11px] uppercase tracking-[0.18em]"
                  style={{ color: "var(--color-text-dim)" }}
                >
                  <Slot path={`${id}.items[${i}].title`}>{it.title}</Slot>
                </div>
                <div
                  className="mt-4 font-display leading-[0.95] tracking-[-0.03em]"
                  style={{
                    color: i === 0 ? "var(--color-accent-strong)" : "var(--color-fg)",
                    fontSize: "clamp(48px, 5.5vw, 76px)",
                  }}
                >
                  <Slot path={`${id}.items[${i}].media.value`}>{value}</Slot>
                </div>
                <p
                  className="mt-3 text-[13.5px] leading-[1.5] max-w-[18rem]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  <Slot path={`${id}.items[${i}].body`}>{it.body}</Slot>
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GridPricing3({ id, slots }: { id: string; slots: GridSlots }) {
  return (
    <div style={{ background: "var(--primitive-section-bg, var(--color-bg))" }}>
      <div className="max-w-[80rem] mx-auto px-6 md:px-10 py-20 md:py-24">
        <SectionHead id={id} eyebrow={slots.eyebrow} title={slots.title} sub={slots.sub} align="center" />
        <div className="mt-14 grid md:grid-cols-3 gap-5 items-stretch">
          {slots.items.map((it, i) => {
            const accent = !!it.accent;
            const mediaText = it.media && it.media.kind === "text" ? it.media.value : "";
            return (
              <article
                key={i}
                className="relative p-8 flex flex-col"
                style={{
                  background: accent ? "var(--color-fg)" : "var(--color-bg)",
                  color: accent ? "var(--color-bg)" : "var(--color-fg)",
                  border: `1px solid ${accent ? "var(--color-fg)" : "var(--color-border)"}`,
                  borderRadius: "var(--radius)",
                  boxShadow: accent
                    ? "0 30px 60px -30px oklch(0% 0 0 / 0.35), inset 0 0 0 1px var(--color-accent)"
                    : "none",
                }}
              >
                {accent && (
                  <span
                    className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] uppercase tracking-[0.16em] font-medium font-mono"
                    style={{ background: "var(--color-accent)", color: "var(--color-accent-fg)" }}
                  >
                    Most popular
                  </span>
                )}
                <div className="flex items-baseline justify-between">
                  <h3 className="font-display text-[22px] tracking-[-0.01em]">
                    <Slot path={`${id}.items[${i}].title`}>{it.title}</Slot>
                  </h3>
                  {mediaText && (
                    <span
                      className="font-mono text-[11px] uppercase tracking-[0.18em]"
                      style={{ color: accent ? "oklch(1 0 0 / 0.55)" : "var(--color-text-dim)" }}
                    >
                      <Slot path={`${id}.items[${i}].media.value`}>{mediaText}</Slot>
                    </span>
                  )}
                </div>
                <div className="mt-6 flex items-end gap-1.5">
                  <span
                    className="font-display tracking-[-0.025em] leading-none"
                    style={{
                      fontSize: "clamp(48px, 5vw, 64px)",
                      color: accent ? "var(--color-bg)" : "var(--color-fg)",
                    }}
                  >
                    <Slot path={`${id}.items[${i}].price`}>{it.price}</Slot>
                  </span>
                  <span
                    className="text-[14px] pb-2"
                    style={{ color: accent ? "oklch(1 0 0 / 0.6)" : "var(--color-text-muted)" }}
                  >
                    <Slot path={`${id}.items[${i}].period`}>{it.period}</Slot>
                  </span>
                </div>
                <p
                  className="mt-3 text-[14.5px] leading-[1.55] min-h-[2.6em]"
                  style={{ color: accent ? "oklch(1 0 0 / 0.7)" : "var(--color-text-muted)" }}
                >
                  <Slot path={`${id}.items[${i}].body`}>{it.body}</Slot>
                </p>

                <ul className="mt-6 flex flex-col gap-2.5 grow">
                  {(it.features ?? []).map((f, j) => (
                    <li key={j} className="flex items-start gap-2.5 text-[14.5px]">
                      <Icon
                        name="check"
                        size={16}
                        style={{
                          color: accent ? "var(--color-accent)" : "var(--color-accent-strong)",
                          marginTop: 3,
                        }}
                      />
                      <Slot path={`${id}.items[${i}].features[${j}]`}>{f}</Slot>
                    </li>
                  ))}
                </ul>

                <div className="mt-8">
                  {it.cta && (
                    <Btn
                      href={it.cta.href}
                      variant={accent ? "primary" : "secondary"}
                      className="w-full"
                    >
                      <Slot path={`${id}.items[${i}].cta.label`}>{it.cta.label}</Slot>
                    </Btn>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Grid({ id, variant, slots }: GridProps) {
  if (variant === "logo-bar") return <GridLogoBar id={id} slots={slots} />;
  if (variant === "feature-3col") return <GridFeature3 id={id} slots={slots} />;
  if (variant === "testimonial-masonry") return <GridTestimonialMasonry id={id} slots={slots} />;
  if (variant === "stats-4-grid") return <GridStats4 id={id} slots={slots} />;
  if (variant === "pricing-3tier") return <GridPricing3 id={id} slots={slots} />;
  return null;
}
