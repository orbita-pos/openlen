"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

// PageBuildingLoader — window-card carousel loader (v0-style).
//
// While the AI builds or redesigns a page, a row of window-cards — one per
// page section (Hero, Features, Pricing…) — drifts through a spotlit center
// on a dark stage; inside each card the section's skeleton blocks keep
// assembling in a staggered wave, as if being designed. Pure CSS — a
// translateX marquee + a per-block build loop — no JS, no deps.

const SECTIONS: { labelKey: string; body: ReactNode }[] = [
  {
    labelKey: "loader.sections.hero",
    body: (
      <>
        <div
          className="sk sk-accent"
          style={{ height: 15, width: "72%", animationDelay: "0s" }}
        />
        <div
          className="sk"
          style={{ height: 9, width: "54%", animationDelay: "0.12s" }}
        />
        <div
          className="sk"
          style={{ height: 9, width: "42%", animationDelay: "0.24s" }}
        />
        <div
          className="sk sk-accent"
          style={{
            height: 24,
            width: 78,
            borderRadius: 999,
            marginTop: 5,
            animationDelay: "0.36s",
          }}
        />
      </>
    ),
  },
  {
    labelKey: "loader.sections.features",
    body: (
      <div style={{ display: "flex", gap: 10, width: "100%" }}>
        <div
          className="sk"
          style={{ height: 62, flex: 1, borderRadius: 8, animationDelay: "0.2s" }}
        />
        <div
          className="sk"
          style={{
            height: 62,
            flex: 1,
            borderRadius: 8,
            animationDelay: "0.32s",
          }}
        />
        <div
          className="sk"
          style={{
            height: 62,
            flex: 1,
            borderRadius: 8,
            animationDelay: "0.44s",
          }}
        />
      </div>
    ),
  },
  {
    labelKey: "loader.sections.pricing",
    body: (
      <div
        style={{
          display: "flex",
          gap: 10,
          width: "100%",
          alignItems: "flex-end",
        }}
      >
        <div
          className="sk"
          style={{ height: 88, flex: 1, borderRadius: 8, animationDelay: "0.4s" }}
        />
        <div
          className="sk sk-accent"
          style={{
            height: 110,
            flex: 1,
            borderRadius: 8,
            animationDelay: "0.52s",
          }}
        />
        <div
          className="sk"
          style={{
            height: 88,
            flex: 1,
            borderRadius: 8,
            animationDelay: "0.64s",
          }}
        />
      </div>
    ),
  },
  {
    labelKey: "loader.sections.reviews",
    body: (
      <>
        <div style={{ display: "flex", gap: 9, width: "100%" }}>
          <div
            className="sk"
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              animationDelay: "0.6s",
            }}
          />
          <div
            style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}
          >
            <div
              className="sk"
              style={{ height: 8, width: "58%", animationDelay: "0.72s" }}
            />
            <div
              className="sk"
              style={{ height: 8, width: "88%", animationDelay: "0.84s" }}
            />
          </div>
        </div>
        <div style={{ display: "flex", gap: 9, width: "100%", marginTop: 4 }}>
          <div
            className="sk"
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              animationDelay: "0.96s",
            }}
          />
          <div
            style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}
          >
            <div
              className="sk"
              style={{ height: 8, width: "76%", animationDelay: "1.08s" }}
            />
            <div
              className="sk"
              style={{ height: 8, width: "52%", animationDelay: "1.2s" }}
            />
          </div>
        </div>
      </>
    ),
  },
  {
    labelKey: "loader.sections.footer",
    body: (
      <>
        <div
          className="sk sk-accent"
          style={{ height: 11, width: "40%", animationDelay: "0.8s" }}
        />
        <div style={{ display: "flex", gap: 9, width: "100%", marginTop: 6 }}>
          <div
            className="sk"
            style={{ height: 8, flex: 1, animationDelay: "0.92s" }}
          />
          <div
            className="sk"
            style={{ height: 8, flex: 1, animationDelay: "1.04s" }}
          />
          <div
            className="sk"
            style={{ height: 8, flex: 1, animationDelay: "1.16s" }}
          />
        </div>
      </>
    ),
  },
];

function SectionCard({ label, body }: { label: string; body: ReactNode }) {
  return (
    <div className="cz-card">
      <div className="cz-head">
        <span className="cz-dot" />
        <span className="cz-dot" />
        <span className="cz-dot" />
        <span className="cz-label">{label}</span>
      </div>
      <div className="cz-body">{body}</div>
    </div>
  );
}

export function PageBuildingLoader({ caption }: { caption?: string }) {
  const t = useTranslations("wsChrome");
  return (
    <div className="cz-root">
      <div className="cz-viewport" aria-hidden>
        <div className="cz-track">
          {[...SECTIONS, ...SECTIONS].map((s, i) => (
            <SectionCard key={i} label={t(s.labelKey)} body={s.body} />
          ))}
        </div>
      </div>
      {caption ? <div className="cz-caption">{caption}</div> : null}
      {/* style jsx is global (not scoped) here: the cards are a child
          component + the skeleton bodies are module-level JSX, neither of
          which scoped styled-jsx reaches. All classes are cz-* / .cz-body
          .sk — uniquely namespaced. */}
      <style jsx global>{`
        .cz-root {
          /* Light-mode tokens (default). The :root.dark override below
             flips them all in one place so the loader matches whichever
             theme the rest of the workspace is in. */
          --cz-bg: #fafaf9;
          --cz-card-bg: #ffffff;
          --cz-card-border: rgba(0, 0, 0, 0.07);
          --cz-card-shadow: 0 12px 32px rgba(0, 0, 0, 0.10);
          --cz-head-border: rgba(0, 0, 0, 0.06);
          --cz-dot: rgba(0, 0, 0, 0.18);
          --cz-label: rgba(56, 26, 18, 0.55);
          --cz-sk-bg: rgba(255, 90, 54, 0.14);
          --cz-caption: rgba(40, 24, 20, 0.65);

          position: relative;
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 30px;
          overflow: hidden;
          background:
            radial-gradient(
              circle at 50% 47%,
              rgba(255, 90, 54, 0.14),
              rgba(255, 90, 54, 0) 46%
            ),
            var(--cz-bg);
        }
        :root.dark .cz-root {
          --cz-bg: #0b0a0a;
          --cz-card-bg: #16110f;
          --cz-card-border: rgba(255, 255, 255, 0.06);
          --cz-card-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
          --cz-head-border: rgba(255, 255, 255, 0.05);
          --cz-dot: rgba(255, 255, 255, 0.14);
          --cz-label: rgba(255, 224, 214, 0.55);
          --cz-sk-bg: rgba(255, 90, 54, 0.16);
          --cz-caption: rgba(255, 234, 226, 0.62);
        }
        .cz-viewport {
          width: 540px;
          max-width: 86%;
          overflow: hidden;
          -webkit-mask: linear-gradient(
            90deg,
            transparent 0%,
            #000 16%,
            #000 84%,
            transparent 100%
          );
          mask: linear-gradient(
            90deg,
            transparent 0%,
            #000 16%,
            #000 84%,
            transparent 100%
          );
        }
        .cz-track {
          display: flex;
          width: max-content;
          animation: cz-scroll 17s linear infinite;
        }
        .cz-card {
          flex: 0 0 280px;
          margin-right: 24px;
          height: 190px;
          display: flex;
          flex-direction: column;
          border-radius: 13px;
          overflow: hidden;
          background: var(--cz-card-bg);
          border: 1px solid var(--cz-card-border);
          box-shadow: var(--cz-card-shadow);
        }
        .cz-head {
          flex-shrink: 0;
          height: 32px;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 0 13px;
          border-bottom: 1px solid var(--cz-head-border);
        }
        .cz-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--cz-dot);
        }
        .cz-label {
          margin-left: 7px;
          font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
          color: var(--cz-label);
        }
        .cz-body {
          flex: 1;
          min-height: 0;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .cz-body .sk {
          border-radius: 5px;
          background: var(--cz-sk-bg);
          animation: cz-build 3.8s ease-in-out infinite;
        }
        .cz-body .sk.sk-accent {
          background: linear-gradient(90deg, #ff7048, #ff5a36);
        }
        .cz-caption {
          max-width: 320px;
          text-align: center;
          font-size: 12.5px;
          line-height: 1.55;
          letter-spacing: 0.01em;
          color: var(--cz-caption);
        }
        @keyframes cz-scroll {
          to {
            transform: translateX(-1520px);
          }
        }
        @keyframes cz-build {
          0% {
            opacity: 0.3;
            transform: translateY(5px) scale(0.92);
          }
          15% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          68% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          100% {
            opacity: 0.3;
            transform: translateY(5px) scale(0.92);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .cz-track {
            animation: none;
          }
          .cz-body .sk {
            animation: none;
            opacity: 1;
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}
