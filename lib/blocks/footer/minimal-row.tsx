/**
 * Source: HyperUI (MIT) — minimal footer pattern
 *   https://github.com/markmead/hyperui
 * License: MIT — see /LICENSES/hyperui.MIT.txt
 *
 * Adapted: single-row footer for tight, brutalist or technical-minimal pages
 * where a 4-col block would be visual overkill.
 */
import { z } from "zod";
import { SocialIcon } from "../_social";
import {
  SOCIAL_PLATFORMS,
  type BlockComponent,
  type BlockComponentProps,
  type BlockMeta,
} from "../types";

export const slotsSchema = z.object({
  logoText: z.string().max(24),
  copyright: z.string().max(140),
  links: z
    .array(
      z.object({
        label: z.string().max(30),
        href: z.string(),
      })
    )
    .max(6)
    .optional(),
  socials: z
    .array(
      z.object({
        platform: z.enum(SOCIAL_PLATFORMS),
        href: z.string(),
      })
    )
    .max(5)
    .optional(),
});

export type Slots = z.infer<typeof slotsSchema>;

export const meta: BlockMeta<typeof slotsSchema> = {
  id: "footer/minimal-row",
  displayName: "Minimal single-row footer",
  description:
    "One row: brand text, ≤6 inline links, ≤5 socials, copyright. Use when the page already says everything and the footer should disappear.",
  aesthetics: ["technical-minimal", "brutalist-technical"],
  slotsSchema,
  exampleSlots: {
    logoText: "Glass",
    copyright: "© 2026 Glass Labs",
    links: [
      { label: "Docs", href: "#docs" },
      { label: "Pricing", href: "#pricing" },
      { label: "Status", href: "#status" },
      { label: "Privacy", href: "#privacy" },
    ],
    socials: [
      { platform: "twitter", href: "https://twitter.com/glass" },
      { platform: "github", href: "https://github.com/glass" },
    ],
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
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
          <span
            className="text-base font-medium tracking-tight"
            style={{
              fontFamily: tokens.fontDisplay,
              letterSpacing: "-0.02em",
              color: tokens.text,
            }}
          >
            {slots.logoText}
          </span>
          <span className="text-xs" style={{ color: tokens.textDim }}>
            {slots.copyright}
          </span>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
          {slots.links && slots.links.length > 0 ? (
            <nav aria-label="Footer">
              <ul role="list" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                {slots.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      style={{ color: tokens.textMuted }}
                      className="transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          {slots.socials && slots.socials.length > 0 ? (
            <ul role="list" className="flex items-center gap-2">
              {slots.socials.map((s) => (
                <li key={s.platform}>
                  <a
                    href={s.href}
                    aria-label={s.platform}
                    className="inline-flex h-8 w-8 items-center justify-center transition-colors"
                    style={{
                      color: tokens.textMuted,
                      border: `1px solid ${tokens.border}`,
                      borderRadius: tokens.radius,
                    }}
                  >
                    <SocialIcon platform={s.platform} size={14} />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </footer>
  );
};
