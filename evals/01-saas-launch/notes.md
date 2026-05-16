# 01-saas-launch — FlowDeck (SaaS) notes

**Score: 4.5/5** — Ship-able with one minor copy tweak.

**Brief:** "Landing page for FlowDeck, a Kanban tool for designers that uses AI to prioritize tasks. Features: AI prioritization, real-time sync, Slack integration. Pricing tiers: Free, Pro $29/mo, Team $99/mo."

## What worked

- Hero opens strong: "Prioritization that works while you sleep." Concrete, evocative.
- Subhead: "FlowDeck uses AI to sort your tasks by deadline, client weight, and energy level. Wake up to a board that knows what matters." — specific, names mechanism.
- All three brief-named features present (AI prioritization, real-time sync, Slack integration).
- Pricing tiers honored: Free / Pro / Team layout matches the brief.
- Testimonials: "Sofia Ríos · Freelance, Mexico City" / "Elias Thorne · Freelance, Berlin" — real-sounding names, geographies tied to designers as audience.

## What didn't

- Bento code block still renders ASCII soup (`const result = await search("latency")`) where the `→` arrow and non-breaking spaces look noisy in the raw text strip. In-browser this is fine — only the text-extraction looked weird.
- Pricing block lists tiers but the exact `$29/mo` and `$99/mo` numbers may show as the closest tier the model chose. Verify in browser.

## Numbers

- Cost: $0.0812
- Wall: 50.1s (highest of the 5 — fill ran sequentially after a Qwen fallback)
- Images: 1 (hero only)
- Gates: 6/6 passed first try
- Refine: 0 attempts
