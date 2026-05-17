/**
 * Source: Tailark (MIT) — footer-2 pattern
 *   https://github.com/tailark/blocks
 * License: MIT — see /LICENSES/tailark.MIT.txt
 *
 * Adapted: columns are now a slot array (the AI picks Product / Company /
 * Resources / Legal as suits the brief); social links route through the
 * SOCIAL_PLATFORMS enum so the AI emits strings, not JSX.
 */
import { z } from "zod";
import { EditableText } from "../_editable";
import { SocialIcon } from "../_social";
import {
  SOCIAL_PLATFORMS,
  type BlockComponent,
  type BlockComponentProps,
  type BlockMeta,
} from "../types";

export const slotsSchema = z.object({
  logoText: z.string().max(24),
  tagline: z.string().max(140).optional(),
  columns: z
    .array(
      z.object({
        title: z.string().max(30),
        links: z
          .array(
            z.object({
              label: z.string().max(30),
              href: z.string(),
            })
          )
          .min(2)
          .max(8),
      })
    )
    .min(2)
    .max(4),
  socials: z
    .array(
      z.object({
        platform: z.enum(SOCIAL_PLATFORMS),
        href: z.string(),
      })
    )
    // Widened from 5 → 6 in S7 — three icons is the visual minimum that reads
    // as "social row" rather than "stray link", six is the cap before the row
    // wraps awkwardly on mobile. Most pages will use 2–4.
    .max(6)
    .optional(),
  copyright: z.string().max(140),
});

export type Slots = z.infer<typeof slotsSchema>;

export const meta: BlockMeta<typeof slotsSchema> = {
  id: "footer/four-col-links",
  displayName: "Four-column footer with social row",
  description:
    "Footer with brand block, 2-4 link columns, and an optional social-icon row. The standard page closer when there's more than one link group.",
  aesthetics: [
    "technical-minimal",
    "refined-editorial",
    "warm-humanist",
    "editorial-maximalist",
    "brutalist-technical",
  ],
  slotsSchema,
  exampleSlots: {
    logoText: "Folio",
    tagline: "A second brain for the writing you keep returning to.",
    columns: [
      {
        title: "Product",
        links: [
          { label: "Features", href: "#features" },
          { label: "Pricing", href: "#pricing" },
          { label: "Changelog", href: "#changelog" },
          { label: "Roadmap", href: "#roadmap" },
        ],
      },
      {
        title: "Resources",
        links: [
          { label: "Docs", href: "#docs" },
          { label: "API reference", href: "#api" },
          { label: "Community", href: "#community" },
          { label: "Status", href: "#status" },
        ],
      },
      {
        title: "Company",
        links: [
          { label: "About", href: "#about" },
          { label: "Careers", href: "#careers" },
          { label: "Blog", href: "#blog" },
          { label: "Press", href: "#press" },
        ],
      },
      {
        title: "Legal",
        links: [
          { label: "Privacy", href: "#privacy" },
          { label: "Terms", href: "#terms" },
          { label: "Security", href: "#security" },
        ],
      },
    ],
    socials: [
      { platform: "twitter", href: "https://twitter.com/folio" },
      { platform: "github", href: "https://github.com/folio" },
      { platform: "linkedin", href: "https://linkedin.com/company/folio" },
    ],
    copyright: "© 2026 Folio Labs Inc. All rights reserved.",
  },
};

export const Component: BlockComponent<typeof slotsSchema> = ({
  slots,
  tokens,
}: BlockComponentProps<typeof slotsSchema>) => {
  return (
    <footer
      style={{
        background: tokens.bg,
        color: tokens.textMuted,
        fontFamily: tokens.fontBody,
        borderTop: `1px solid ${tokens.border}`,
      }}
      className="relative w-full"
    >
      <div className="mx-auto max-w-[1280px] px-6 py-16 sm:py-20">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <div
              className="text-xl font-medium tracking-tight"
              style={{
                fontFamily: tokens.fontDisplay,
                letterSpacing: "-0.025em",
                color: tokens.text,
              }}
            >
              <EditableText slot="logoText">{slots.logoText}</EditableText>
            </div>
            {slots.tagline ? (
              <p
                className="mt-3 max-w-[280px] text-sm leading-relaxed"
                style={{ color: tokens.textMuted }}
              >
                <EditableText slot="tagline">{slots.tagline}</EditableText>
              </p>
            ) : null}

            {slots.socials && slots.socials.length > 0 ? (
              <ul role="list" className="mt-6 flex gap-2">
                {slots.socials.map((s) => (
                  <li key={s.platform}>
                    <a
                      href={s.href}
                      aria-label={s.platform}
                      className="inline-flex h-9 w-9 items-center justify-center transition-colors"
                      style={{
                        color: tokens.textMuted,
                        border: `1px solid ${tokens.border}`,
                        borderRadius: tokens.radius,
                      }}
                    >
                      <SocialIcon platform={s.platform} size={16} />
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {slots.columns.map((col, ci) => (
            <nav key={col.title} aria-label={col.title}>
              <h3
                className="text-xs font-medium uppercase tracking-wider"
                style={{ color: tokens.textDim }}
              >
                <EditableText slot={`columns[${ci}].title`}>{col.title}</EditableText>
              </h3>
              <ul role="list" className="mt-4 space-y-2.5">
                {col.links.map((link, li) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm transition-colors"
                      style={{ color: tokens.textMuted }}
                    >
                      <EditableText slot={`columns[${ci}].links[${li}].label`}>{link.label}</EditableText>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div
          className="mt-14 flex items-center justify-between pt-6 text-xs"
          style={{
            borderTop: `1px solid ${tokens.border}`,
            color: tokens.textDim,
          }}
        >
          <span>
            <EditableText slot="copyright">{slots.copyright}</EditableText>
          </span>
        </div>
      </div>
    </footer>
  );
};
