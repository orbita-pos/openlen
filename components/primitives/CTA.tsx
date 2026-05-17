// CTA primitive — variants: centered-banner, card-form, gradient-banner.
// Ported from claude.ai layout-primitives artifact (May 2026).

import { Btn, Eyebrow, Icon, Slot } from "./_shared";
import type { CTAProps, CTASlots } from "./types";

function CTACenteredBanner({ id, slots }: { id: string; slots: CTASlots }) {
  return (
    <div style={{ background: "var(--color-surface-elevated)" }}>
      <div className="max-w-[64rem] mx-auto px-6 md:px-10 py-20 md:py-24 text-center">
        {slots.eyebrow && (
          <div className="flex justify-center">
            <Eyebrow path={`${id}.eyebrow`}>{slots.eyebrow}</Eyebrow>
          </div>
        )}
        <h2
          className="mt-5 font-display text-[40px] md:text-[56px] leading-[1.04] tracking-[-0.022em] text-balance"
          style={{ color: "var(--color-fg)" }}
        >
          <Slot path={`${id}.headline`}>{slots.headline}</Slot>
        </h2>
        {slots.sub && (
          <p
            className="mt-5 mx-auto max-w-[38rem] text-[17px] leading-[1.55]"
            style={{ color: "var(--color-text-muted)" }}
          >
            <Slot path={`${id}.sub`}>{slots.sub}</Slot>
          </p>
        )}
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Btn href={slots.ctaPrimary.href} variant="primary">
            <Slot path={`${id}.ctaPrimary.label`}>{slots.ctaPrimary.label}</Slot>
          </Btn>
          {slots.ctaSecondary && (
            <Btn href={slots.ctaSecondary.href} variant="secondary">
              <Slot path={`${id}.ctaSecondary.label`}>{slots.ctaSecondary.label}</Slot>
            </Btn>
          )}
        </div>
        {slots.footnote && (
          <p className="mt-7 text-[12.5px]" style={{ color: "var(--color-text-dim)" }}>
            <Slot path={`${id}.footnote`}>{slots.footnote}</Slot>
          </p>
        )}
      </div>
    </div>
  );
}

function CTACardForm({ id, slots }: { id: string; slots: CTASlots }) {
  return (
    <div style={{ background: "var(--primitive-section-bg, var(--color-bg))" }}>
      <div className="max-w-[64rem] mx-auto px-6 md:px-10 py-20 md:py-24">
        <div
          className="mx-auto max-w-[40rem] p-8 md:p-10 text-center"
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            boxShadow:
              "0 30px 60px -30px oklch(0% 0 0 / 0.25), 0 1px 0 oklch(1 0 0 / 0.6) inset",
          }}
        >
          {slots.eyebrow && (
            <div className="flex justify-center">
              <Eyebrow path={`${id}.eyebrow`}>{slots.eyebrow}</Eyebrow>
            </div>
          )}
          <h2
            className="mt-5 font-display text-[32px] md:text-[40px] leading-[1.08] tracking-[-0.018em] text-balance"
            style={{ color: "var(--color-fg)" }}
          >
            <Slot path={`${id}.headline`}>{slots.headline}</Slot>
          </h2>
          {slots.sub && (
            <p
              className="mt-4 mx-auto max-w-[28rem] text-[15.5px] leading-[1.55]"
              style={{ color: "var(--color-text-muted)" }}
            >
              <Slot path={`${id}.sub`}>{slots.sub}</Slot>
            </p>
          )}

          <form className="mt-7 flex flex-col sm:flex-row gap-2 max-w-[28rem] mx-auto">
            <label className="sr-only" htmlFor={`${id}-email`}>
              Email
            </label>
            <input
              id={`${id}-email`}
              type="email"
              placeholder="you@studio.com"
              className="flex-1 h-11 px-3.5 rounded-[10px] text-[15px] focus-ring"
              style={{
                background: "var(--color-bg)",
                color: "var(--color-fg)",
                boxShadow: "inset 0 0 0 1px var(--color-border-strong)",
                outline: "none",
              }}
            />
            <button
              type="submit"
              className="h-11 px-5 rounded-[10px] text-[15px] font-medium focus-ring inline-flex items-center justify-center gap-2"
              style={{ background: "var(--color-accent)", color: "var(--color-accent-fg)" }}
            >
              <Slot path={`${id}.ctaPrimary.label`}>{slots.ctaPrimary.label}</Slot>
              <Icon name="arrow" size={14} />
            </button>
          </form>

          {slots.footnote && (
            <p className="mt-5 text-[12.5px]" style={{ color: "var(--color-text-dim)" }}>
              <Slot path={`${id}.footnote`}>{slots.footnote}</Slot>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CTAGradientBanner({ id, slots }: { id: string; slots: CTASlots }) {
  return (
    <div
      className="relative overflow-hidden hairline-top"
      style={{
        background:
          "radial-gradient(120% 100% at 20% 0%, oklch(0.78 0.18 12), oklch(0.42 0.14 18) 55%, oklch(0.22 0.06 24) 100%)",
        color: "oklch(0.99 0.005 60)",
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(80% 60% at 90% 100%, oklch(1 0 0 / 0.08), transparent 60%)",
        }}
      />
      <div className="relative max-w-[80rem] mx-auto px-6 md:px-10 py-24 md:py-32 grid md:grid-cols-12 gap-8 items-end">
        <div className="md:col-span-8">
          {slots.eyebrow && (
            <Eyebrow path={`${id}.eyebrow`} tone="onAccent">
              {slots.eyebrow}
            </Eyebrow>
          )}
          <h2
            className="mt-6 font-display leading-[0.98] tracking-[-0.025em] text-balance"
            style={{ fontSize: "clamp(40px, 6vw, 88px)", color: "oklch(0.99 0.005 60)" }}
          >
            <Slot path={`${id}.headline`}>{slots.headline}</Slot>
          </h2>
          {slots.sub && (
            <p
              className="mt-6 text-[17px] md:text-[19px] leading-[1.5] max-w-[34rem]"
              style={{ color: "oklch(1 0 0 / 0.78)" }}
            >
              <Slot path={`${id}.sub`}>{slots.sub}</Slot>
            </p>
          )}
        </div>
        <div className="md:col-span-4 flex md:justify-end">
          <div className="flex flex-wrap gap-3">
            <a
              href={slots.ctaPrimary.href}
              className="inline-flex items-center gap-2 h-12 px-6 rounded-[10px] text-[15px] font-medium focus-ring"
              style={{ background: "oklch(0.99 0.005 60)", color: "oklch(0.18 0.04 18)" }}
            >
              <Slot path={`${id}.ctaPrimary.label`}>{slots.ctaPrimary.label}</Slot>
              <Icon name="arrow" size={14} />
            </a>
            {slots.ctaSecondary && (
              <a
                href={slots.ctaSecondary.href}
                className="inline-flex items-center gap-2 h-12 px-6 rounded-[10px] text-[15px] font-medium focus-ring"
                style={{ color: "oklch(0.99 0.005 60)", boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.3)" }}
              >
                <Slot path={`${id}.ctaSecondary.label`}>{slots.ctaSecondary.label}</Slot>
              </a>
            )}
          </div>
        </div>
        {slots.footnote && (
          <div className="md:col-span-12 mt-2">
            <p className="text-[12.5px]" style={{ color: "oklch(1 0 0 / 0.55)" }}>
              <Slot path={`${id}.footnote`}>{slots.footnote}</Slot>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function CTA({ id, variant, slots }: CTAProps) {
  if (variant === "centered-banner") return <CTACenteredBanner id={id} slots={slots} />;
  if (variant === "card-form") return <CTACardForm id={id} slots={slots} />;
  if (variant === "gradient-banner") return <CTAGradientBanner id={id} slots={slots} />;
  return null;
}
