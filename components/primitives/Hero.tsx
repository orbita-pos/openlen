// Hero primitive — variants: centered, split, asymmetric.
// Server-renderable. All text wraps `<Slot path="...">` so the inline editor
// can find them. Style via CSS variables emitted by the design tokens layer.
//
// Ported from claude.ai layout-primitives artifact (May 2026).

import { Btn, Eyebrow, MediaPlaceholder, Slot } from "./_shared";
import type { HeroProps, HeroSlots } from "./types";

function HeroCentered({ id, slots }: { id: string; slots: HeroSlots }) {
  return (
    <div className="relative overflow-hidden" style={{ background: "var(--color-bg)" }}>
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[60%] pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 0%, oklch(0.96 0.04 12 / 0.7), transparent 70%)",
        }}
      />
      <div className="relative max-w-[64rem] mx-auto px-6 md:px-10 py-28 md:py-36 text-center">
        {slots.eyebrow && (
          <div className="flex justify-center">
            <Eyebrow path={`${id}.eyebrow`}>{slots.eyebrow}</Eyebrow>
          </div>
        )}
        <h1
          className="mt-7 font-display text-[44px] sm:text-[64px] md:text-[88px] leading-[0.98] tracking-[-0.025em] text-balance"
          style={{ color: "var(--color-fg)" }}
        >
          <Slot path={`${id}.headline`}>{slots.headline}</Slot>
        </h1>
        {slots.subhead && (
          <p
            className="mt-7 mx-auto max-w-[42rem] text-[18px] md:text-[20px] leading-[1.5] text-pretty"
            style={{ color: "var(--color-text-muted)" }}
          >
            <Slot path={`${id}.subhead`}>{slots.subhead}</Slot>
          </p>
        )}
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          {slots.ctaPrimary && (
            <Btn href={slots.ctaPrimary.href} variant="primary">
              <Slot path={`${id}.ctaPrimary.label`}>{slots.ctaPrimary.label}</Slot>
            </Btn>
          )}
          {slots.ctaSecondary && (
            <Btn href={slots.ctaSecondary.href} variant="secondary">
              <Slot path={`${id}.ctaSecondary.label`}>{slots.ctaSecondary.label}</Slot>
            </Btn>
          )}
        </div>
        {slots.socialProof && (
          <p className="mt-8 text-[13px]" style={{ color: "var(--color-text-dim)" }}>
            <Slot path={`${id}.socialProof`}>{slots.socialProof}</Slot>
          </p>
        )}
      </div>
    </div>
  );
}

function HeroSplit({ id, slots }: { id: string; slots: HeroSlots }) {
  return (
    <div className="relative" style={{ background: "var(--color-bg)" }}>
      <div className="max-w-[80rem] mx-auto px-6 md:px-10 py-20 md:py-28 grid md:grid-cols-2 gap-12 md:gap-16 items-center">
        <div>
          {slots.eyebrow && <Eyebrow path={`${id}.eyebrow`}>{slots.eyebrow}</Eyebrow>}
          <h1
            className="mt-6 font-display text-[40px] md:text-[64px] leading-[1.02] tracking-[-0.022em] text-balance"
            style={{ color: "var(--color-fg)" }}
          >
            <Slot path={`${id}.headline`}>{slots.headline}</Slot>
          </h1>
          {slots.subhead && (
            <p
              className="mt-6 text-[17px] md:text-[19px] leading-[1.5] max-w-[34rem] text-pretty"
              style={{ color: "var(--color-text-muted)" }}
            >
              <Slot path={`${id}.subhead`}>{slots.subhead}</Slot>
            </p>
          )}
          <div className="mt-9 flex flex-wrap gap-3">
            {slots.ctaPrimary && (
              <Btn href={slots.ctaPrimary.href} variant="primary">
                <Slot path={`${id}.ctaPrimary.label`}>{slots.ctaPrimary.label}</Slot>
              </Btn>
            )}
            {slots.ctaSecondary && (
              <Btn href={slots.ctaSecondary.href} variant="secondary">
                <Slot path={`${id}.ctaSecondary.label`}>{slots.ctaSecondary.label}</Slot>
              </Btn>
            )}
          </div>
          {slots.socialProof && (
            <p className="mt-7 text-[13px]" style={{ color: "var(--color-text-dim)" }}>
              <Slot path={`${id}.socialProof`}>{slots.socialProof}</Slot>
            </p>
          )}
        </div>
        <div className="order-first md:order-last">
          <MediaPlaceholder ratio="4 / 5" label="preview" />
        </div>
      </div>
    </div>
  );
}

function HeroAsymmetric({ id, slots }: { id: string; slots: HeroSlots }) {
  return (
    <div className="relative overflow-hidden bg-dotgrid" style={{ background: "var(--color-bg)" }}>
      <div
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          left: "8%",
          top: "10%",
          width: "55%",
          height: "70%",
          background:
            "radial-gradient(60% 60% at 40% 40%, oklch(0.85 0.13 12 / 0.55), transparent 65%)",
          filter: "blur(6px)",
        }}
      />
      <div aria-hidden className="absolute inset-0 bg-dotgrid opacity-[0.35] pointer-events-none" />
      <div className="relative max-w-[80rem] mx-auto px-6 md:px-12 pt-20 pb-24 md:pt-28 md:pb-32">
        <div
          aria-hidden
          className="hidden md:block absolute left-3 top-1/2 font-mono text-[11px] uppercase tracking-[0.32em]"
          style={{
            color: "var(--color-text-dim)",
            transform: "translateY(-50%) rotate(-90deg)",
            transformOrigin: "left center",
          }}
        >
          Vol. 03 · Issue 12 · Coral
        </div>
        <div className="grid grid-cols-12 gap-6 md:gap-10 items-center">
          <div className="col-span-12 md:col-span-7 relative">
            {slots.eyebrow && <Eyebrow path={`${id}.eyebrow`}>{slots.eyebrow}</Eyebrow>}
            <h1
              className="relative mt-7 font-display leading-[0.95] tracking-[-0.03em] text-balance md:-ml-2 lg:-ml-8"
              style={{
                color: "var(--color-fg)",
                fontSize: "clamp(48px, 8.4vw, 124px)",
              }}
            >
              <Slot path={`${id}.headline`}>{slots.headline}</Slot>
            </h1>
            {slots.subhead && (
              <p
                className="mt-7 text-[17px] md:text-[19px] leading-[1.5] max-w-[34rem]"
                style={{ color: "var(--color-text-muted)" }}
              >
                <Slot path={`${id}.subhead`}>{slots.subhead}</Slot>
              </p>
            )}
            <div className="mt-9 flex flex-wrap gap-3 items-center">
              {slots.ctaPrimary && (
                <Btn href={slots.ctaPrimary.href} variant="primary">
                  <Slot path={`${id}.ctaPrimary.label`}>{slots.ctaPrimary.label}</Slot>
                </Btn>
              )}
              {slots.ctaSecondary && (
                <Btn href={slots.ctaSecondary.href} variant="secondary">
                  <Slot path={`${id}.ctaSecondary.label`}>{slots.ctaSecondary.label}</Slot>
                </Btn>
              )}
              {slots.socialProof && (
                <span className="ml-2 text-[13px]" style={{ color: "var(--color-text-dim)" }}>
                  <Slot path={`${id}.socialProof`}>{slots.socialProof}</Slot>
                </span>
              )}
            </div>
          </div>
          <div className="col-span-12 md:col-span-5 md:pl-6">
            <MediaPlaceholder
              ratio="3 / 4"
              label="hero.tsx"
              rotate={-2}
              shadow="0 40px 80px -30px oklch(0% 0 0 / 0.3)"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function Hero({ id, variant, slots }: HeroProps) {
  if (variant === "centered") return <HeroCentered id={id} slots={slots} />;
  if (variant === "split") return <HeroSplit id={id} slots={slots} />;
  if (variant === "asymmetric") return <HeroAsymmetric id={id} slots={slots} />;
  return null;
}
