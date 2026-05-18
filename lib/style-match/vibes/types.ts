// Vibe briefs — structured design system specs that Kimi K2.6 interprets to
// emit ID-tagged ops against the user's HTML. Each brief is rich prose
// because the model is more accurate when told the design philosophy + signature
// elements + don'ts, not just a list of tokens.

export interface VibeBrief {
  /** Slug used in URLs / API / data attributes (e.g. "technical-dark"). */
  id: string;
  /** Display name in English (e.g. "Technical Dark"). */
  name: string;
  /** Display name in Spanish (e.g. "Técnico Oscuro"). */
  nameEs: string;
  /** One-line pitch in English. */
  tagline: string;
  /** One-line pitch in Spanish. */
  taglineEs: string;
  /** Famous site whose vibe inspired this brief — for UX context, not promises. */
  inspiration: string;
  /** Visual swatch for the gallery card (3 colors so we can render a preview chip). */
  preview: { bg: string; fg: string; accent: string };
  /** The full prose brief sent to Kimi. 300-700 words. */
  brief: string;
}
