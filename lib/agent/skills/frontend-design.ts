/**
 * What the frontend-design skill adds to OpenLen's design guide (spec local 2026-10-27-len-five-skills,
 * §4.2).
 *
 * Adapted from Anthropic's `frontend-design` skill (github.com/anthropics/skills,
 * skills/frontend-design/SKILL.md), Apache License 2.0: see LICENSES/anthropic-skills.Apache-2.0.txt.
 * Changes: shortened; only what doesn't contradict OpenLen's design guide, which comes first in the
 * skill and wins where they differ; the screenshot critique is Len's view_page; addressed to pages and
 * apps built here.
 */
export const FROM_CLAUDE_FRONTEND_DESIGN = `MORE ON DESIGN (from Claude's frontend-design; where it differs from the guide above, the guide wins):
- Ground the design in its subject. If the request doesn't say what the business is, who it is for and what the page must do, settle those three first — from /LEN.md, the business memory and the request — and say what you assumed. Distinctive choices come from the subject's own world: its materials, its vernacular, its audience.
- Calibration. Generated pages cluster around a few defaults; each is fine when the brief asks for it, and a tell when it shows up regardless of the subject:
  1. a warm cream background with a high-contrast serif display and a terracotta or clay accent;
  2. a near-black background with one acid-green or vermilion accent;
  3. a broadsheet layout of hairline rules, square corners and dense newspaper columns;
  4. the SaaS card kit: everything in identical rounded cards with the same soft shadow and gradient washes;
  5. template chrome: a tracked-out ALL-CAPS eyebrow over every heading, meta joined with middle dots, a "→" on every link.
  Where the brief pins a direction, follow it exactly; where it leaves an axis free, don't spend that freedom on one of these.
- Plan, check, then build. Before writing a page from scratch, write a short plan: the palette as 4–6 named hex values, the typefaces and their roles, the layout in a sentence (and a rough wireframe if it helps), and what makes this page this business's. Read it back against the request: any part you would have produced for any similar page, change, and say what you changed.
- Spend boldness in one place. Let one element be the memorable thing and keep the rest quiet; cut decoration that doesn't serve the request. One orchestrated moment of motion lands better than an entrance on every section. A quality floor without announcing it: works on mobile, visible keyboard focus, reduced motion respected, readable contrast.
- Look at it. Render it with view_page and critique what you see before you call it done.
- Words are design. Write from the visitor's side, in plain words: a button says what happens ("Book a table", not "Submit"), an action keeps its name through the flow, an error says what went wrong and how to fix it, an empty state invites the next step. Sentence case, no filler.`;
