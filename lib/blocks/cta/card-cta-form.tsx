/**
 * Source: Tailark (MIT) — call-to-action-3 pattern
 *   https://github.com/tailark/blocks
 * License: MIT — see /LICENSES/tailark.MIT.txt
 *
 * Adapted: form schema is structured (field name/placeholder/type) so the AI
 * can vary fields without writing JSX. Submit handling is the orchestrator's
 * concern at compose time — this block emits a real <form> with `method`
 * unset so the consumer can wire it up later.
 *
 * Slot constraints: ≤4 fields. Quality gate G2 (conversion) requires a
 * lead form to stay under 5 fields; we hard-cap here.
 */
import { z } from "zod";
import type {
  BlockComponent,
  BlockComponentProps,
  BlockMeta,
} from "../types";

const FIELD_TYPE = ["text", "email", "tel", "url", "textarea"] as const;

export const slotsSchema = z.object({
  title: z.string().max(80),
  sub: z.string().max(200).optional(),
  formFields: z
    .array(
      z.object({
        name: z
          .string()
          .max(40)
          .regex(/^[a-z][a-z0-9_-]*$/, "name must be kebab/snake, lowercase"),
        placeholder: z.string().max(60),
        type: z.enum(FIELD_TYPE),
        required: z.boolean().optional(),
      })
    )
    .min(1)
    .max(4),
  submitLabel: z.string().max(24),
  privacyNote: z.string().max(140).optional(),
});

export type Slots = z.infer<typeof slotsSchema>;

export const meta: BlockMeta<typeof slotsSchema> = {
  id: "cta/card-cta-form",
  displayName: "Card CTA with inline form",
  description:
    "Inline email-capture or contact form in a card. Hard-capped at four fields (quality gate G2). Use for waitlists, contact requests, demo bookings.",
  aesthetics: [
    "technical-minimal",
    "refined-editorial",
    "warm-humanist",
    "editorial-maximalist",
    "brutalist-technical",
  ],
  slotsSchema,
  exampleSlots: {
    title: "Get on the Kettle waitlist.",
    sub: "We're inviting the next 200 cohorts this quarter. Tell us a little — we'll be in touch within a week.",
    formFields: [
      { name: "email", placeholder: "you@company.com", type: "email", required: true },
      { name: "company", placeholder: "Company", type: "text", required: true },
      { name: "team_size", placeholder: "Team size (e.g. 12)", type: "text" },
    ],
    submitLabel: "Join waitlist",
    privacyNote: "We email once when you're invited, then never again unless you reply.",
  },
};

export const Component: BlockComponent<typeof slotsSchema> = ({
  slots,
  tokens,
}: BlockComponentProps<typeof slotsSchema>) => {
  return (
    <section
      aria-labelledby="cta-card-form-headline"
      style={{
        background: tokens.bg,
        color: tokens.text,
        fontFamily: tokens.fontBody,
      }}
      className="relative w-full"
    >
      <div className="mx-auto max-w-[1280px] px-6 py-16 sm:py-20 lg:py-24">
        <div
          className="mx-auto max-w-[640px] p-8 sm:p-10 lg:p-12"
          style={{
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            borderRadius: tokens.radius,
            boxShadow: tokens.shadow,
          }}
        >
          <h2
            id="cta-card-form-headline"
            className="text-balance text-2xl leading-tight tracking-tight sm:text-3xl lg:text-4xl"
            style={{
              fontFamily: tokens.fontDisplay,
              letterSpacing: "-0.025em",
              fontWeight: 600,
            }}
          >
            {slots.title}
          </h2>

          {slots.sub ? (
            <p
              className="mt-4 text-pretty text-base leading-relaxed"
              style={{ color: tokens.textMuted }}
            >
              {slots.sub}
            </p>
          ) : null}

          <form className="mt-8 flex flex-col gap-3">
            {slots.formFields.map((field) => {
              const id = `inari-form-${field.name}`;
              const sharedStyles = {
                background: tokens.bg,
                color: tokens.text,
                border: `1px solid ${tokens.border}`,
                borderRadius: tokens.radius,
              };
              return (
                <div key={field.name} className="flex flex-col gap-1.5">
                  <label htmlFor={id} className="sr-only">
                    {field.placeholder}
                  </label>
                  {field.type === "textarea" ? (
                    <textarea
                      id={id}
                      name={field.name}
                      placeholder={field.placeholder}
                      required={field.required}
                      rows={4}
                      className="w-full px-4 py-3 text-sm outline-none transition-colors focus:ring-2"
                      style={sharedStyles}
                    />
                  ) : (
                    <input
                      id={id}
                      name={field.name}
                      type={field.type}
                      placeholder={field.placeholder}
                      required={field.required}
                      className="w-full px-4 py-3 text-sm outline-none transition-colors focus:ring-2"
                      style={sharedStyles}
                    />
                  )}
                </div>
              );
            })}
            <button
              type="submit"
              className="mt-2 inline-flex items-center justify-center px-5 py-3 text-sm font-medium"
              style={{
                background: tokens.accent,
                color: tokens.accentFg,
                borderRadius: tokens.radius,
              }}
            >
              {slots.submitLabel}
            </button>
          </form>

          {slots.privacyNote ? (
            <p
              className="mt-4 text-xs leading-relaxed"
              style={{ color: tokens.textDim }}
            >
              {slots.privacyNote}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
};
