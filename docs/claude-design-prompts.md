# 197 pages via 39 prompts — claude.ai design briefs

Thirty-nine prompts to paste into claude.ai (Opus 4.7) under your Max 20x subscription. Each prompt produces **5–6 distinct, production-quality pages** as separate `text/html` artifacts in a single conversation. Total: **197 pages** across 39 aesthetic briefs (Prompts 1–32 are marketing landings; Prompts 33–37 are link-in-bio creator hubs; Prompts 38–39 are booking & newsletter, 6 variants each).

## How to use

For each prompt below:

1. Open claude.ai → New chat → Opus 4.7
2. Paste the **Shared output constraints** block (immediately below). One paste per conversation.
3. Paste **one of the prompts**. claude.ai produces 5 artifacts.
4. Click each artifact's download icon → save as `.html`.
5. Hand the HTML(s) over here (Claude Code) — I'll create projects + you publish via the Deploy dropdown.

If the conversation runs out of message length mid-prompt, type "continue with the next variant" and claude.ai picks up.

If a variant comes out wrong, type `redo variant N with [change]` and claude.ai regenerates just that one.

---

## Shared output constraints (paste ONCE at the top of every conversation)

```
You are designing premium informational landing/marketing pages at the level of Linear, Vercel, Stripe, Resend, and Cal.com.

OUTPUT FORMAT — read carefully:
- Each variant is a SEPARATE artifact of type `text/html`. Not `application/vnd.ant.react`, not JSX, not MDX.
- Single self-contained `<!doctype html>` file per variant.
- Tailwind via CDN: <script src="https://cdn.tailwindcss.com"></script>
- Google Fonts via <link> in <head> (specify families per brief).
- All custom CSS inline in <style> inside <head> — animations, gradients, custom utility classes.
- NO React, NO Babel, NO <script type="text/babel">, NO `window.X` globals, NO JSX.
- NO `data-slot-path=` attribute anywhere (would conflict with our editor pipeline).
- NO login / signup / sign-out / "my account" / dashboard UI of any kind. These are PUBLIC informational marketing pages only.
- All copy is real-sounding. NO Lorem ipsum. NO generic phrases like "Streamline your workflow", "Built for teams", "The future of X", "Empower your business". Use specific numbers, fictional but believable metrics, specific feature claims.
- All images: inline SVG (logos, illustrations, icons) or `<div>` with `bg-gradient-to-br` as a placeholder for hero shots. NO external image URLs (unsplash, etc).
- Mobile-responsive at 360px minimum width.
- Lift-on-hover transitions for buttons (50-150ms ease).
- One mode per variant — pick the mode that best fits the brand (dark, light, cream, etc.) per the brief. Do not include a theme toggle.

DESIGN TOKENS (the OpenLen contract — every color/radius/font resolves from a var; see docs/openlen-contract.md):
- Declare these on :root (your chosen mode's values) + a :root.dark { } flip, and reference them via var() everywhere: --bg, --surface, --surface-2, --fg, --fg-muted, --fg-faint, --border, --border-strong, --accent, --accent-r (COMMA R,G,B triplet, e.g. 62,207,142, for rgba(var(--accent-r), <a>)), --accent-ink (text/icons that sit ON the accent), --radius, --font-display, --font-body, --font-mono.
- NO raw hex (#rrggbb) outside the :root / :root.dark blocks — define a token, then use var(--…). Neutral rgba textures/shadows + the hairline border alphas are fine.
- Exactly ONE accent. Text on the accent uses var(--accent-ink), never a hardcoded hex. Status colors (if any) are --warn / --danger, NOT a second accent.

VISUAL QUALITY BAR:
- Headlines have a "half-tone" trick: split into two parts, the second part rendered at ~45% opacity (e.g. "See what your agents <span class='opacity-45'>actually did.</span>"). Use sparingly, not on every headline.
- Live-feel indicators: `pulse-dot` animation (radial expanding shadow on a small colored dot).
- Marquee animations for logo clouds (infinite horizontal scroll).
- Subtle ambient backgrounds: radial-gradient fades, dot-grid backgrounds at 32px tiles, blurred mesh blobs.
- Hairline borders at `rgba(255,255,255,0.06)` on dark / `rgba(0,0,0,0.08)` on light.
- Procedural SVG visualizations when the brief calls for them (sparklines, trace waterfalls, branch trees, flame charts) — compute paths in inline JS at render time IS OK (one small script block at end of body to set d= attrs on SVG paths from data arrays). But NO React, NO framework JS.
- Typography: tight letter-spacing on display (-0.025 to -0.04em), tabular-nums on metrics, OpenType features `ss01`, `cv11` on Inter.

CONTENT QUALITY BAR:
- Customer wordmarks (logo cloud): fictional but believable. Mix of serif and sans wordmarks. 6-8 names per page. Examples: Linnea, Forecast, Glide, Vantage, Mercury, Brightwave, Nimbus, Coast, Halcyon, Quartermast, Northwind, atrium, Foundry & Co.
- Testimonial names: real-sounding international mix. Examples: Priya Anand (Staff Engineer at Linnea), Marcus Tobin (Founding Engineer at Forecast), Hana Suzuki (ML Lead at Glide), Yusuf Abara (CTO at Mercury), Ines Calderón (Head of Eng at Brightwave).
- Metrics: specific, believable, NOT round numbers. Use 12,408 not 12K. Use $0.0064 not $0.01. Use −38% vs Tue not "down 40%". Use 1.18s P95 not 1s.
- Headlines: 6-12 words, punchy, opinionated. Avoid generic claims.
- Sub-headlines: 18-30 words, specific value prop with a concrete detail.
- Pricing tiers: real-feeling tier names (not Free/Pro/Enterprise — vary it: Hobby/Pro/Team, Indie/Studio/Agency, Solo/Squad/Org, etc.)
- FAQ questions: ones a sophisticated buyer would actually ask. NOT "How much does it cost?". Examples: "How does X compare to Y under load?", "What's your data retention policy?", "Can I redact PII before it leaves my infra?"

When you produce the 5 artifacts, each in this single response if possible, label them clearly: "Variant 01: ProductName", "Variant 02: ProductName", etc. Do not bundle them with a tab switcher into one artifact — five separate artifacts.

Confirm you understand. Then I'll send the specific brief.
```

After claude.ai confirms, send the prompt below for the family you want.

---

## Prompt 1 — Technical Minimal Devtools (5 dark-mode pages)

```
Brief: Produce 5 landing pages in the "Technical Minimal" aesthetic — the cross between Linear, Vercel, and Tide.

SHARED AESTHETIC (all 5 variants):
- Mode: dark. Background #0F0F0F (or #08090A or #000000 for one mono variant).
- Display: Inter, weights 500-700, letter-spacing -0.035em, line-height 0.98, font-feature-settings "ss01" "cv11".
- Body: Inter 400-500.
- Mono: Geist Mono 400-500 — used for badges, timestamps, code, metrics labels.
- Hairline borders rgba(255,255,255,0.06).
- 32px dot-grid bg pattern (`linear-gradient(rgba(255,255,255,0.035) 1px, transparent)` × 2 axes).
- Radial-fade-{accent} class behind hero: `radial-gradient(60% 50% at 50% 0%, <accentRGB at 10%>, transparent 70%)`.
- pulse-dot keyframes for "live" indicators.
- Lift-on-hover for CTAs.

SHARED SECTION SKELETON (all 5 variants follow this order):
1. Sticky nav: wordmark logo (custom inline SVG) + 4 nav links (Product, Docs, Changelog, Pricing) + Sign-in link (text only, NO modal) + accent CTA pill ("Start tracing free" / "Try X" / etc.) with chevron-right.
2. Hero: pill badge (mono, with pulse-dot — e.g. "v2.4 · OpenTelemetry-native"), display headline 6-10 words with half-tone trick on the second clause, sub paragraph 25 words, dual CTA (primary accent solid + secondary outline), inline mono hint ("$ npm i product-sdk"), then a 2-col grid: BIG product mockup tile (left, 1.35fr) + stats card (right, 1fr).
3. Logo cloud / trust bar: bordered top + bottom, mono "TRACING X IN PRODUCTION AT" label + marquee row of 8 fictional customer wordmarks.
4. Bento features grid (12-col, 2-row): ONE large 7-col tile spanning 2 rows + four smaller tiles (5-col, 5-col, 3-col + 4-col, 5-col). Each tile has icon + mono uppercase eyebrow + h3 + paragraph + signature visualization (charts, code snippets, pill rows).
5. Big alternating feature: 2-col split. Left has a dashboard mockup with tabs (Overview / Spans / Evals / Costs etc.) + metric grid + line chart. Right has eyebrow + display h2 + paragraph + bullet list with accent dots + accent text link "Read the X guide →".
6. Pricing: 3-tier ($0 / $49 / $249 ranges). Middle is featured with accent ring + "Most popular" pill anchored to its top-left corner. Each tier: name + price (5xl tracking-tighter) + period + blurb + dotted divider + 4-5 features with accent checks + CTA button.
7. Testimonials: max-w-2xl display h2 + 3-col grid of testimonial cards. Each card: 5 accent stars + blockquote + circle avatar with initials + name/role/company.
8. FAQ: 2-col split. Left = mono eyebrow + display h2 ("Frequently asked, honestly answered."). Right = 5 native <details> with accent plus icon that rotates to × on open.
9. Final CTA: rounded-2xl section with grid-bg + radial-fade. Display h2 with half-tone trick + sub + dual CTA + Talk to sales outline button.
10. Footer: 5-col grid. Brand col (wordmark + tagline + status pill) + Product / Developers / Company link cols. Bottom row with copyright + Privacy/Terms/DPA + version.

VISUAL FLOURISHES SPECIFIC TO TECHNICAL MINIMAL (use across the 5 as appropriate):
- Terminal mockup with command + output lines, mono cells in a 4-col grid for timestamps/severity/message/duration, blinking caret at end.
- Procedural sparkline SVG (24 points, area fill via linearGradient at accent 25%→0%, stroke 1.5px accent).
- Trace waterfall: grid-cols-[260px_1fr_56px], indented rows with vertical guides, colored bars positioned by left% + width%.
- Eval chart: 2-line SVG (baseline gray + current accent), gridlines dashed 0.05 opacity.
- Code snippets in <pre> with mono font, comment lines in white/40, accent for keywords.
- "live" pulse-dots inline with mono labels.

THE 5 VARIANTS — produce one text/html artifact per variant in this conversation:

VARIANT 01: Mirror — Runtime guardrails for LLM applications.
- Accent: emerald #3ECF8E (same as Tide). Logo: a stylized eye / iris in concentric arcs.
- Pitch: "Catch your AI breaking the rules before your users do." Half-tone version: "Catch your AI <muted>breaking the rules</muted> before your users do."
- Audience: engineering teams shipping LLM agents to production at series-A startups.
- Hero mockup: live policy enforcement timeline — rows like "policy.pii_redact PASS 4ms", "policy.toxicity BLOCK confidence=0.94", "policy.tool_allowlist PASS 1ms", with one row in amber retry. Right card: 4 metrics (Sessions guarded, Policy violations, P95 eval latency, False positive rate).
- Bento tiles: rule editor mockup (YAML with syntax-highlighted keys), real-time violation feed with severity dots, redaction diff viewer (before/after), policy template gallery (4 cards), SDK code snippet (`import {guardrail} from "mirror-sdk"`), alert routing tile.
- Big feature: "Eval-as-policy" — dashboard with tabs Policies/Violations/Audit + line chart of false-positive rate dropping.
- Pricing tiers: Sandbox (free, 100k requests), Pro ($49, 5M requests + audit log), Enterprise ($249, BYOC + SOC2 + SCIM).
- FAQ Q's: "How is a 'guardrail evaluation' billed?", "Do you run guardrails in-process or as a sidecar?", "Can I write custom rules in TypeScript?", "What's your latency overhead in the proxy mode?", "How do you handle PII in logs?".
- Customer logo names: Linnea, Forecast, Glide, Mercury, Brightwave, Nimbus, Coast, Vantage.

VARIANT 02: Anchor — Database branching for staging environments.
- Accent: indigo #5E6AD2 (Linear-style). Logo: stylized anchor or branch fork.
- Pitch: "Branch your Postgres like Git. Stage every PR against real data."
- Audience: backend engineers tired of cleanup scripts on shared staging dbs.
- Hero mockup: git-style branch tree visualization (main → feat/checkout-rev2 → fix/migration-3) with row counts, sizes, and "30s to create" tags. Right card: 4 metrics (Active branches, Avg branch creation, Storage saved via CoW, Migration test passes today).
- Bento tiles: branch list with author + duration, query playground mockup (SQL + result table), schema diff viewer (red/green lines), migration test runner with green checks, "git push" → branch auto-spawn CTA tile, role-based access mockup.
- Big feature: "Migration safety net" — dashboard with tabs Branches/Queries/Diffs + bar chart of branch lifetimes.
- Pricing: Hobby (free, 3 branches), Team ($29/seat, 50 branches + roles), Scale ($249, unlimited + audit log + SSO).
- FAQ Q's: "How does copy-on-write storage actually work under the hood?", "What's the cold-start time on a new branch?", "Does it support Postgres extensions like pgvector?", "How do you handle long-running transactions during branch cut?", "What's the maximum branch tree depth?".
- Customer names: Halcyon, Quartermast, Atrium, Stratos, Pavilion, Beacon, Spool, Lighthouse.

VARIANT 03: Pulse — Real-time error tracking with session replay.
- Accent: magenta #E5407B. Logo: a stylized heart-rate spike or radio wave.
- Pitch: "See the bug. Not the stack trace."
- Audience: frontend & full-stack engineers debugging in production.
- Hero mockup: session replay player UI — timeline scrubber at bottom, video-frame placeholder of a fake checkout flow, breadcrumb side panel ("click → 14:02", "fetch /api/refund → 500", "error: stripe.refund undefined"). Right card: 4 metrics (Sessions captured, Errors caught, MTTR P50, Replay open rate).
- Bento tiles: error timeline with severity heatmap, breadcrumb log viewer with timestamps, stack trace with source-map view, console output mockup, "issue grouping" cluster viewer, alert routing to Slack/PagerDuty.
- Big feature: "Replay-first debugging" — dashboard with tabs Errors/Sessions/Performance + waterfall of network calls.
- Pricing: Solo (free, 5k sessions), Team ($39/seat, 100k + replay), Org ($249, SAML + audit + BYOC).
- FAQ Q's: "How do you mask sensitive form fields during replay?", "What's your storage retention for video?", "Does it work with React Native?", "How is bundle size impacted by the SDK?", "Can I export sessions to my own S3?".
- Customer names: Drift, Folio, Receipts, Northwind, Cassette, Lattice, Folio Press, Halcyon Studio.

VARIANT 04: Compass — Service mesh observability for Kubernetes.
- Accent: cyan #00D4D4. Logo: a stylized compass rose or radial graph.
- Pitch: "See every hop in your cluster. Without rebuilding your stack."
- Audience: platform engineers running 50+ services on k8s.
- Hero mockup: service topology graph — nodes connected by directed edges, RPS labels on edges, error rate badges on nodes (1.2%, 0.04%, etc.). Right card: 4 metrics (Services tracked, Spans/sec, P95 mesh latency overhead, Active alerts).
- Bento tiles: trace flame chart, latency heatmap (services × time), dependency map, mTLS status grid (all green except one yellow), retry budget config, sidecar resource usage chart.
- Big feature: "Zero-config tracing" — dashboard with tabs Traces/Latency/Errors/Saturation + flame chart of a sample request crossing 7 services.
- Pricing: Cluster (free, 1 cluster), Multi-cluster ($199, 10 clusters + alerting), Fleet ($499/mo, unlimited + audit + air-gap option).
- FAQ Q's: "Does it require sidecar injection or can I use Envoy at the ingress?", "What's the CPU/memory overhead per pod?", "Can I export traces to my existing Jaeger?", "How do you handle multi-tenancy in a shared cluster?", "Does it work on EKS Fargate?".
- Customer names: Crucible, Cinder, Foundry & Co, Cargo, Strata, Lattice Cloud, Volt, Beacon Labs.

VARIANT 05: Kiln — CI/CD platform built for monorepos.
- Accent: amber #F5C26B. Logo: a stylized flame or geometric brick.
- Pitch: "Build only what changed. Cache like you mean it."
- Audience: platform & DX teams running large pnpm/Bazel/Nx monorepos with 50+ packages.
- Hero mockup: pipeline DAG visualization — nodes are jobs (lint, typecheck, test, build, deploy), edges show dependencies, some nodes pulsing "running" in amber. Right card: 4 metrics (Avg build time, Cache hit ratio, Parallel jobs P95, Cost per build).
- Bento tiles: pipeline editor (YAML with collapsible step blocks), cache hit chart (line going from 30% → 89%), parallel job timeline (gantt chart), affected-package detector ("3 of 47 packages changed"), preview env spawn config, deploy approval queue.
- Big feature: "Smart task graph" — dashboard with tabs Builds/Cache/Deploys + DAG showing dependency-aware execution skipping 39 of 47 packages.
- Pricing: Hobby (free, 100 build mins/mo), Pro ($49/seat, 5k mins + cache), Enterprise ($299, unlimited + SSO + private runners).
- FAQ Q's: "How does it compare to Turborepo or Nx Cloud?", "Can I bring my own self-hosted runners?", "What's the protocol for the remote cache (HTTP/gRPC)?", "Does it support Bazel rule_oci out of the box?", "How do you handle secret injection during builds?".
- Customer names: Cargo, Spool, Folio, Beacon, Nimbus Labs, Mercury Build, Forecast Engineering, Linnea Platform.

Produce all 5 as separate text/html artifacts in this single response.
```

---

## Prompt 2 — Editorial / Publications (5 pages, mixed modes per variant)

```
Brief: Produce 5 landing pages in the "Editorial" aesthetic — magazine-quality typography, numbered sections, serif headlines with italic accents. Cross between Stripe's editorial pages, The Browser Company's blog, and a high-end print magazine.

SHARED AESTHETIC (all 5 variants):
- Display: Source Serif 4 (`'Source Serif 4', Georgia, serif`), optical-sizing auto, weights 400 + 500. Italic emphasis available via <em> with `font-feature-settings: "ss01"`.
- Sans accent: Inter 400-500.
- Mono: JetBrains Mono 400-500 — for section numbers, dates, metadata only.
- Tight leading on display: `line-height: 0.92; letter-spacing: -0.025em`.
- Numbered section dividers: "§ 01 · A note from the desk", "§ 02 · How it works" — mono uppercase tracking-[0.18em] with an inline hairline rule.
- Drop-cap class for opening paragraphs: serif first-letter at 4.5em, line-height 0.85, floating left.
- Pull-quote sections with the quote at display size (clamp(40px,5.6vw,88px)) and italic emphasis on key words.
- Subtle "rule" lines at currentColor opacity 0.12.
- Mesh-gradient ambient backgrounds (radial-gradient blobs at ~10% opacity) on hero only.
- "Link-ed" hover underline animation that grows from right to left on link hover.

SHARED SECTION SKELETON:
1. Top-of-page tabbar fixed to top: pill with wordmark + faded mono "§ 01/03" + 3 section anchor links.
2. Nav within the hero (NOT sticky — flows with content): wordmark left + 4 link items + accent CTA pill.
3. Hero: mono eyebrow with "§ 01 · {tagline}", display headline (max 14ch wrapping), 2-col grid below with paragraph (max 58ch) left + dual CTA + secondary link right, then a "hero metric strip" with 4 columns separated by a hairline rule above (each: mono label, large tabular number, sub-detail).
4. Pull-quote section: bordered top + bottom + tinted bg, mono "§ 02 · A note from the desk", giant blockquote with italic accent on key phrase, attribution line below.
5. Features as alternating prose paragraphs: 2-3 sections, each with a serif h2 ("In one line"), supporting paragraph, and a small inline mockup or product detail card on the side.
6. Comparison split or methodology timeline (depending on product): 2-col side-by-side OR a vertical timeline with year markers (mono).
7. Pricing: 2-tier (intentionally curated, not 3) — feels more "premium private practice" than SaaS pricing. Each tier has a serif name + price + small list + serif CTA link.
8. Testimonials as quote cards: 2-col grid OR a single rotating featured quote. Display the quote in serif italic, attribution in mono uppercase.
9. FAQ: 5 questions, serif Q's with mono "§ FAQ.01" labels, sans answers below in indented prose.
10. Final CTA: bordered top hairline, serif display h2 with italic accent, sub paragraph, dual CTA (one filled, one serif link).
11. Footer: minimal 3-col grid + mono copyright line + ISSN-style version line.

VISUAL FLOURISHES:
- Drop-caps in 1-2 prose paragraphs across each page (don't overuse).
- Numbered section markers ("§ 01", "§ 02", "§ 03") as you transition between sections.
- "Accent line" inline element: `width: 28px; height: 1px` before mono labels.
- Italic emphasis on 1 key word per headline, colored in the accent.
- Tabular numbers for metric strip — `font-variant-numeric: tabular-nums`.
- Use <em class="editorial"> for italic emphasis with `font-feature-settings: "ss01"` to swap to the alternate italic glyph.

THE 5 VARIANTS:

VARIANT 01: Foundry — A long-form magazine for engineering culture.
- Mode: warm dark. Bg #0A0A0A. Text #F2EFEA. Accent (italic emphasis color): warm orange #F97316.
- Pitch: "Engineering, written like it matters." With italic emphasis on "like it matters."
- Audience: senior engineers and engineering leaders who read more than they tweet.
- Hero metric strip: 4 columns — Subscribers (28,408), Avg read time (11min), Pieces published / year (52), Featured contributors (47).
- Pull-quote: "We don't write about tools. We write about <em>the people who use them</em>." Attribution: "— Editor's note, Issue 01"
- Featured pieces section: 3 essay cards with serif title + byline + mono date + 1-line summary.
- Pricing: Member ($60/year) + Patron ($240/year, founders' edition + IRL meetups).
- Footer: ISSUE 047 · WINTER 2026 · ISSN 2789-4471 (mono).

VARIANT 02: Manuscript — A newsletter platform for serious writers.
- Mode: paper white. Bg #FAFAF9. Text #1A1714. Accent: warm sienna #B36A3A.
- Pitch: "Where readers actually <em>read</em>."
- Audience: long-form writers who hate Substack's growth-hack vibe and want quiet craft tools.
- Hero metric strip: Writers on platform (1,402), Avg subscribers per writer ($1.2M aggregate revenue), Median issue length (1,800 words), Open rate average (62%).
- Pull-quote: "A newsletter is a private channel between one writer and a few hundred readers. Treat it with that <em>respect</em>."
- Tools section: writing editor screenshot (serif body, distraction-free), audience analytics minimal grid, subscriber import flow.
- Pricing: Solo ($12/mo, 1k subs) + Studio ($39/mo, unlimited subs + custom domain).
- Footer: minimal — wordmark + "Made in Brooklyn & Lisbon" + copyright.

VARIANT 03: Aperture — A photography portfolio publishing platform.
- Mode: pure dark (#000000) with photography-first layout. Text #FFFFFF. Accent: muted gold #C8A88A.
- Pitch: "Your work, in its proper proportions."
- Audience: working photographers tired of Squarespace's template-y feel.
- Hero: image-first — large 16:9 placeholder div with `bg-gradient-to-br` simulating a hero photograph, then small overlaid caption ("Vol. 12 · Light, January 2026 · Hana Ito"), THEN the typography below.
- Hero metric strip: Portfolios live (8,408), Avg portfolio pieces (24), Galleries published this month (1,402), Press features (38 publications).
- Pull-quote: photograph credit-style — "Print sells the picture. The web <em>frames</em> it."
- Section: "Built for photographers, not webflow" — sample layouts (full-bleed, diptych, grid-of-12) shown as wireframe-like SVGs.
- Pricing: Folio ($14/mo, 50 pieces) + Atelier ($39/mo, unlimited + commerce).
- Footer: minimal with privacy/terms/printing-partners links.

VARIANT 04: Quill — Tech essays and thought leadership for engineering leaders.
- Mode: cream paper. Bg #F5F1EA. Text #1F1B16. Accent: forest green #4F8259.
- Pitch: "The essays your team should actually <em>read</em>."
- Audience: heads-of-eng, VPs, principal engineers who hire and shape culture.
- Hero metric strip: Subscribed teams (1,408), Avg seats per team (24), Featured authors (47 industry voices), Annual essays (78).
- Pull-quote: "If a single essay changes how your team works for a quarter, that's <em>better than any conference</em>."
- Featured authors grid: 6 cards with serif name + mono role + portrait placeholder.
- Pricing: Team ($14/seat/mo, 5+ seats) + Org ($9/seat/mo, 50+ seats with custom essay requests).
- Footer: 4-col with About / Authors / Archives / Press.

VARIANT 05: Loom — Audio essays for people who'd rather listen than scroll.
- Mode: dark navy. Bg #0E0E14. Text #F4F2EE. Accent: muted lavender #C8A8E0.
- Pitch: "Read with your ears. <em>Properly</em>."
- Audience: professionals who commute or walk and prefer audio over text.
- Hero: instead of metric strip, a waveform visualization (SVG path approximating audio waveform across 24 bars) with a play button overlay + featured episode card ("Episode 28 · On second drafts · 14 min · 1,408 listens this week").
- Hero metric strip: Episodes published (240), Total listening hours this month (28,408), Avg episode length (14 min), Subscribers (8,408).
- Pull-quote: "The voice carries what the page can't. The pause is <em>punctuation</em>."
- Featured episodes section: 4 episode cards with serif title + duration + waveform mini SVG.
- Pricing: Free (with ads, 1 episode/week) + Member ($8/mo, ad-free + bonus content + transcripts).
- Footer: links to podcast apps (Apple Podcasts, Spotify, Overcast, RSS), simple 3-col.

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 3 — Point of Sale / Commerce (5 pages, mixed modes)

```
Brief: Produce 5 landing pages for point-of-sale / commerce / payment / marketplace products. Modern retail tech feel — Square, Toast, Shopify Hardware level. Heavy on product mockups (POS terminal, receipt printer, payment flow, inventory dashboard).

SHARED AESTHETIC (all 5 variants):
- Display: Inter Display 600-700, letter-spacing -0.03em.
- Body: Inter 400-500.
- Mono: Geist Mono 400-500 — used sparingly for receipts, SKUs, transaction IDs.
- Tactile feel: 12-16px border radius on cards, soft drop shadows on product mockups, hairline borders.
- Hardware mockups: stylized SVG of a tablet POS, receipt printer, card reader — always shown at a slight 3D rotation (CSS transform: rotateY(-8deg) rotateX(4deg)).
- Receipt mockup: mono font on cream paper texture, dotted dividers, SKU lines with quantity × unit price = total.
- Lift-on-hover for CTAs.

SHARED SECTION SKELETON:
1. Sticky nav: wordmark + 4 nav links + Sign-in text link + accent CTA pill.
2. Hero: pill badge + display headline (with hardware emoji vibe — but use SVG icons not emoji) + sub + dual CTA + hardware/product mockup. The mockup should be ~50% of hero width on desktop, side-by-side with the text.
3. Trust bar: "Used at 8,408 locations" + 6-8 customer wordmarks in a marquee.
4. Features 3-col grid: each col has an icon + serif/sans h3 + paragraph + sub-bullet list with checkmarks.
5. Hardware showcase OR payment-flow diagram OR inventory dashboard OR marketplace storefront — varies per variant. Should be a CENTERPIECE visual.
6. Stats banner: 4 large metric cards in a row (e.g. "12,408 daily transactions per store on average") with mono labels and tabular nums.
7. Pricing: 2 or 3 tier with focus on "no per-transaction surcharge" or "no monthly fee for hardware buyers" — vary the angle per variant.
8. Customer story section: 1 spotlighted store with name + city + a 2-paragraph quote + ROI metrics row ("+34% checkout speed", "−18% inventory shrink").
9. Integration logos cloud: 8-12 small logos of accounting, e-commerce, delivery integrations (fictional or real names like Shopify, Stripe, QuickBooks, DoorDash, Uber Eats).
10. FAQ: 5 retail-specific questions.
11. Final CTA: gradient-accent banner.
12. Footer: 5-col with Product / Hardware / Integrations / Company / Resources.

THE 5 VARIANTS:

VARIANT 01: Counter — A modern POS built for independent coffee shops.
- Mode: warm cream. Bg #FAF6F0. Accent: warm terracotta #C66B3D. Text #1F1B16.
- Pitch: "The POS that thinks like a barista, not an accountant."
- Audience: indie coffee shops with 1-5 locations.
- Hero mockup: tablet POS screen showing order entry — line items "Oat milk latte $5.50 / dbl espresso $3.75 / croissant $4.25" + total $13.50 with payment options. Receipt printer beside it printing a mock receipt.
- Centerpiece: hardware showcase — tablet, receipt printer, card reader, kitchen display unit (KDS) shown in a flat-lay diagram with arrows showing data flow.
- Stats: Avg daily orders per shop (408), Avg ticket size ($14.20), Time to ring up order (8 sec), Stores that switched in 2025 (1,402).
- Customer story: "Sun Cafe · Brooklyn, NY · 3 locations" — quote about cutting morning rush time by 38%.
- Pricing: Solo ($49/mo, 1 location + hardware kit) + Multi ($129/mo per location, 2+ locations + central reporting).
- FAQ Q's: "Does it work offline if my wifi drops?", "How do tips and tip-out splits work?", "Can I integrate Square Online or Toast Online for delivery?", "What's the cost of the card reader and is it included?", "Do I have to buy proprietary hardware?".

VARIANT 02: Mantle — The inventory + fulfillment OS for DTC brands.
- Mode: clean white. Bg #FFFFFF. Accent: navy #0E1A3A. Text #0A0A0A.
- Pitch: "Stop bouncing between 4 dashboards. One source of inventory truth."
- Audience: DTC brands doing $500k-$10M/year with 100-2,000 SKUs across multiple sales channels.
- Hero mockup: dashboard showing stock levels across SKUs — table with SKU / Variant / Locations / On hand / Incoming / Below threshold (red dot for low stock). Sidebar with "Reorder suggestions" cards.
- Centerpiece: inventory flow diagram — multi-warehouse → fulfillment → carrier (Shopify, Amazon, manual) all routed through a central node.
- Stats: SKUs tracked across brand average (1,408), Avg stockout days per brand reduced from (12 → 1.8), Channels integrated per brand (4.7), Shipments routed daily (28,408).
- Customer story: "Hana Made · Los Angeles" candle brand cut stockouts 92% in 3 months.
- Pricing: Studio ($129/mo, 500 SKUs + 2 channels) + Scale ($399/mo, 5k SKUs + unlimited channels + reorder agents).
- FAQ Q's: "Does it sync inventory in real-time across channels?", "What carriers does it support out of the box?", "How do I handle backorders and pre-orders?", "Does it forecast demand or am I still doing that in spreadsheets?", "Can I bring my own 3PL or is it tied to specific warehouses?".

VARIANT 03: Tessera — Restaurant POS with QR ordering at the table.
- Mode: terracotta + cream. Bg #FAF0E6 with subtle pattern. Accent: deep terracotta #B05030. Text #2A1810.
- Pitch: "Faster tables. Bigger checks. Calmer staff."
- Audience: full-service restaurants doing 50-300 covers a night, casual upscale.
- Hero mockup: split-screen — guest's phone with QR menu open (item categories, item card with photo placeholder + description + price + add-to-order button) + kitchen display showing tickets coming in.
- Centerpiece: order flow diagram — table → QR menu on phone → kitchen ticket → server iPad → check.
- Stats: Avg check size lift after install (+22%), Time saved per table (4.5 min), Tip rate (18.4% avg via QR), Restaurants using as of Q4 2025 (8,408).
- Customer story: "Marcato Trattoria · Brooklyn — 4-star Italian, 14 tables" — cut average meal time 12 min, raised tips 6 points.
- Pricing: Pour ($89/mo, 10 tables + QR menu) + Service ($249/mo, unlimited tables + KDS + reservation integration).
- FAQ Q's: "How do guests pay — do I still need a POS at the bar?", "What happens if a guest's phone dies mid-order?", "How do you handle splits and shared appetizers?", "Does it integrate with OpenTable or Resy?", "What's the tablet/printer hardware kit cost?".

VARIANT 04: Trove — A marketplace platform for makers of handmade goods.
- Mode: sage + cream. Bg #F5F1EA. Accent: sage green #7CA982. Text #1F1B16.
- Pitch: "Where things made by hand find people who care."
- Audience: solo makers and small studios selling handcrafted goods (ceramics, textiles, jewelry, wood, leather).
- Hero mockup: product card grid mockup — 4 cards with rounded image placeholder (gradient), serif product name, maker name, price, "1 of 1" or "made to order" tag.
- Centerpiece: storefront preview — a sample maker's shop with header banner, about-the-maker section, product grid, custom URL (`trove.shop/hana-clay`).
- Stats: Makers on platform (4,402), Avg monthly sales per maker ($1,408), Items sold this month (28,408), Featured collections (47 curated drops/year).
- Customer story: "Yuki Pottery — Asheville, NC" doubled monthly revenue after switching from Etsy.
- Pricing: Maker (free, 8% per sale) + Studio ($24/mo, 4% per sale + custom domain + analytics).
- FAQ Q's: "How is the commission rate split between Trove and payment processing?", "Can I bring my existing Shopify products over?", "Do you offer printed packaging for makers?", "How are featured drops curated — can I apply?", "What about international shipping and customs?".

VARIANT 05: Receipts — Developer-first payment processor.
- Mode: dark. Bg #0A0A0A. Accent: electric purple #B388FF. Text #FFFFFF.
- Pitch: "Stripe API. Better fees. Your own logo."
- Audience: indie devs and bootstrapped founders doing $1k-$100k/mo who balk at Stripe's 2.9% + 30¢.
- Hero mockup: split — left has the code snippet (`import {receipts} from "@receipts/sdk"` + a charge call with options), right has a mock receipt showing the fee breakdown — "Stripe would charge $3.20 / Receipts charges $1.45 / You save $1.75 per $100".
- Centerpiece: payment flow diagram — customer → checkout SDK → Receipts → ACH/card networks → your bank, with mono labels for each hop.
- Stats: Avg fee saved per merchant (vs Stripe) annually ($28,408), Merchants in 47 countries, P95 charge latency (240ms), API uptime last 90d (99.99%).
- Customer story: "Cargo Studio · Berlin · indie design agency" — saved $14k in 2025 by switching.
- Pricing: Pay-as-you-go (1.4% + 20¢ per charge, no monthly fee) + Volume ($99/mo + 1.0% + 15¢ per charge, for $50k+/mo merchants).
- FAQ Q's: "What's your actual interchange + processor cost — how do you charge less than Stripe?", "Do you support ACH, SEPA, and local methods?", "What about 3DS and SCA for European customers?", "How fast are payouts to my bank?", "What's your dispute / chargeback flow look like?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 4 — Documentation Sites (5 pages, mostly light mode)

```
Brief: Produce 5 landing pages for documentation products — cross between Mintlify, Stripe Docs, Linear Docs, and a high-end book-like reading experience. These are docs-product-landing pages (selling the docs product), NOT actual docs sites — but they should HEAVILY feature mockups of docs UIs.

SHARED AESTHETIC (all 5 variants):
- Display: Inter Display 600-700, -0.025em letter-spacing.
- Body: Inter 400-450.
- Mono: Geist Mono 400-500 — CRITICAL, used heavily in code blocks, command palette, in-line backticked terms.
- Code blocks: monospaced, line-numbered, syntax-highlighted (keywords in accent, strings in green, comments in muted grey).
- Sidebar nav mockups (left column with collapsible sections, current item highlighted with accent background).
- Command palette mockups (Cmd+K) — modal overlay with search input + results list with keyboard shortcut hints.
- Right-side TOC mockups (table of contents with anchor links highlighted by scroll position).
- Hairline borders, generous whitespace.
- Light mode default for variants 1, 2, 4, 5; dark mode for variant 3.

SHARED SECTION SKELETON:
1. Sticky nav: wordmark + 3-4 nav links (Product, Docs, Pricing, Customers) + GitHub icon link (just decorative SVG) + Sign-in text + accent CTA pill ("Start free" / "Get started" / "Try docs").
2. Hero: pill badge + display headline + sub + dual CTA + docs UI mockup screenshot (the centerpiece — show a full docs interface with sidebar, content, TOC).
3. Trust bar: "Powering docs at 1,402 companies" + customer wordmarks.
4. Feature trio with mockups: 3 alternating rows, each with text on one side + docs UI feature mockup on the other (search experience, code block with copy button, version switcher, etc.).
5. Code-quality section: BIG centered headline like "Code blocks that read like the editor you write in" + a HUGE syntax-highlighted code block mockup with theme switcher + copy button + filename header tab.
6. Search experience mockup: full-bleed dark or light Cmd+K command palette with mock query "/api/payments" + results streaming in.
7. Versioning + i18n features grid: 4 cards covering versioning, search, i18n, analytics.
8. Pricing: 2 or 3 tier. Vary per variant — Hobby/Pro/Org pattern.
9. Customer logos + testimonials from devrel / docs teams.
10. FAQ: 5 docs-specific questions.
11. Final CTA: simple bordered card.
12. Footer: 4-col with Product / Docs / Company / Resources + small wordmark and copyright.

THE 5 VARIANTS:

VARIANT 01: Atlas Docs — API documentation built around OpenAPI specs.
- Mode: light. Bg #FFFFFF. Accent: indigo #4F4FE0. Text #0A0A0A.
- Pitch: "OpenAPI in. Beautiful docs out. Stay in sync."
- Audience: API platform teams who maintain OpenAPI/Swagger specs and want auto-generated, customizable docs.
- Hero docs mockup: 3-pane layout — left sidebar with endpoint tree (POST /charges, GET /charges/{id} ...), center with endpoint detail (path, params, request example, response example), right TOC.
- Code block centerpiece: language-tabbed code panel (curl / node / python / go / php / ruby) all showing the same /v1/charges create call.
- Features: auto-generated SDKs in 6 languages, interactive try-it console, multi-version support, search across endpoints, customizable themes, custom domain.
- Stats: APIs documented (1,408), Avg time to publish first docs (4 hours), Endpoints across all customers (240k+), Code snippets generated daily (84k).
- Pricing: Hobby (free, 1 spec + community search) + Pro ($49/mo, unlimited specs + analytics + versioning) + Enterprise ($299, SSO + audit + on-prem).
- FAQ Q's: "Does it stay in sync if I update the OpenAPI spec?", "Can I customize the theme and CSS?", "What languages do you generate SDKs for?", "How do you handle authentication examples without leaking secrets?", "Can I self-host the docs site?".

VARIANT 02: Pavilion — Design system documentation that designers + engineers both love.
- Mode: light. Bg #FAFAFA. Accent: charcoal #1A1A1A (mono accent, no chroma). Text #0A0A0A.
- Pitch: "Where your components live, and where your team agrees on them."
- Audience: design systems teams at companies with 50-1000 engineers maintaining a component library.
- Hero docs mockup: component playground — Button component with live props panel (variant, size, disabled, icon) + rendered button + code preview tabs (React, Vue, HTML).
- Code block centerpiece: design token JSON file with color OKLCH values, copy button, "Generated · do not edit" header tag.
- Features: live component playground, props inspector, design token sync from Figma, version diffs, contribution workflows, custom landing pages.
- Stats: Component libraries hosted (408), Avg components per system (84), Versions tracked (12,408 total releases), Designer-engineer round-trips saved (estimated 2.4 hours per PR).
- Pricing: Open Source (free, public docs only) + Team ($129/mo, 5 seats + private docs) + Org ($499/mo, unlimited + SSO + Figma sync).
- FAQ Q's: "Does it integrate with Storybook or replace it?", "How does Figma sync work — bi-directional?", "Can I version both design tokens and component code?", "What about MDX support for hand-written docs?", "Does it work with monorepos like Turborepo?".

VARIANT 03: Codex — Docs for open-source libraries that don't suck.
- Mode: dark. Bg #0E0E12. Accent: neon green #5BFF89. Text #F4F2EE.
- Pitch: "Your readme deserves better than a single Markdown file."
- Audience: maintainers of widely-used OSS libraries (think Tanstack Query, Vite, Drizzle, Hono) who want a real docs site without spinning up Docusaurus.
- Hero docs mockup: dark-mode docs page for "drizzle-orm" (fictional but believable) — sidebar with Getting Started / Core Concepts / Schema / Queries, center with a "Schema" page showing a TypeScript code block, right-side TOC.
- Code block centerpiece: TypeScript schema definition (`pgTable("users", { ... })`) with syntax highlighting in green/cyan + line numbers + copy button.
- Features: free for OSS, GitHub-flavored markdown, automatic API ref from JSDoc, version switcher (npm tags), example sandbox embeds, search powered by typesense.
- Stats: OSS projects hosted (4,408), GitHub stars across all hosted projects (1.4M+), Avg time-to-first-docs-page (38 min), Search queries served daily (240k).
- Pricing: OSS (free forever, public repos) + Maintainer ($14/mo, custom domain + analytics + early features) + Sponsor ($99/mo, 5 projects + priority support).
- FAQ Q's: "Is it really free for OSS or are there hidden limits?", "How does it integrate with my GitHub repo for content?", "What about API reference auto-gen from TypeScript types?", "Can I embed live runnable examples (StackBlitz / CodeSandbox)?", "How is search privacy-preserving — do you log queries?".

VARIANT 04: Field Guide — A tutorial platform for technical learning paths.
- Mode: light. Bg #FFFFFF. Accent: warm orange #F97316. Text #1A1714.
- Pitch: "Learn one thing this week. Actually learn it."
- Audience: working developers who want focused 4-week courses (not endless playlists) on specific topics (Rust, Postgres internals, type theory, distributed systems).
- Hero docs mockup: course landing — "Postgres for application engineers · 4 weeks · 12 lessons" + lesson list with progress dots (3 of 12 complete) + next-lesson card with read-time estimate.
- Code block centerpiece: SQL query with EXPLAIN ANALYZE output — annotated with margin comments pointing at execution plan steps.
- Features: structured 4-week paths, exercises with auto-grading, progress tracking, community discussion threads, instructor-led cohorts (optional), printable PDF on completion.
- Stats: Active learners this month (28,408), Completion rate (62% — vs industry 8%), Courses available (47 deeply-curated paths), Cohorts running concurrently (Q4 2025: 12).
- Pricing: Single course ($99 one-time per course) + Subscription ($24/mo, all courses) + Team ($14/seat/mo, 5+ seats with progress dashboard).
- FAQ Q's: "How is this different from Egghead or Frontend Masters?", "Are courses video-heavy or text-heavy?", "Can I get a refund if I bounce off a course?", "How long do I have access after purchase?", "Do you offer team licenses for engineering managers?".

VARIANT 05: Cartograph — A help center / customer-facing knowledge base.
- Mode: light. Bg #FFFFFF. Accent: slate blue #5070A0. Text #0A0A0A.
- Pitch: "Where your customers actually find answers."
- Audience: SaaS support teams (10-200 person companies) replacing Intercom Articles or Zendesk Guide.
- Hero docs mockup: customer-facing help center — large search bar at top, 6 category cards below (Getting Started, Billing, Integrations, etc.) with article counts, "Popular articles" sidebar with click counts.
- Code block centerpiece: a customer support article rendering with embedded video placeholder + step-by-step instructions + "Was this helpful?" widget + related articles.
- Features: AI-powered search (semantic, multi-language), article analytics (read-rate, search query → article mapping), contributor workflow with reviews, embedding for in-app help, multilingual.
- Stats: KBs hosted (1,408), Articles served daily (1.4M reads), Languages supported (28), Reduction in support tickets after deploy (avg −34%).
- Pricing: Starter (free, 50 articles + branding) + Growth ($79/mo, unlimited + analytics + custom domain) + Scale ($249/mo, AI search + multilingual + audit).
- FAQ Q's: "How does the AI search differ from old-school keyword search?", "Can I require authentication to view certain articles?", "Does it integrate with my Intercom / Zendesk / HubSpot?", "How is article performance measured — open rate, dwell time?", "Can support agents contribute articles inline from a ticket?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 5 — SaaS Sales / Marketing landings (5 pages, mixed modes)

```
Brief: Produce 5 landing pages for B2B SaaS products with strong sales/conversion focus — Pipedrive, Notion, Asana, Linear, Attio level. Heavy on social proof, ROI metrics, customer logos, comparison tables, and "book a demo" flows (but NO actual form submission UI beyond a button — these are informational landings).

SHARED AESTHETIC (all 5 variants):
- Display: Inter Display 600-700, -0.025em letter-spacing.
- Body: Inter 400-500.
- Mono: Geist Mono 400-500 for metric labels and tags.
- Product mockups: large dashboard screenshots placed adjacent to text, slight perspective tilt OK.
- Stats banners (4 metric cards in a row) with mono labels and tabular nums.
- Lots of customer logos / testimonials / case study cards.
- Gradient hero backgrounds (subtle mesh, not loud).
- "Book a demo" CTA prominent in nav and final CTA — these are usually B2B sales-led products.

SHARED SECTION SKELETON:
1. Sticky nav: wordmark + 5 nav links (Product, Customers, Pricing, Resources, Changelog) + Sign-in text + "Book a demo" outline pill + primary CTA pill ("Try X free" or "Get started").
2. Hero: pill badge or product update mention + display headline + sub + dual CTA (primary + outline "Book a demo") + product dashboard mockup.
3. Customer logo bar: 8-10 enterprise-y customer logos, NOT marquee, just a static grid with slight opacity.
4. Stats banner: 4 ROI-focused metrics that the product delivers ("+34% pipeline velocity", "−18 hours / week saved", "92% retention rate", "8.4x ROI YoY").
5. Big alternating feature 1: dashboard mockup + serif/sans h2 + paragraph + bullet list + CTA link.
6. Big alternating feature 2: different mockup + reversed layout (text right, mockup left) + h2 + paragraph + bullets.
7. Comparison table: 3-col grid "Without X / With X / The diff" showing pain points and solutions. Pure text, no images.
8. Customer story spotlight: 1 highlighted case study card with company logo + 2-paragraph quote + 3 ROI metrics + CTA link to "read full story".
9. Pricing: 2 or 3 tier with "Talk to sales" tier always present.
10. Integration logos cloud: 16-20 small logos of common B2B integrations (Slack, Notion, Linear, HubSpot, Salesforce, Zapier, etc.).
11. Testimonials grid: 3 quote cards with names + roles + companies.
12. FAQ: 5 enterprise/SaaS-specific questions.
13. Final CTA banner: gradient bg + display h2 + dual CTA.
14. Footer: 5-col with extensive links — Product / Solutions / Resources / Company / Legal.

THE 5 VARIANTS:

VARIANT 01: Pact — Contract management for legal and revenue teams.
- Mode: deep navy. Bg #0E1A3A. Accent: gold #C8A06A. Text #F4F2EE.
- Pitch: "Close contracts the way your sales team closes deals."
- Audience: GC / revops / sales ops at $10M-$200M ARR companies (series-B / series-C).
- Hero mockup: contract redlining UI — split-screen showing two versions of a clause with diff highlighting (added / removed / unchanged), comments thread in sidebar.
- Stats banner: "Avg time-to-signature reduced from 28 days → 6 days · Approval workflow steps -52% · Contract value tracked $2.4B+ · Compliance audits passed 100%"
- Feature 1: AI clause library — sidebar of pre-approved clauses + drag-into-contract feature.
- Feature 2: approval workflow — visual swimlane showing legal → finance → exec routing.
- Comparison: "Without Pact: 47 days from term sheet to signature, 12 versions floating in email, no audit trail / With Pact: 6 days, single source of truth, every change tracked".
- Customer story: "Brightwave Inc · Series B SaaS · 87% reduction in legal review backlog after 90 days".
- Pricing: Team ($99/seat/mo, 5+ seats) + Enterprise (Talk to sales, custom).
- FAQ Q's: "How do you handle redlines from outside counsel using Word?", "What's your data residency policy for EU customers?", "Does it integrate with Salesforce CPQ?", "How does the AI clause approval work — does my legal team review the model?", "What about e-signature — do you replace DocuSign or layer on top?".

VARIANT 02: Ledger — Accounting software built for indie founders, not accountants.
- Mode: warm white. Bg #FAFAF7. Accent: forest green #4F8259. Text #1A1714.
- Pitch: "Books that close themselves. Mostly."
- Audience: solo founders and 2-10 person bootstrapped startups doing $50k-$2M/year revenue.
- Hero mockup: P&L dashboard — revenue line going up + expense bars + net income callout + month-over-month % chips.
- Stats banner: "Avg time spent on books / month dropped 14hrs → 1hr · Tax filings auto-prepared (avg cost $0 vs $1,400 to CPA) · Categorization accuracy 97% · Founders served 8,408".
- Feature 1: auto-categorization — receipt photo → AI categorization → confirm tile flow.
- Feature 2: tax-ready exports — Schedule C preview + downloadable CSVs for accountant handoff.
- Comparison: "Without Ledger: Excel + receipts in a drawer + April panic / With Ledger: bookkeeping done in 1 hour/month + tax docs ready Q1".
- Customer story: "Cargo Studio · solo design agency, $340k revenue 2025 · saved $1,800 on accounting fees".
- Pricing: Solo ($24/mo, single business + auto-categorize + tax export) + Team ($79/mo, multi-entity + payroll + multi-currency).
- FAQ Q's: "Do you replace my CPA or supplement them?", "How accurate is the auto-categorization — what happens when it's wrong?", "Can I import existing books from QuickBooks or Wave?", "Does it handle multi-state / multi-country sales tax?", "What about audit risk — does it produce CPA-grade documentation?".

VARIANT 03: Brace — Customer success platform for enterprise SaaS.
- Mode: cream + warm. Bg #F5F1EA. Accent: warm sienna #B05030. Text #1A1A2E.
- Pitch: "Know which accounts are slipping. Save them before renewal."
- Audience: CS leaders at $5M-$50M ARR B2B SaaS companies running 20-200 enterprise accounts.
- Hero mockup: account health dashboard — accounts table with health score (green/amber/red), risk factors, last activity, ARR, expansion potential. Sidebar showing 3 accounts at risk.
- Stats banner: "Net revenue retention improved 8 → 14% · Churn predicted 90 days in advance with 84% accuracy · ARR saved through proactive intervention $14M last year · Customer success teams 1,402".
- Feature 1: health score model — explanation of which signals factor in (usage, support tickets, sentiment, contract value).
- Feature 2: playbook automation — pre-built CS plays triggered by health score changes (e.g. green→amber triggers exec-sponsor check-in).
- Comparison: "Spreadsheets / random Slack pings / quarterly QBRs / Brace: continuous account intelligence + automated plays + exec-ready briefs".
- Customer story: "Linnea · series-C B2B SaaS · cut churn 38% in 12 months, expanded NRR to 142%".
- Pricing: Team ($199/seat/mo, 5+ seats, basic health scoring) + Enterprise (Talk to sales — custom, predictive churn + SSO + dedicated CSM).
- FAQ Q's: "How are health scores actually calculated — is it ML or rules?", "What signals does it need from my product (events, telemetry)?", "Does it integrate with Salesforce, Gainsight, Vitally?", "How long does it take to train the churn model on our customer base?", "What's your data residency story for EU accounts?".

VARIANT 04: Frontier — Sales pipeline tool for B2B startup AEs.
- Mode: dark. Bg #0A0A0A. Accent: electric blue #4F8FFF. Text #FFFFFF.
- Pitch: "The pipeline tool your AEs will actually use."
- Audience: 1-30 person sales teams at series-A/B B2B SaaS startups frustrated with Salesforce.
- Hero mockup: kanban pipeline — columns Prospecting / Discovery / Demo / Negotiation / Closed, cards with deal value + days-in-stage + last activity. One card hovering with "AI nudge: schedule follow-up — last contact 11 days ago".
- Stats banner: "Avg AE productivity (deals worked per week) +28% · Stage transition velocity +44% · Forecast accuracy improved from 62% → 91% · Sales teams switching to Frontier in 2025 (1,408)".
- Feature 1: AI deal coach — sidebar that suggests next-best-action per deal based on stage + last activity + similar closed-won deals.
- Feature 2: forecast roll-up — automatic pipeline math with confidence intervals, no manual category nonsense.
- Comparison: "Salesforce: $185/seat/mo, weeks of setup, AEs hate using it / Frontier: $49/seat, set up in 1 day, AEs use it daily".
- Customer story: "Forecast Inc · series-A B2B sales platform · cut sales-cycle 38%, hit Q4 number ahead of plan".
- Pricing: Starter ($49/seat/mo, 10 seats max) + Growth ($89/seat, unlimited + AI coach) + Enterprise (custom).
- FAQ Q's: "How is this different from HubSpot Sales Hub or Pipedrive?", "Can I migrate from Salesforce in a weekend?", "What about email tracking and meeting scheduling?", "Does the AI coach learn from my closed-won deals?", "How do I handle multi-currency and international territories?".

VARIANT 05: Tally — Employee survey + people analytics for engineering orgs.
- Mode: light + lavender. Bg #FFFFFF. Accent: lavender #8060C0. Text #1A1714.
- Pitch: "Engagement surveys that actually change something."
- Audience: HR / people-ops at 100-1000 person tech companies (especially engineering-heavy orgs).
- Hero mockup: insights dashboard — eNPS gauge, sentiment heatmap by team, top themes from open-text comments analyzed by AI, manager scorecards.
- Stats banner: "Survey response rates avg 84% (vs industry 32%) · Manager-effectiveness lift after Tally rollout +28% · Themes surfaced from open-text per quarter (avg 47) · Companies using Tally 1,408".
- Feature 1: anonymous comment analysis — AI cluster comments into themes + show frequency over time without exposing individuals.
- Feature 2: manager scorecards — per-manager view of team sentiment + retention risk + comparison to org median.
- Comparison: "Annual engagement survey (1x/year, 300-page PDF nobody reads) / Tally (continuous pulses, manager-actionable insights, anonymized themes)".
- Customer story: "Mercury · 480-person fintech · identified manager-effectiveness gap and trained 28 EMs, retention up 14pp YoY".
- Pricing: Starter ($8/employee/mo, 50-500 employees) + Growth ($14/employee/mo, 500+ with AI themes + custom segmentation) + Enterprise (custom + SSO + DPO).
- FAQ Q's: "How is anonymity actually preserved — can a manager identify who said what?", "Does it integrate with my HRIS (Rippling, Gusto, Workday)?", "What's the survey cadence — weekly, monthly?", "How are open-text themes generated — what model do you use and where does it run?", "Can I customize survey questions per team?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 6 — AI / ML Products (5 pages, mostly dark modes with one light)

```
Brief: Produce 5 landing pages for AI / ML products — feel like Cursor, Anthropic, ElevenLabs, Suno, Heygen. Heavy on conversational UI mockups, generated-content showcases, model performance benchmarks, and animated gradient hero backgrounds.

SHARED AESTHETIC (all 5 variants):
- Display: Inter Display 700, -0.04em letter-spacing.
- Body: Inter 400-500.
- Mono: Geist Mono 400 — for model names, latency, token counts.
- Hero background: animated mesh gradient (CSS @keyframes shifting hue + position). Subtle, slow (~20-40s loop).
- Conversational mockups: chat-style bubbles with user prompt on right, AI response on left, with a "thinking dot ..." indicator and streaming-text feel.
- Performance benchmarks: bar charts comparing the product to competitors (GPT-4, Claude, Gemini, Llama-3, etc. — use real model names).
- Live-feel pulse-dots in "online" / "available" indicators.
- Code blocks for SDK examples in 3 languages (Python, JS, curl).

SHARED SECTION SKELETON:
1. Sticky nav: wordmark + 4 nav links (Product, Models, Docs, Pricing) + GitHub icon + Sign-in + accent CTA pill.
2. Hero: pill badge mentioning model version + display headline + sub + dual CTA (primary "Try in playground" + secondary "Read paper" or "Watch demo") + chat / generation mockup with streaming animation simulated via CSS.
3. Trust bar: "Trusted at 1,408 companies" + customer wordmarks.
4. Benchmarks section: BIG bar chart comparing the product to 3-4 competitors on 3-4 metrics (e.g. accuracy, latency, cost per 1k tokens, hallucination rate).
5. Use cases grid: 3-4 cards each showing a specific use case with a mini-mockup of the AI output (e.g. customer support resolution, code completion, video edit, learning plan).
6. Model card / specs panel: a mono-text panel showing model parameters (context length, modalities, pricing per token), like a product spec sheet.
7. SDK code block centerpiece: language-tabbed (Python / JS / curl) with a 8-12 line example.
8. Pricing: 3-tier with token-based or usage-based pricing (Free playground / Pay-as-you-go / Enterprise).
9. Customer story: spotlighted with ROI metrics ("saved 28 hours / week", "automated 84% of tier-1 tickets").
10. Comparison table: "X vs OpenAI vs Anthropic vs Open source" with checkmarks.
11. FAQ: 5 AI-specific questions (privacy, training data, hallucination, latency, fine-tuning).
12. Final CTA: gradient banner with playground CTA.
13. Footer: 5-col with Models / Use cases / Docs / Research / Company.

THE 5 VARIANTS:

VARIANT 01: Choir — AI customer support automation.
- Mode: dark. Bg #0A0A0A. Accent: cyan/teal #00C4B4. Text #FFFFFF.
- Pitch: "Resolve 84% of tickets. Escalate the rest with full context."
- Audience: support leaders at SaaS companies with 500-50k tickets/month.
- Hero mockup: live ticket resolution chat — customer's message ("My subscription was charged twice this month") + AI streaming response ("I see two charges on Nov 12 — refunding the duplicate $49 to your card ending 4242. Confirmed by your refund policy.") + confidence score 0.97 + resolved tag.
- Benchmarks: resolution rate (84% vs Zendesk AI 41%), CSAT score (4.6 vs human 4.2), median resolution time (28s vs human 14min), cost per ticket ($0.04 vs human $1.40).
- Use cases: refund handling, password reset, account access, product Q&A, escalation routing.
- Model card: context 200k tokens · multi-step reasoning · tool use for refunds/account changes · trained on enterprise support corpus · SOC2 Type 2.
- Pricing: Free (100 resolutions/mo), Pay-as-you-go ($0.04/resolution), Enterprise (volume + BYOC + custom training).
- FAQ Q's: "How accurate is the auto-resolution and what's the false-confidence rate?", "Does it integrate with Zendesk / Intercom / Front?", "What happens when it can't resolve — how is escalation context handled?", "What about PII in tickets — is it redacted before model invocation?", "Can we fine-tune on our specific product corpus?".

VARIANT 02: Forge — AI coding assistant for engineers who write production code.
- Mode: dark. Bg #08090A. Accent: amber #F5C26B. Text #FFFFFF.
- Pitch: "The coding assistant your senior engineers will actually keep installed."
- Audience: working engineers at startups and mid-size cos who tried Copilot/Cursor and want more.
- Hero mockup: code editor split-screen — left has a TypeScript file with a function partially written, right has the AI's diff suggestion (insertions in green, ghost lines) + reasoning trace ("considering 3 approaches: ... reviewed types ... checked similar PRs in repo ...").
- Benchmarks: accept rate (62% vs Copilot 24%), test-pass rate (89% vs Copilot 51%), hallucinated API calls (1.2% vs Copilot 8.4%), latency P50 (240ms vs Cursor 320ms).
- Use cases: code completion, refactor suggestions, test generation, debugging trace analysis, PR review summary.
- Model card: 1M token context (entire repo) · trained on PR-merge dataset · tool use for running tests in CI · privacy: no training on your code.
- Pricing: Free (50 completions/day, individuals only), Pro ($24/mo, unlimited individual), Team ($49/seat, shared context across repo + admin).
- FAQ Q's: "Is my code used to train the model?", "Does it work offline / can I self-host?", "Which IDEs are supported (VS Code, JetBrains, Neovim)?", "How is the context built across a large monorepo?", "Can I plug in our private packages / internal SDKs?".

VARIANT 03: Lyceum — AI tutoring platform for K-12 students.
- Mode: light. Bg #FFFAF5. Accent: warm coral #FF6B5A. Text #1A1714.
- Pitch: "A tutor who shows up, every day, exactly when your kid needs one."
- Audience: parents of 8-16 year olds + school districts adopting AI tutoring at scale.
- Hero mockup: friendly chat-style tutoring session — student asks ("I don't get why 2/3 ÷ 1/4 = 8/3"), AI tutor responds with a step-by-step explanation including small inline SVG diagrams of fractions. Progress chart in sidebar showing topics mastered.
- Benchmarks: learning gain after 12 weeks (1.8 grade levels avg vs Khan Academy 0.7), engagement (avg session 24min vs Khan 8min), parent satisfaction (4.8/5), tutor cost per student ($24/mo vs human $400/mo).
- Use cases: math homework help, reading comprehension, science explanations, study guide generation, weekly progress reports for parents.
- Model card: K-12 curriculum alignment (Common Core, IB) · age-appropriate language · safety-trained · no inappropriate content possible · parental dashboard.
- Pricing: Free (10 min/day), Family ($24/mo per child, unlimited tutoring) + Schools (custom, district licensing).
- FAQ Q's: "How is the tutor 'safe' — what about inappropriate content?", "Does it just give answers or actually teach?", "Can I see what my child is asking about?", "What grade levels and subjects are covered?", "How is student data privacy handled (COPPA, FERPA)?".

VARIANT 04: Glade — AI-powered video editing.
- Mode: dark. Bg #0E0E14. Accent: magenta/pink #E5407B. Text #FFFFFF.
- Pitch: "Cut, color, and caption. In the time it takes to make coffee."
- Audience: creators (YouTubers, podcasters, founders making product videos) doing 1-10 videos/week.
- Hero mockup: video timeline UI — raw footage track at top, AI-suggested cuts highlighted in magenta, generated B-roll insertions, auto-captions track at bottom, color-graded preview frame at top-right.
- Benchmarks: edit time (8 min vs human editor 4 hours for a 10-min video), retention boost on AI-edited videos (+14%), captioning accuracy (98% vs YouTube auto 84%), b-roll match relevance (0.92 vs Pictory 0.58).
- Use cases: long-form YouTube edit, short-form TikTok extraction, podcast-to-video, product demo, training video.
- Model card: multimodal — vision + audio + text · 4K input support · 12 hours/day rendering throughput · runs in browser via WebGPU.
- Pricing: Free (2 videos/month, 1080p), Creator ($29/mo, 50 videos + 4K + custom branding), Studio ($99/mo, unlimited + team workspace).
- FAQ Q's: "Does it actually replace my editor or just speed them up?", "What about copyright on AI-generated b-roll?", "Can I export to Premiere / Final Cut for final tweaks?", "How does the AI choose what to cut — is it learning my style?", "What's the longest video it can handle?".

VARIANT 05: Pebble — A personal AI assistant that remembers everything.
- Mode: soft gradient light. Bg gradient from #FAF6F0 to #F0E8FA (cream → lilac). Accent: deep lavender #6A4FA0. Text #1F1B16.
- Pitch: "Your AI, but it actually knows you."
- Audience: consumer users (knowledge workers, students, entrepreneurs) who want an AI assistant that learns context over time.
- Hero mockup: conversational interface — user asks "What was that Italian place we talked about for the team dinner?", AI responds "Marcato Trattoria in Brooklyn — you mentioned it on Nov 14 when discussing the offsite. Want me to check availability for Dec 18?" with memory citation chip.
- Benchmarks: memory retrieval accuracy (94% vs ChatGPT 38%), task completion rate without re-context (89% vs ChatGPT 22%), avg conversation continues from prior session (96% vs ChatGPT 0%), monthly active users (28,408).
- Use cases: schedule planning, knowledge recall, project context, personal CRM, daily briefings.
- Model card: long-term memory architecture (vector store + structured episodes) · context retrieval before generation · end-to-end encrypted memory at rest · runs cross-device sync.
- Pricing: Free (basic memory, 7 days), Plus ($14/mo, unlimited memory + voice mode), Pro ($24/mo, agent actions + integrations + cross-device).
- FAQ Q's: "Where is my memory stored and who can access it?", "How is this different from ChatGPT with memory?", "Can I export or delete my entire memory?", "What integrations does it have — calendar, email, contacts?", "Does it work offline?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 7 — Fintech / Money (5 pages, mixed modes)

```
Brief: Produce 5 landing pages for fintech products — banking, trading, crypto treasury, expense management, payment infrastructure. Robinhood / Plaid / Cash App / Wise level. Heavy on numerical visualizations (account balances, transaction lists, charts, asset breakdowns), trust signals (FDIC, SOC2, PCI badges), and live data feel.

SHARED AESTHETIC (all 5 variants):
- Display: Inter Display 600-700, -0.03em letter-spacing.
- Body: Inter 400-500.
- Mono: Geist Mono 400-500 — used HEAVILY for account numbers, transaction IDs, currency amounts, ticker symbols.
- Tabular nums on every number representing money or quantity (font-variant-numeric: tabular-nums).
- Currency formatting: thousands separators, 2 decimals for fiat (1,408.42), variable for crypto (0.0064 BTC).
- Live-feel: pulse-dot indicators on "balance updated 4s ago", "market open", "settling".
- Sparkline SVGs for asset performance (24-48 data points, area fill at accent 20% opacity, stroke 1.5px).
- Hairline borders rgba(0,0,0,0.08) on light / rgba(255,255,255,0.07) on dark.
- Trust badges row: FDIC, SOC2 Type II, PCI-DSS, audit firm names — small mono uppercase tracking-wide.

SHARED SECTION SKELETON:
1. Sticky nav: wordmark + 4 nav links (Product, Security, Pricing, Help) + Sign-in text + accent CTA pill ("Open an account" / "Start" / "Get the API key").
2. Hero: pill badge with regulatory mention ("FDIC-insured up to $250k" / "SEC-registered" / etc.) + display headline (half-tone trick on second clause) + sub paragraph 25 words + dual CTA + product mockup (account dashboard, trading terminal, payment flow). Mockup ~50% width.
3. Trust bar: "Used by 8,408 founders" + customer wordmarks marquee + regulatory badges row beneath.
4. Centerpiece visualization: BIG product detail mockup — bank account ledger, trading terminal, wallet transfer, expense dashboard, or payment routing diagram. Specific to variant.
5. Features 3-col grid: each col has icon + sans h3 + paragraph + sub-bullet list with checkmarks. Money-product specifics (instant transfers, no FX fees, granular permissions, audit trail).
6. Stats banner: 4 large metric cards with mono labels + tabular nums + sub-detail ("avg savings $14,408/yr" / "P95 settlement 4 min").
7. Pricing: 2-3 tier OR a transparent fee table. Always show what you DON'T charge for vs competitors (e.g. "0% FX fees" or "no monthly minimum").
8. Customer story: 1 spotlight with company + role + 2-paragraph quote + 3 ROI metrics row ("+$28,408 saved on FX" / "0 audit findings").
9. Security section: dedicated band with bank-level encryption, fund segregation, third-party audits, insured custody.
10. FAQ: 5 fintech-specific questions (regulatory, fund safety, audit reports, fees disclosure, cross-border).
11. Final CTA: gradient banner + dual CTA.
12. Footer: 5-col with Product / Pricing / Security / Legal (Compliance / Disclosures / Risks) / Company.

VISUAL FLOURISHES SPECIFIC TO FINTECH:
- "Live balance" widget: large tabular number that animates a +1 pulse on a fake update.
- Transaction list: mono columns for date / merchant / category / amount, alternating row hover state.
- Asset card: ticker symbol + 24h sparkline + bid/ask spread + tabular % change in accent (green up / red down).
- Network status pill: "Settled · 12s avg" with pulse-dot.
- Map cluster (cross-border): SVG world outline with dot markers at major financial centers.

THE 5 VARIANTS:

VARIANT 01: Reservoir — A business bank account for indie founders.
- Mode: dark navy. Bg #0A0F1A. Accent: electric green #3ECF8E. Text #F4F2EE.
- Pitch: "A business bank account that finally <em>feels like software</em>."
- Audience: solo founders and 2-10 person startups with $0-$500k MRR who hate Brex's enterprise UI and Mercury's growing-up vibe.
- Hero mockup: account dashboard — top card with checking balance ($148,408.22) + last-updated pulse-dot, 7-day cashflow sparkline, transaction list with recent ACH + outgoing wires + card charges. Sidebar "Cards / Bills / Transfers / Treasury".
- Centerpiece: cash management UI — interest-bearing treasury sub-account with current APY (4.42%), maturity schedule, instant transfers to checking.
- Stats: Avg monthly fees ($0 vs industry $48), Treasury APY (4.42% with daily compounding), Instant transfer SLA (P95 12s), Founders served (28,408).
- Customer story: "Cargo Studio · 4-person design agency NYC · earned $4,408 in interest in 2025 vs $0 at old bank".
- Pricing: Free (checking + cards + ACH + wire, $0/mo with $1k min balance) + Treasury (auto-sweep into 4%+ MMF, 0.08% management fee, no minimum).
- FAQ: "Is my money FDIC-insured and to what limit?", "Difference between sweep treasury and high-yield savings — do I lose access?", "How do you make money if there are no fees?", "Can I receive international wires and what's the FX spread?", "What happens if Reservoir shuts down — where does my money go?".
- Logos: Cargo, Folio, Linnea, Stratos, Quartermast, Halcyon, Cobalt, Atrium.

VARIANT 02: Pivot — A trading platform for technical analysts.
- Mode: dark mono. Bg #08090A. Accent: cyan #67E8F9. Text #F0F1F4.
- Pitch: "Your terminal, your data, <em>your edge</em>."
- Audience: technical traders (day + swing) and quant hobbyists tired of Robinhood's gamified UI and willing to pay for serious tooling.
- Hero mockup: trading terminal — left watchlist with 8 tickers (NVDA / TSLA / AAPL / SPY / BTC / ETH) showing last + change% + sparkline. Right is candlestick chart with EMA20, EMA50, RSI panel below. Bottom: order entry strip with bid/ask spread.
- Centerpiece: "Strategy back-tester" — code-editor mockup where user writes a Python strategy + results panel showing equity curve, max drawdown, Sharpe ratio.
- Stats: P95 order routing latency (4.2ms direct-to-exchange), Backtest run time on 5yr minute data (~38s), Strategies hosted (28,408), Cost per filled order ($0.0064 vs Robinhood "free" with PFOF spread).
- Customer story: "Marcus Tobin · Founding Quant at Forecast · saved $14,408 in 2025 on options spreads via direct routing".
- Pricing: Free (paper trading + EOD data), Trader ($24/mo, real-time + 100 backtests/mo + direct routing), Pro ($99/mo, unlimited backtests + tick data + API).
- FAQ: "Are orders routed for PFOF or direct to exchange?", "What's your data source and how delayed is it really?", "Can I run Python strategies on real money or only paper?", "Historical data coverage — how far back, what assets?", "How is PDT enforced — can I trade options spreads under $25k?".
- Logos: Forecast, Cobalt, Nimbus, Beacon Capital, Lattice Trading, Quartermast, Folio Labs, Coast Markets.

VARIANT 03: Tether — Stablecoin treasury for crypto-native companies.
- Mode: dark. Bg #0E1014. Accent: gold #E5B047. Text #F8F2E8.
- Pitch: "Hold dollars on-chain. Move them <em>everywhere</em>."
- Audience: crypto-native companies and DAO treasuries managing $100k-$50M in stablecoins, frustrated with manual multi-sig + spreadsheet treasury.
- Hero mockup: multi-chain wallet dashboard — total stablecoin balance ($14.408M), broken down by chain (Ethereum 8.2M, Polygon 3.1M, Base 2.4M, Solana 0.7M). Live transfer panel: "Send 50,000 USDC to Cargo Studio · Polygon · Settlement ~12s · Network fee $0.04".
- Centerpiece: cross-chain bridge orchestration — visual showing USDC moving Ethereum → Polygon → Arbitrum with mono labels for each hop's fee + settlement time.
- Stats: Total stablecoins under management ($1.4B), Avg cross-chain settlement (P50 28s, P95 4min), Companies using Tether (1,408), Aggregate FX cost saved ($28.4M in 2025).
- Customer story: "Stratos Protocol · DAO treasury · moved $8.4M cross-chain in Q4 without a single failed transaction".
- Pricing: Self-custody (free, you hold keys), Managed ($499/mo, multi-sig setup + 24/7 ops + insurance), Enterprise (custom, BYOC + audit + dedicated support).
- FAQ: "Custody — non-custodial or do you hold keys?", "Insurance coverage on managed accounts?", "Which stablecoins and chains supported?", "How do you handle a depeg event (USDC March 2023)?", "SOC2 / audit status?".
- Logos: Stratos, Cinder, Atrium DAO, Lattice Protocol, Reverb Capital, Crucible Labs, Cobalt Network, Folio DAO.

VARIANT 04: Margin — Expense management for ops teams.
- Mode: cream. Bg #FAF7F2. Accent: sage green #7CA982. Text #1F1B16.
- Pitch: "Where every dollar your team spends shows up <em>before</em> the credit card statement."
- Audience: finance / ops at 20-200 person companies tired of waiting until month-end to know what was spent.
- Hero mockup: expense dashboard — month-to-date spend ($148,408) broken down by category (SaaS 38%, Travel 22%, Equipment 18%, Other 22%) as horizontal stacked bar. Live activity feed: "Hana Suzuki spent $89.42 at Anthropic · 12s ago · auto-categorized as 'AI subscriptions'".
- Centerpiece: receipt-to-expense pipeline — photo of receipt → AI extraction → policy check → GL entry posted.
- Stats: Avg time from purchase to GL (4 min vs spreadsheet 14 days), Manual categorization rate (3% — rest is AI auto), Avg policy savings (8% of spend), Companies using Margin (4,408).
- Customer story: "Brightwave Inc · 120-person SaaS · caught $48,408 of duplicate SaaS subscriptions in first 90 days".
- Pricing: Starter ($8/seat/mo, virtual cards + receipt capture + GL sync) + Growth ($24/seat/mo, +policy automation + analytics) + Enterprise (custom, SAML + audit + procurement).
- FAQ: "Integrate with QuickBooks, Xero, NetSuite?", "How do virtual cards work for SaaS specifically?", "Can policies trigger by category, amount, vendor, or all three?", "Receipt capture accuracy and what happens when it's wrong?", "How are cash reimbursements handled?".
- Logos: Brightwave, Forecast, Cargo, Cobalt, Lattice, Linnea, Halcyon, Stratos.

VARIANT 05: Conduit — Payment infrastructure for marketplaces.
- Mode: dark. Bg #0B0E1A. Accent: electric purple #8B7CFF. Text #FFFFFF.
- Pitch: "Split, route, and reconcile payments across <em>thousands of sellers</em>."
- Audience: marketplace platforms (Etsy-like, Uber-like, DoorDash-like) with 100-100k sellers needing complex payment splits, KYC, and 1099/W-9 handling.
- Hero mockup: split-payment visualization — $148.42 charge routes via platform → 70% to seller ($103.89) → 20% to platform ($29.68) → 10% to tax escrow ($14.84). Settlement timeline per leg.
- Centerpiece: KYC dashboard — seller onboarding funnel with stages (email → identity verified → bank linked → first payout) + cohort retention chart.
- Stats: Sellers onboarded across all marketplaces (4.4M), Median time from signup to first payout (28 min), Aggregate GMV processed in 2025 ($14.4B), Multi-currency support (84 currencies).
- Customer story: "Trove Marketplace · handmade goods · onboarded 14,408 makers in 6 months with 92% completing payout setup".
- Pricing: Pay-as-you-go (0.25% + $0.10 per transaction, after Stripe's costs), Volume ($999/mo + 0.15% + $0.08 for $1M+/mo GMV), Custom (negotiated for $10M+/mo).
- FAQ: "How does this compare to Stripe Connect?", "KYC tier support (Tier 1, Tier 2, Tier 3 with EDD)?", "1099-K forms for US sellers?", "Dispute / chargeback flow for split payments?", "Which countries can sellers be in and which can platform be in?".
- Logos: Trove, Folio, Drift, Cassette, Cargo Market, Nimbus Marketplace, Halcyon Shops, Stratos Sales.

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 8 — Health-tech (5 pages, mostly light + cream modes)

```
Brief: Produce 5 landing pages for health-tech products — telehealth, fitness coaching, mental health, EHR, medical billing. Headspace / One Medical / Whoop / Eden / Athelas level. CALMER than B2B SaaS: warm soft accents (sage, coral, lavender), serif accents for emotional weight, generous whitespace, lots of "trust + care" signaling. Mostly light/cream modes with one dark variant for the fitness/athletic vibe.

SHARED AESTHETIC (all 5 variants):
- Display: Inter 500-600 + occasional serif accent (Fraunces or Source Serif 4 italic) for emotional emphasis.
- Body: Inter 400 — line-height 1.6 (slightly looser than B2B SaaS) to feel calmer.
- Mono: Geist Mono 400 ONLY for clinical-feeling metrics (heart rate, BP, fasting glucose, SpO₂).
- Generous spacing — 96px+ between sections (not 64px).
- Soft drop shadows: 0 24px 48px -16px rgba(0,0,0,0.06).
- Rounded corners 16-24px on cards (softer than fintech's 12px).
- Subtle paper-grain texture via 22px radial-gradient at 0.025 opacity.
- Color palette: warm neutrals (cream, sand, soft white) + ONE warm accent per variant.
- Pulse-dot for "live" / "available" uses muted greens (#6F9F6A, not electric).

SHARED SECTION SKELETON:
1. Nav: wordmark + 4 links (How it works, Pricing, About, Members) + Sign-in text + accent CTA pill.
2. Hero: small pill badge + display headline (often serif italic accent on the emotional word) + sub paragraph 30 words (longer, more reassuring) + single CTA "Get started" or "Start free" + product mockup OR human-feel gradient placeholder.
3. Trust bar: 1-line testimonial OR "Used by 28,408 patients/members" + soft icons row of clinical accreditations (HIPAA, SOC2, NCQA).
4. "How it works" 3-step visualization: numbered cards walking through onboarding → use → outcomes. Soft icons, warm colors.
5. Big feature: 2-col split with product mockup + serif h2 + paragraph + accent text link.
6. Outcomes / clinical results: bar chart or before/after metric cards backed by a stat ("members lost 14lbs avg in 12 weeks" / "anxiety scores improved 38% in 8 weeks") with study link reference (mono).
7. Member story spotlight: 1 testimonial with photo placeholder + 2-paragraph quote + 3 outcome metrics row.
8. Pricing: 1-2 tier (intentionally simple — these audiences value clarity over options) OR insurance-billed model ("In-network with most major insurers").
9. Provider / network section: list of partner clinics, doctors, or coaches (Dr. Hana Suzuki MD, Dr. Marcus Tobin DDS).
10. FAQ: 5 health-specific questions (privacy, insurance, license coverage, clinical evidence, cancellation).
11. Safety / privacy band: dedicated section on HIPAA, data handling, when human escalates. Softer language than SaaS security band.
12. Final CTA: simple bordered card with "Start your first visit / week / session — $0 to try."
13. Footer: minimal, warm — wordmark + Clinical / Privacy / About / Careers / Contact + state licensure mono line.

VISUAL FLOURISHES SPECIFIC TO HEALTH-TECH:
- Vital sign cards: large heart rate / BP / sleep score in soft pill containers with mono labels.
- Progress rings: SVG circles showing % to goal with accent fill.
- Photo placeholders: warm gradient blobs simulating clinical / lifestyle photography (not generic gray).
- "Speak with a doctor" pill: green pulse-dot + "available now" in mono.
- Provider card: photo placeholder + name + credentials (mono) + specialty + state licenses.
- Calendar slot picker: 7-day strip with available slots highlighted in accent.

THE 5 VARIANTS:

VARIANT 01: Hearth — A primary care doctor in your pocket.
- Mode: cream. Bg #FAF6EF. Accent: sage green #6F9F6A. Text #1F1B16.
- Pitch: "A primary care doctor who <em>knows you</em>, in your pocket."
- Audience: adults 25-55 frustrated with insurance-driven 6-min visits, want a doctor via app for $0-$30/visit who actually remembers their history.
- Hero mockup: phone-app mockup — chat thread with Dr. Suzuki ("How's the sleep been since we tried the new dose?") + member's reply + calendar pill showing "Next appointment: Tue Mar 5 · 2pm video". Sidebar: vitals card (BP 118/76, resting HR 64) + medications list.
- Centerpiece: 3-step "how it works" — (1) tell us about you (intake form), (2) get matched with a doctor (provider card with photo + credentials), (3) chat or video any time (chat UI mockup).
- Outcomes: "Members who got same-day appointment (94%)", "Avg response time to a message (12 min)", "Members who saved $400+/yr vs urgent care (78%)", "Avg member satisfaction (4.8/5 NPS)".
- Member story: "Priya Anand · 34 · Brooklyn — switched from Aetna's mediocre primary care, finally has a doctor who remembers her family history".
- Pricing: $0/visit + $39/mo membership (unlimited visits, prescription refills, labs at cost) OR insurance covered for in-network plans.
- FAQ: "Is this actually primary care or just urgent care?", "Are my doctors licensed in my state?", "Does it work with my insurance — what does it cover?", "What if I need a specialist?", "Where is my medical record stored and can I export it?".

VARIANT 02: Cadence — Training that adapts to your biometrics.
- Mode: dark. Bg #0F1115. Accent: electric green #5BE584. Text #F0F3F0.
- Pitch: "Train smarter. The watch tells you <em>when</em>."
- Audience: serious amateur athletes (runners, cyclists, lifters) doing 5-10 hrs/wk training with a wearable.
- Hero mockup: training dashboard — large weekly training load gauge (green = on track, amber = under, red = over), next session card ("Threshold run · 38min · target 162 bpm avg"), sleep + HRV sparkline.
- Centerpiece: "training periodization" calendar showing 12 weeks of planned workouts color-coded by intensity, with watch icon overlaid showing live HRV adjustments.
- Outcomes: "Members hitting 12-week goal (84%)", "Avg VO2max improvement after 6 months (+4.2 ml/kg/min)", "Avg sleep improvement (+38min/night)", "Members consistent past month 3 (78% vs industry 18%)".
- Member story: "Hana Ito · marathon PR runner from Tokyo · went sub-3:00 in 14 weeks using Cadence's plan".
- Pricing: Plus ($24/mo, AI-coached + adaptive plan + sleep tracking) + Pro ($99/mo, plus monthly call with human coach + nutrition guidance).
- FAQ: "What watches supported (Apple, Garmin, Polar, Whoop)?", "How does the coach interpret my HRV?", "Can I use it without a wearable?", "Cancellation policy — am I locked in?", "Are human coaches certified (USAT, NSCA)?".

VARIANT 03: Quiet — Therapy that fits between meetings.
- Mode: light + lavender. Bg #FFFDFB with #F5F0FA accent bg. Accent: muted lavender #8060C0. Text #1A1714.
- Pitch: "Therapy that fits between <em>meetings</em>."
- Audience: working professionals (25-50) who'd benefit from therapy but find scheduling weekly 60-min sessions impossible. Async chat + 30-min video.
- Hero mockup: phone messaging UI — therapist response thread "Hi Priya — that 3pm Slack message thing is a familiar pattern, want to unpack it Friday at 7pm?" + member's reply. Sidebar: "Mood check" weekly trend line + next-session card.
- Centerpiece: 3-step "how it works" — (1) match with a licensed therapist (provider card with credentials, modalities CBT/ACT/EMDR), (2) message any time or schedule video, (3) track wellbeing over time (mood chart).
- Outcomes: "Members with measurable improvement in 8 weeks (84%)", "Avg therapist response time (4 hours)", "Members continuing past month 1 (91%)", "Cost vs traditional in-person (−62%)".
- Member story: "Marcus Tobin · founding engineer at Forecast · cut work-related panic attacks 80% over 12 weeks of Quiet".
- Pricing: $39/wk (async + monthly video) or $79/wk (async + 2 video/mo) — billed monthly, cancel anytime. HSA/FSA reimbursable.
- FAQ: "Are therapists licensed in my state?", "Different from BetterHelp?", "If I'm in crisis — what's the protocol?", "Is messaging private or logged for training?", "Can I switch therapists if it's not a fit?".

VARIANT 04: Vita — Patient records that don't fight you.
- Mode: light. Bg #FFFFFF. Accent: soft blue #5070C8. Text #0F1419.
- Pitch: "Patient records that don't fight you <em>at every click</em>."
- Audience: independent primary care, family medicine, small specialty clinics (1-15 providers) on Epic/Athenahealth and exhausted by their UX.
- Hero mockup: clinician EHR screen — patient summary card (name, age, last visit), problem list with active conditions, recent labs with reference ranges, medications. Side panel "Next patient: Hana Suzuki · 2:45pm · annual wellness".
- Centerpiece: charting UI mockup — clinician dictates a note into voice input → AI structures into SOAP format → ICD-10 codes suggested → billing fields pre-filled.
- Outcomes: "Avg note completion time (4 min vs Epic 14 min)", "Clinician burnout score improvement (−38% in 6 months)", "Patients seen per day (+22%)", "After-hours charting reduced (−84%)".
- Provider story: "Dr. Yusuf Abara MD · 5-provider family practice in Austin · reclaimed 2hrs/day from charting".
- Pricing: $200/provider/mo (cloud EHR + scheduling + billing) + $99/provider/mo (voice charting addon) + Setup ($1,500 one-time, includes data migration).
- FAQ: "Interoperability — CommonWell / Carequality?", "Migration path from Epic/Athena/Eclinical?", "Voice charting accuracy — what model and what HIPAA pipeline?", "Insurance eligibility checks and claim submission?", "Practice management — scheduling, billing, statements?".

VARIANT 05: Reckon — Medical billing for small practices.
- Mode: cream + warm. Bg #FAF5EF. Accent: warm sienna #B05030. Text #1A1714.
- Pitch: "Get paid what you billed. Without chasing insurance <em>for 90 days</em>."
- Audience: independent doctors, dentists, and small clinics (1-10 providers) tired of insurance underpaying / denying without explanation.
- Hero mockup: claims dashboard — claim status board with columns ("Submitted: 47", "Under review: 28", "Paid: 142", "Denied: 8 — appeals filed"). One denied claim highlighted with reason ("Modifier missing — auto-corrected, resubmitted 12s ago"). Aging report sidebar.
- Centerpiece: claim lifecycle — visit → coded → submitted → adjudication → paid OR denied → auto-appealed → paid. Each step with avg duration in mono.
- Outcomes: "Avg time-to-payment (28 days vs industry 62)", "First-pass acceptance rate (94% vs industry 78%)", "Claim denial recovery rate (84% via auto-appeals)", "Providers using Reckon (1,408)".
- Provider story: "Dr. Ines Calderón DDS · 3-chair dental practice in Miami · recovered $48,408 in previously-denied claims in 2025".
- Pricing: 4% of collected revenue (no fee on denied claims, no monthly minimum) OR Custom ($1,499/mo flat for $200k+/mo collections).
- FAQ: "Priced compared to current billing company (typically 8-10%)?", "Do you actually call insurance on appeals or just resubmit?", "Which payers and clearinghouses do you connect to?", "Credentialing services?", "What if denied for non-medical-necessity — do you fight that?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 9 — Personal / Portfolio (5 pages, mixed modes)

```
Brief: Produce 5 PERSONAL PORTFOLIOS — a single individual's home page. NOT a product landing. Structurally completely different: no pricing, no FAQ, no testimonials grid, no feature trio. Instead: name + role bio + selected work + writing/talks + about + contact. Quieter, slower, typography-driven. Frank Chimero meets Tobias van Schneider meets a craftsperson's calling card.

SHARED AESTHETIC (all 5 variants):
- Display: variant-specific — usually serif (Source Serif 4, Fraunces, Newsreader) for emotional weight.
- Body: Inter 400 OR Newsreader 400.
- Mono: JetBrains Mono 400 — used only for dates, locations, metadata footnotes.
- Long reading line widths (max-w-prose ~ 65ch) — slower scan rhythm.
- Asymmetric layouts: text doesn't always center, often slightly left-shifted with margin notes on the right.
- "Marginalia": small mono notes at the right edge of paragraphs (page-numbered references, side commentary).
- Subtle paper / cream background.
- Soft animations: fade-in-on-scroll for new sections (not aggressive).
- Single-page (no real navigation — anchors only).

SHARED SECTION SKELETON (DIFFERENT from product landings):
1. Sticky thin nav: just the person's wordmark + 3-4 anchor links (Work, Writing, About, Contact). NO sign-in, NO CTA pill.
2. Hero: name as DISPLAY size (often serif), role in 1 line below, 1-2 sentence bio paragraph (max-w 50ch). Optional small photo / avatar / illustration to the right or below.
3. Selected work: 3-6 case study cards with image placeholder (gradient blob simulating photo) + serif title + 1-line client + 1-line outcome. Cards stack vertically OR grid-cols-2.
4. Writing / talks / press: a numbered LIST (not grid) with mono dates + serif titles + venue/publication + short blurb. 6-12 entries.
5. About (long-form prose): 2-3 paragraphs. Includes "places I've worked" (timeline as mono list: 2022—Now / Company / Role) + "things I make outside work" (woodworking, ceramics, photo — humanize).
6. Now / currently: short "what I'm doing now" snippet (4-6 lines, dated).
7. Contact: large email link + 3-4 social link icons (Twitter, LinkedIn, GitHub, RSS). Optional booking link.
8. Footer: minimal — name + © year + "made by hand · last updated" mono.

VISUAL FLOURISHES SPECIFIC TO PORTFOLIOS:
- Drop-cap on the about paragraph.
- Decorative rule (28px hairline) above each section heading.
- Marginalia at section starts: small mono "§ Work — selected 2018–2025" right-aligned.
- Hover state on work cards: subtle lift + accent underline grows from left.
- Inline italic emphasis on one phrase per paragraph.

THE 5 VARIANTS:

VARIANT 01: Marquee — Yuki Tanaka, brand designer in Tokyo.
- Mode: warm dark. Bg #14110D. Accent: warm orange #F97316 (sparingly). Text #F4EEE0.
- Display font: Source Serif 4 weight 500, italic for emphasis.
- Bio: "Yuki Tanaka — Brand designer in Tokyo. I help founders find the visual language that already wants to come out."
- Selected work (4 cards): "Atrium — Series-A SaaS brand refresh · 2024", "Reverb — Music tech identity from scratch · 2023", "Hana Pottery — DTC e-commerce visual system · 2023", "Cargo Studio — co-founding designer · ongoing".
- Writing/talks: 8 entries — "Brand systems are conversations" essay 2026, talk at Brand New Conf 2025, podcast guest on Design Details.
- About (with drop-cap): "I went to Tama Art University in Tokyo and spent four years at a Sogetsu ikebana studio before landing in brand design through a side door — I think arrangement, balance, and negative space matter more than which Pantone you choose..."
- Now: "Currently consulting for 3 early-stage founders on visual identity systems. Open to 1 more engagement starting Q3 2026."

VARIANT 02: Notebook — Jamie Lin, indie SaaS builder.
- Mode: light + warm. Bg #FBF8F2. Accent: deep coral #C53A22 (rare). Text #1F1B16.
- Display font: Inter 600 (NOT serif — signals indie hacker aesthetic).
- Bio: "Jamie Lin — I build small SaaS products. Notebook is what I call this site because that's what it is — every project I've shipped, plus what I've learned doing it."
- Selected work (5 cards): "Codex Tags — $4,408 MRR · feeds aggregator for indie devs", "Pivot Alert — $1,408 MRR · price-drop alerts for Steam games", "Sift — $402 MRR · spam filter for personal email", "Halcyon Tracker — sunset · habit tracker", "Cinder Notes — open source · markdown knowledge tool".
- Writing/talks: 12 entries — quarterly "indie hacker income reports", talk at Microconf Europe 2025, "How I priced my SaaS in a week" essay.
- About: "I quit my Series-B engineering job in 2022 to see if I could make a living building tiny SaaS products. I haven't replaced my salary yet but I'm getting closer every year, and I'd rather keep doing this than go back. I write about it openly because the indie hacker space lies a lot."
- Now: "Working on a new product, Pebble Notes — a small notes app for people who type too fast for normal note-taking. Open beta in Q3."

VARIANT 03: Frame — Hana Ito, photographer.
- Mode: pure dark. Bg #000000. Accent: subtle warm gold #C8A88A (only on link underlines). Text #FFFFFF.
- Display font: Source Serif 4 italic, weight 400 — like a museum caption.
- Bio: "Hana Ito — photographer based in Brooklyn and Tokyo. I shoot people at work — engineers, chefs, dancers, surgeons. Editorial + commissioned."
- Selected work: image-first grid — 12 placeholder gradient cards in brick layout (different aspect ratios — full-bleed wide / portrait / square mixed). Hover shows caption (project name + client + year).
- Writing/talks: "PUBLICATIONS" — list of 14 magazines featured: Aperture Mag, Tide Quarterly, The Reading Room, Form Press, Coastline Annual.
- About: "I went to art school for painting and switched to photography after a documentary class in my third year. I make pictures because painting felt too slow for what the world looks like now."
- Now: "Currently working on a long-form series about hospital surgeons in Lagos. Will exhibit in Tokyo spring 2027."

VARIANT 04: Sketchbook — Priya Anand, illustrator.
- Mode: cream paper. Bg #FBF6EB. Accent: deep teal #2D5F66 (rare). Text #1A1714.
- Display font: Newsreader weight 500. Body is Newsreader 400 for prose.
- Bio: "Priya Anand — illustrator working in editorial, books, and identity. I make pictures that hold up at small sizes and don't argue with the words around them."
- Selected work (6 cards): "Cover for The Believer · Issue 138 · 2025", "Book illustration · 'Cinder Hill' by Maya Levenson · Henry Holt · 2024", "Brand mark for Tide Coffee · 2023", "Editorial set for The Atlantic · climate piece · 2024", "Sticker pack for Linear · 2024", "Greeting card series · self-published · ongoing".
- Writing/talks: less talks, more interviews + features. 6 entries.
- About: "I was a biology major in college and learned to draw because my professors made us draw what we saw under microscopes. I still mostly draw what I see — but the things I see now are usually metaphors people pay me to make visible."
- Now: "Open for editorial commissions starting Q3 2026. Have 2 book covers under contract through 2027."

VARIANT 05: Resume — Marcus Tobin, senior engineer & consultant.
- Mode: pure light. Bg #FFFFFF. Accent: charcoal #1A1A1A (mono). Text #0A0A0A.
- Display font: Inter 600 — restrained, no flourish. The page IS the resume.
- Bio: "Marcus Tobin — Distributed systems engineer. I work with high-performance teams on database internals, query planning, and concurrency. Available for short engagements."
- Selected work (5 entries, NOT cards — list format with mono dates):
  - "2024—Now · Forecast · Founding engineer · Built the realtime query engine"
  - "2021—2024 · Linnea · Staff engineer · Led Postgres-to-Cockroach migration"
  - "2018—2021 · Halcyon · Senior engineer · Distributed tracing platform"
  - "2016—2018 · Stratos Protocol · Engineer · Custom k-d tree index for geo queries"
  - "2014—2016 · Atrium · Engineer · Started here out of CMU CS"
- Writing/talks: technical talks at SREcon, PgCon, Strange Loop. Open-source contributions to Postgres, Bevy, Tokio.
- About: "I write code professionally for ~10 years. I'm picky about the work I take on because most companies don't actually need someone like me — they need to hire 5 mids. If you actually have a hard distributed-systems problem and want someone with deep query engine + concurrency experience for 4-12 weeks, here's how to reach me."
- Now: "Booked through Q3 2026. Available for a 6-week engagement starting October."

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 10 — Pre-launch / Coming Soon (5 pages, mixed modes)

```
Brief: Produce 5 landing pages that are PRE-LAUNCH teasers — minimal, single-purpose, hype-building. NO pricing, NO testimonials, NO long feature lists. Just enough copy to make someone subscribe to a waitlist. Apple's September event teaser meets indie launch meets Kickstarter intro page.

SHARED AESTHETIC (all 5 variants):
- Display: HUGE — clamp(72px, 12vw, 200px) display sizes. Tight letter-spacing -0.04em.
- Body: minimal — usually 1-2 short sentences max per section.
- Lots of whitespace. Sections breathe.
- Single primary CTA throughout (waitlist email signup).
- Optional: countdown timer to launch date (real CSS animation, fictional date 90-120 days out).
- Animated subtle background (gradient shift, particles, mesh — slow + low-key).
- No nav bar at top (or minimal — just wordmark, maybe one "About" link).

SHARED SECTION SKELETON (much shorter than product landings):
1. Minimal nav OR no nav — wordmark left, MAYBE one anchor link right.
2. Hero (occupies 70-100vh): pill badge tease + HUGE display headline (1-2 lines) + 1-sentence tease + email input + accent CTA pill ("Join the waitlist" / "Get notified").
3. Optional: live counter showing N people already waitlisted (mono tabular nums).
4. Optional: countdown — days / hours / minutes / seconds to launch (mono tabular nums).
5. Optional: founder's note (signed, with photo placeholder).
6. Optional: 3-4 line "what's coming" tease.
7. Optional: backed-by / coming-from credibility row (8-12 small mono wordmarks).
8. Optional: roadmap as a numbered list (Phase 01: closed beta · Phase 02: open beta · Phase 03: launch).
9. Minimal footer: wordmark + privacy link + © year.

VISUAL FLOURISHES:
- Animated gradient mesh background (slow keyframes, low opacity).
- Pulse-dot on "waitlist active" indicator.
- Tabular nums for countdown.
- Marquee of waitlist member avatars (small circle gradients) — fictional but conveys momentum.

THE 5 VARIANTS:

VARIANT 01: Eclipse — Stealth AI startup pre-launch.
- Mode: pure dark. Bg #050505. Accent: electric purple #B388FF. Text #FFFFFF.
- Hero headline: "Something is being built. <em>Slowly</em>."
- Tease: "An AI tool for hard problems. Coming in 2026."
- Waitlist count: "4,408 builders waitlisted."
- Countdown: "Launch in 087 days · 14 hours · 02 minutes."
- Founder note: "We're a four-person team out of San Francisco and Stockholm. We've been heads-down for 11 months. — Maya, founding engineer."
- Backed by: 6 fictional VC logos (Halcyon Capital, Cinder Fund, Beacon Ventures, Coast Partners, Linnea Capital, Stratos VC).
- Footer: just wordmark + privacy + ©.

VARIANT 02: Constellation — Indie SaaS waitlist (open beta soon).
- Mode: dark navy. Bg #0A0F1A. Accent: cyan #67E8F9. Text #FFFFFF.
- Hero headline: "The CRM you'll <em>actually</em> use."
- Tease: "A solo-founder CRM that thinks like you do. Open beta in October."
- Waitlist count: "1,402 founders waitlisted."
- Countdown: "Beta opens in 028 days · 14 hours."
- Founder note: "I quit my Salesforce job because their CRM made me want to quit my Salesforce job. — Jamie, building Constellation alone."
- "What's coming" 3-line tease: contact management as a graph, AI follow-up scheduling, single keyboard-driven UI.
- Footer minimal.

VARIANT 03: Tide — Product Hunt launch tease.
- Mode: cream + warm. Bg #FAF6F0. Accent: warm coral #FF5A36. Text #1A1714.
- Hero headline: "Tide — launching <em>on Product Hunt</em>."
- Tease: "A scheduling tool that doesn't think it's a calendar. Launching October 14."
- Waitlist count: "8,408 makers excited."
- Countdown: "Launching in 014 days · 04 hours."
- "What is Tide" 4-line tease + 4-card preview of features with rough sketches.
- "Help us launch big" 3-step list: (1) follow on Product Hunt, (2) get an upvote reminder email, (3) we'll DM you on launch day.
- Founder photo + signature.

VARIANT 04: Pulse Lab — Hardware preorder.
- Mode: dark. Bg #000000. Accent: amber #F5C26B. Text #FFFFFF.
- Hero headline: "Pulse Lab — the desk timer for <em>deep work</em>."
- Tease: "Wood + brass + a single button. Made in Brooklyn. 200 units in the first batch."
- Hero mockup: photo placeholder of the device (gradient cylinder simulating a wooden timer with a brass button).
- "Preorder open" with $148 price + Estimated delivery: November 2026.
- Inventory counter: "078 of 200 spoken for."
- Founder note: 2 paragraphs about why a physical desk timer in 2026.
- "Why this exists" 3-line tease.
- Press: 4 fictional press mentions (Wirecutter, Kickstarter, Field Notes, The Verge).

VARIANT 05: Vellum — Writer's pre-launch newsletter.
- Mode: paper light. Bg #FBF8F0. Accent: deep sienna #B05030. Text #1A1714.
- Display font: serif (Newsreader weight 500). Editorial vibes throughout.
- Hero headline: "<em>Vellum</em> — a weekly letter starting January 2026."
- Tease: "Long-form pieces about engineering culture, every Tuesday morning. From the desk of Maya Levenson, Issue 01 lands January 14, 2026."
- About the writer: 2-paragraph bio with serif italic emphasis on key phrases. Photo placeholder.
- "What it'll be" 4-line tease: "Each issue will be ~2,000 words. No paywall, no ads. Just one writer, one editor, one good idea per week."
- Sample piece teaser: 3 fictional issue titles + dates.
- Subscribe form: email + "I write twice and rest once a year".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 11 — Event / Conference (5 pages, mixed modes)

```
Brief: Produce 5 landing pages for events — conferences, workshops, hackathons, summits, meetups. SXSW / Strange Loop / Config / Future Workshop level. Information-dense (schedule, speakers, venue), big register CTAs, social proof via past attendees, sponsor logos.

SHARED AESTHETIC (all 5 variants):
- Display: variant-appropriate — usually large, often italic for moment-driven feel.
- Body: Inter 400-500.
- Mono: dates, times, room numbers, ticket types.
- "Live event" pulse-dot on "Register open" or "Sold out — waitlist".
- Ticket card with serif typography for sense of artifact.
- Schedule grid with time columns and session blocks (color-coded by track).
- Speaker cards: photo placeholder + name + role + company.

SHARED SECTION SKELETON:
1. Nav: wordmark + Schedule, Speakers, Venue, Sponsors, Register links + accent CTA pill "Register" / "Buy tickets".
2. Hero: pill badge with date + venue + countdown ("Mar 18-19 · Brooklyn · 47 days away") + huge display headline + 1-sentence tagline + ticket CTA + key info row (date, location, format).
3. About the event: 2-paragraph description + small mockup of "what to expect" (3-4 cards: keynotes / workshops / networking).
4. Speakers grid: 12-24 speaker cards in 4-col grid. Each: photo placeholder + name + role + company + mono session title.
5. Schedule: tabular by day. Time-blocked rows. Multi-track if applicable (color-coded). Each row: time + session title + speaker + room + duration.
6. Sponsors: tiered logo grid (Platinum/Gold/Silver/Community) with mono labels.
7. Venue: photo placeholder + address + map link + "Getting there" tips (subway / parking / hotels nearby).
8. Tickets: 2-3 tier pricing (Early bird / Standard / Late) OR (Member / Industry / Student) with mono prices + features.
9. Past attendees / testimonials: 6-8 quote cards from past editions.
10. FAQ: 5 event-specific (refund policy, recording availability, dress code, dietary restrictions, accessibility).
11. Final register CTA banner.
12. Footer: org details + privacy + © + sponsorship inquiry email.

VISUAL FLOURISHES:
- Countdown to event date.
- Schedule grid: visually striking time blocks.
- Speaker carousel with hover state.
- Ticket "stub" graphic with perforation lines.

THE 5 VARIANTS:

VARIANT 01: Refract — Tech conference, 2 days.
- Mode: dark. Bg #0A0F14. Accent: cyan #67E8F9. Text #F4F6F8.
- Display font: Inter 700 large display.
- Event: "Refract Conf 2026 — March 18-19 — Brooklyn — Two days on building durable systems."
- Audience: senior engineers, EMs, principal engineers.
- Speakers: 24 fictional names (Maya Levenson — Distributed systems at Forecast, Priya Anand — Staff at Linnea, Marcus Tobin — Founding Eng at Cinder).
- Schedule: 2 days × 4 tracks. Day 1 morning keynote + 2 workshops. Day 1 afternoon 6 talks. Day 2 similar.
- Sponsors: 4 platinum (Linear, Vercel, Stripe, Neon) + 8 gold + 12 community.
- Venue: "The Refinery · Brooklyn Navy Yard · accessible · 600 capacity".
- Tickets: Early Bird ($499 — sold out), Standard ($799), Student ($199 — 50 spots).
- FAQ: refund window 1 week before, recordings free for attendees + $99 public 60 days later, accessibility (ASL, captions, accessible venue).

VARIANT 02: Forge Lab — 4-session masterclass workshop.
- Mode: cream + warm. Bg #FAF6EF. Accent: warm sienna #B05030. Text #1F1B16.
- Display font: Source Serif 4 italic.
- Event: "Forge Lab — Distributed Systems Mastermind — 4-week intensive · April 2026 · Online".
- Audience: senior engineers wanting depth on consensus, fault-tolerance, partitions.
- Format: 4 weekly 3-hour sessions + async work + Slack community. 28 spots.
- Instructor: "Dr. Yusuf Abara — formerly principal at Forecast and Cinder, taught at CMU".
- Schedule: Week 1 Consensus protocols (Raft, Paxos, ZAB). Week 2 Replication models. Week 3 Failure modes + recovery. Week 4 Capstone — design a small distributed system.
- Sponsors: minimal (1-2 community).
- Tickets: $1,499 standard (28 spots, 12 confirmed already), $399 community grant rate (4 spots reserved).
- FAQ: prerequisites (production engineering experience), live attendance required for Weeks 1-3 (only Week 4 recorded), refund window 2 weeks, cohort size cap, certificate.

VARIANT 03: Cohort — Hackathon weekend.
- Mode: dark. Bg #0F0F12. Accent: electric green #5BFF89. Text #FFFFFF.
- Display font: Inter 800.
- Event: "Cohort Hack — 48 hours · LA · April 5-7 · ship a real product".
- Audience: developers (10 LOC for years to fresh bootcampers welcome).
- Theme: "Build something a single user would pay $10 for."
- Schedule: Friday 6pm kickoff + dinner + team formation. Saturday 8am-midnight hack. Sunday 8am-2pm finish + demos.
- Prizes: $14,408 cash for top 3 + free workspace + audience-choice swag.
- Sponsors: 6 sponsors (cloud credits, dev tools, food/coffee).
- Venue: "Beacon Studios · DTLA · 200 capacity · all-night access".
- Tickets: Hacker ($89 — food, swag, judging), Spectator ($24 — Sunday demos only).
- FAQ: solo or team (1-4), what to bring (laptop, charger, hoodie — beds NOT provided), Wi-Fi capacity (yes, hardened), dietary options, license of submissions (you own it).

VARIANT 04: Summit — Invite-only industry summit.
- Mode: deep navy + gold. Bg #0E1A3A. Accent: gold #C8A06A. Text #F4F2EE.
- Display font: Fraunces serif 500.
- Event: "Stratos Summit 2026 — by invite — November 7-9 — Mendocino, CA — for engineering leaders at scale".
- Audience: VPs, CTOs, principal engineers at 500+ person companies. Capped 80 attendees.
- Format: 3 days at a coastal lodge. Daytime 4 sessions/day with 2 keynotes. Evenings dinners + bonfire conversations.
- Speakers: 12 carefully curated names, no slides allowed for half the sessions.
- Sponsors: NONE (no sponsor signage, pure attendee fees model).
- Venue: "Stratos Lodge · 200 acres · Mendocino coast · 80 rooms + meeting hall".
- Tickets: $4,408 standard (3 nights lodging + all meals + activities). Scholarships for underrepresented attendees.
- FAQ: Why no sponsors? (we don't want sales pitches). Recording? (no — Chatham House rules). Dress code? (no). Dietary? (catered for everything). Bring partner? (yes for $1,499 add-on, partner gets day-off track).

VARIANT 05: Salon — Recurring monthly meetup series.
- Mode: warm light. Bg #FBF8F2. Accent: deep coral #C53A22. Text #1A1714.
- Display font: Newsreader serif 500.
- Event: "Brooklyn Engineering Salon — third Wednesday of every month — small + free".
- Audience: NY-based engineers, ~80-120 per session.
- Format: 6pm doors + drinks, 7pm 1 talk + Q&A, 8pm open conversation + snacks, 10pm done.
- Past lineup: 28 sessions held, 4-6 listed by topic + speaker.
- Sponsors: 3 friend-companies covering venue + drinks.
- Venue: "Atrium Loft · 47 Berry St · Brooklyn · subway accessible".
- Tickets: Free with RSVP. 110 spots monthly. Waitlist common after RSVP fills (typically full within 4 hours).
- FAQ: Code of conduct (yes, take it seriously), recording (no — built for live attendance), photography (only with consent), what topics (anything technical, no pitches), open to non-engineers (welcoming but content is engineering).

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 12 — Agency / Studio (5 pages, mixed modes)

```
Brief: Produce 5 landing pages for creative agencies/studios — brand design, dev shop, motion design, marketing/growth, architecture. Pentagram / Mast / frog level. Heavy on case studies (selected work with outcome metrics), restrained aesthetic, team page emphasis, "process" diagrams.

SHARED AESTHETIC (all 5 variants):
- Display: variant-appropriate — usually serif or large sans, asymmetric.
- Body: Inter 400.
- Mono: project codes, dates, location metadata.
- Case-study cards: HEAVY visual emphasis — image placeholder is 60-70% of card, text minimal.
- Studio voice: confident, opinionated, "we work with X — we don't work with Y".
- Hover states subtle but textured.
- Studio logo treatments distinctive per variant (mark + wordmark).

SHARED SECTION SKELETON:
1. Nav: studio wordmark + 4 links (Work, Services, Process, Contact). No sign-in. CTA pill "Start a project" or "Say hello".
2. Hero: studio wordmark big + 1-sentence positioning (opinionated) + selected client logos row.
3. Selected work: 4-6 case study cards. Each: hero image placeholder + client name (mono small) + project title (serif large) + 1-line outcome metric + year. Hover reveals more.
4. Services / capabilities: 4-8 tiles with icon + h3 + paragraph. Specific to studio type.
5. Process: 3-5 step diagram (numbered, mono labels) showing how the studio engages clients.
6. Team: 4-12 person cards with photo placeholder + name + role + 1-line bio.
7. Press / awards / featured-in: 8-12 small mono wordmarks.
8. Featured case study deep-dive: ONE highlighted case with hero image + 3-4 paragraph story + outcome metrics + client quote.
9. Contact: large headline + email link + studio locations (1-3 cities) + booking calendar mention.
10. Footer: studio name + locations + © year + Privacy + sometimes a "made with care" line.

VISUAL FLOURISHES:
- "Currently engaged with" row: 3-4 client logos + "open for 1 more Q3 2026" mono.
- Awards / press row with mono publication names.
- Process diagram: connected dots/circles with mono week labels.
- Team grid with hover-to-flip cards.

THE 5 VARIANTS:

VARIANT 01: Atrium — Brand design studio.
- Mode: cream. Bg #FAF5EC. Accent: deep teal #1F4F5E. Text #1A1714.
- Display font: Source Serif 4 italic, weight 500.
- Positioning: "Atrium — A brand studio. We work on identity systems for software companies who plan to be around in 10 years."
- Founded: 2018 · NYC + Stockholm · 12 people.
- Selected work: "Linear — identity system · 2022", "Linnea — brand from scratch · 2023", "Forecast — rebrand · 2024", "Cargo — naming + identity · 2024", "Halcyon — visual system + book · 2025", "Stratos Protocol — DAO identity · 2025".
- Services: Brand strategy, Identity design, Type systems, Naming, Brand books, Implementation oversight.
- Process: 5-step — Discovery (2 weeks) → Strategy (3 weeks) → Identity design (8 weeks) → Implementation (4 weeks) → Hand-off (1 week).
- Team: 12 cards — Maya Levenson (creative director), Yuki Tanaka (senior designer), Hana Suzuki (researcher), Marcus Tobin (writer).
- Featured case: "Linnea — A brand for the engineering era". 4 paragraphs + before/after image placeholders + CEO quote + metrics: "Brand recognition +84% in 12 months · NPS +14 points · Inbound deal flow +38%".
- Contact: "Ready to start? Email start@atrium.design. We respond within 48 hours. Open for 2 new engagements in Q3 2026."
- Press: 8 mono wordmarks — Brand New, It's Nice That, Eye on Design.

VARIANT 02: Workshop — Dev shop / engineering consultancy.
- Mode: light. Bg #FFFFFF. Accent: cobalt blue #2D5BFF. Text #0A0A0A.
- Display font: Inter 700.
- Positioning: "Workshop — A small engineering shop. We build hard backend systems for companies that have already tried hiring."
- Founded: 2020 · Remote (Berlin + Brooklyn + Lisbon) · 8 engineers.
- Selected work: 6 case studies — "Forecast — realtime query engine · 2024", "Cinder Trading — order matching engine · 2024", "Halcyon Bio — bioinformatics pipeline · 2023", "Linnea — Postgres-to-Cockroach migration · 2023", "Stratos — cross-chain settlement · 2025", "Brightwave — embedded analytics · 2025".
- Services: Distributed systems, Database internals, Realtime infra, Migrations, Performance work, On-site team augmentation.
- Process: 4-step — Scoping call (1 hr free) → Pilot project (4 weeks fixed-bid) → Engagement (6-16 weeks) → Hand-off + 30-day support.
- Team: 8 senior engineers each with prior staff/principal role + brief credentials.
- Featured case: "Forecast — Realtime engine for 240k QPS". Technical details + architecture diagram placeholder + metrics: "P95 latency 4ms → 0.8ms · QPS handled 24k → 240k · Engineering team unblocked".
- Contact: "If you have a hard backend problem and want a small team that's seen it before, email project@workshop.co. Typical response 24h."
- Press: 6 mono wordmarks — InfoQ, The Pragmatic Engineer.

VARIANT 03: Reverb — Motion design studio.
- Mode: dark. Bg #0B0B0F. Accent: electric magenta #FF3E8A. Text #FFFFFF.
- Display font: Inter 800.
- Positioning: "Reverb — A motion design studio. We make tech products feel less stiff."
- Founded: 2019 · LA · 6 designers + 2 directors.
- Selected work: 5 case studies — "Vercel — product launch film · 2024", "Linear — homepage hero animation · 2023", "Cargo — brand spot · 2023", "Tide Music — campaign · 2024", "Cinder — TVC for product launch · 2025".
- Services: Brand films, Product motion, UI animation, Spots, Site animations, Direction for tech brands.
- Process: 4-step — Brief + reference → Storyboard → Animation + revisions (2 rounds) → Final + delivery.
- Team: 8 cards with motion specialists.
- Featured case: "Vercel — A product launch film". 3 paragraphs + still frames + outcome: "Views in 30 days · 4.2M · Time-on-page lifted +28% · Sign-ups attributed +14%".
- Contact: "Curious if we'd be a fit? Send a brief to hello@reverb.studio. Response in 24 hours."
- Press: 4 motion design publications.

VARIANT 04: Halcyon — Marketing / growth agency.
- Mode: warm + light. Bg #FBF7EF. Accent: warm orange #F97316. Text #1A1714.
- Display font: Inter 600 + occasional serif accents.
- Positioning: "Halcyon — Growth marketing for B2B SaaS. We don't do paid ads. We do everything else."
- Founded: 2021 · Remote · 14 marketers + strategists.
- Selected work: 6 case studies — "Cinder Trading — content + SEO · 2024", "Brightwave — outbound revamp · 2024", "Linnea — webinar series · 2023", "Cargo — partnerships program · 2025", "Forecast — community + advocacy · 2024", "Pebble — launch campaign · 2025".
- Services: Content strategy, SEO, Outbound, Partnerships, Community, Webinars, Launch campaigns.
- Process: 5-step — Audit (2 weeks) → Strategy → Execution (3-6 month retainer) → Quarterly review → Renew or finish.
- Team: 14 cards.
- Featured case: "Cinder Trading — Content as a growth channel". 4 paragraphs + outcome: "Organic traffic +428% in 12 months · Inbound qualified leads × 4.2 · CAC reduced 38%".
- Contact: "We typically work on 6-month retainers starting at $14k/mo. Email partners@halcyon.co with your stage and goals."
- Press: 6 marketing publications.

VARIANT 05: Mason — Architecture firm.
- Mode: cream + warm. Bg #F5EFE4. Accent: deep teal #1C3F47. Text #1A1714.
- Display font: Fraunces serif 500.
- Positioning: "Mason — Architecture and interiors. We make spaces that feel built by people who give a damn."
- Founded: 2014 · NYC + Mendocino · 18 people.
- Selected work: 6 projects — "Stratos HQ · NYC · adaptive reuse · 2024", "Halcyon Lodge · Mendocino · ground-up · 2023", "Tide Roastery · Brooklyn · interiors · 2024", "Cinder Residence · Hudson Valley · private home · 2022", "Beacon School · Stratos · public commission · 2025", "Atrium Studio · LIC · workplace interiors · 2024".
- Services: Architecture, Interior design, Adaptive reuse, Master planning, Workplace interiors.
- Process: 5-step — Site visit → Schematic design → Design development → Construction documents → Construction administration.
- Team: 18 cards — architects + interior designers + craftsmen partners.
- Featured case: "Halcyon Lodge — A coastal retreat in Mendocino". 5 paragraphs + project photos + metrics: "Sq ft built · 8,408 · Project duration · 18 months · Awarded · ALA Honor 2024".
- Contact: "We typically take on 4-6 projects per year. Email work@masonarch.com to start a conversation. Response within 1 week."
- Press: 8 architecture publications — Architectural Record, Dwell, Wallpaper, Architectural Digest.

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 13 — Real Estate (5 pages, mostly light + cream modes)

```
Brief: Produce 5 landing pages for real-estate products — boutique brokerages, property listings sites, agent personal pages, vacation rental platforms, property-management software. Compass / Zillow / Sotheby's International / Airbnb / Doorstead level. HEAVY on photography (gradient placeholders for property photos), maps, and "place-feel" details (neighborhood data, school ratings, walk scores).

SHARED AESTHETIC (all 5 variants):
- Display: Inter Display 500-600 OR serif (Fraunces / Source Serif) for high-end brokerage variants.
- Body: Inter 400-500, comfortable line-height 1.5+ (real-estate readers slow-scan).
- Mono: Geist Mono 400 — used for listing prices, sq-ft, bed/bath counts, MLS numbers, dates.
- Tabular nums on every numeric value (price, sq ft, $/sq ft).
- Generous whitespace + soft rounded cards (16-20px radius).
- Photo placeholders: warm gradient blobs simulating real-estate photography. Big — 16:9 hero, 4:3 cards.
- Map placeholders: SVG outline of a generic city street grid OR pin-cluster overlay.
- "Place pills": small mono badges with neighborhood / city / state / zip.

SHARED SECTION SKELETON:
1. Nav: wordmark + 4 nav links (Buy, Sell, Agents, Resources) + Sign-in + accent CTA pill ("Search homes" / "Get an estimate").
2. Hero: pill badge + display headline + sub paragraph 25 words + dual CTA + LARGE property photo placeholder (or map view) taking ~50% of hero width.
3. Search bar: prominent location-search input — placeholder text shows actual neighborhood ("Park Slope, Brooklyn") + price range slider + bed/bath filters + "Apply" pill. Even if non-functional, it should look REAL.
4. Featured listings grid: 6-9 property cards. Each: photo placeholder + price (mono tabular) + address + 3 key stats (beds · baths · sq ft) + neighborhood pill + "Just listed" or "Open Sunday" badge for some.
5. Map + listings split: split-pane mockup — left has map with pin clusters at major neighborhoods (zoomable feel via stacked circles), right has 3-4 property cards.
6. Big alternating feature: market data dashboard OR neighborhood guide OR agent matching tool. Specific to variant. Includes a small chart (median price trend, days-on-market).
7. Trust band: stats banner ("2,408 homes sold in 2025 · Avg days on market 18 · Client NPS 4.7/5 · Featured in WSJ, NYT, Bloomberg") OR agent count.
8. Customer / agent stories: 3-4 testimonials with photo placeholder + name + neighborhood + 1-2 sentence quote.
9. Pricing / commission section (varies): brokerage commission rates OR platform fees OR software pricing.
10. FAQ: 5 real-estate questions (commission rates, listing duration, escrow, market trends, off-market deals).
11. Final CTA: "Find your next home" or "List your property" banner.
12. Footer: 5-col with Buy / Sell / Resources / Agents / Company + state licensure mono line.

VISUAL FLOURISHES SPECIFIC TO REAL ESTATE:
- Property card: photo placeholder (16:9 or 4:3) + price overlay + "New" / "Open Sun" pill + 3-stat row.
- Map mockup: SVG grid with pin markers in accent, optional pulse animation on currently-hovered pin.
- Walk Score / Transit Score badge: small circular gauge SVG with number.
- Comparable sales table: mono columns for address / beds / sq ft / sold / $.
- Floor plan diagram: simple geometric SVG.
- Agent card: round photo placeholder + name + license number + "47 homes sold in 2025" mono.

THE 5 VARIANTS:

VARIANT 01: Doorway — A boutique brokerage in Brooklyn + Manhattan.
- Mode: cream. Bg #FAF6EE. Accent: deep teal #1F4F5E. Text #1A1714.
- Display font: Fraunces serif 500, italic for emphasis.
- Pitch: "We sell homes in five neighborhoods. We <em>know</em> all five."
- Audience: NYC buyers and sellers in $800k-$3M range looking for personal service over volume.
- Hero mockup: brownstone facade photo placeholder (warm-toned gradient) + small overlay card "227 Cumberland St · Fort Greene · $1,485,000 · Open Sat 12-2".
- Featured listings: 9 cards across Park Slope, Fort Greene, Boerum Hill, Carroll Gardens, Cobble Hill.
- Centerpiece: agent grid — 8 cards with photo placeholder + name + license + neighborhoods (each agent covers 1-2 nbhds intensely).
- Stats: Homes sold in 2025 (84), Median time on market (14 days), Above-ask sale rate (62%), Avg client NPS (4.9/5).
- Customer story: "Priya & Marcus · bought a brownstone in Fort Greene · 'Doorway showed us 12 homes total and we bought the 9th. They knew which ones we'd actually love.'"
- Pricing: Standard 5.5% commission (2.5% buyer's agent + 3% listing) OR flat-fee $14,408 for listings $1.5M+.
- FAQ Q's: "What's your commission structure for sellers under $1M?", "Do you list off-market exclusively?", "How does Doorway compare to a place like Compass or Sotheby's?", "What's the timeline from list to close in this market?", "Do you handle co-ops or only condos and townhouses?".

VARIANT 02: Plotline — A modern property listings site for buyers.
- Mode: light. Bg #FFFFFF. Accent: cobalt #2D5BFF. Text #0A0A0A.
- Display font: Inter 600.
- Pitch: "Listings that don't <em>waste your weekend</em>."
- Audience: tech-savvy buyers in 5 metros (NYC, SF, Austin, Seattle, Boston) doing $500k-$2M searches who hate Zillow's bloat.
- Hero mockup: split-pane mockup — left a map view of San Francisco neighborhoods with 14 active pins (color-coded by price range), right a scrollable listings list showing 4 cards with photos + price + stats.
- Search bar: prominent with placeholder "Mission, San Francisco" + filters for price / beds / commute time to a saved work address.
- Featured listings: 9 cards mixing markets.
- Centerpiece: "smart filters" panel — commute-time-to-work overlay on map, school district overlay, "off-market in this neighborhood" tab, saved-searches feature.
- Stats: Listings indexed (1.4M across 5 metros), Update frequency (every 12 minutes from MLS), Buyers saved $0 in fees (we're free), Off-market deals available (2,408 in 2025).
- Customer story: "Jamie Lin · bought in Mission Bay · 'I saw it on Plotline 4 hours before it hit Redfin. Made the offer that morning.'"
- Pricing: Free for buyers. We make $0 from buyers — agents pay us to be visible. No referral fees taken from buyers.
- FAQ Q's: "How is this free for buyers — what's the business model?", "How fresh is the listings data?", "Do you cover my market?", "How are off-market listings sourced?", "Can I save a search and get alerts when matching listings appear?".

VARIANT 03: Sojourn — Vacation rental marketplace for design-conscious travelers.
- Mode: warm cream. Bg #FAF5EC. Accent: warm terracotta #C66B3D. Text #1F1B16.
- Display font: Source Serif 4 weight 500.
- Pitch: "Vacation rentals we'd <em>actually stay in</em>."
- Audience: design-conscious travelers (couples + small families) frustrated by Airbnb's mediocre stock, willing to pay $300-$1,500/night for curated stays.
- Hero mockup: large 16:9 photo placeholder of a coastal cabin interior (warm-toned gradient) + small overlay "Bookable June 14-21 · 2 BR · Mendocino, CA · $480/night".
- Featured stays: 9 property cards organized by location tags ("Mendocino coast", "Catskills retreat", "Joshua Tree desert", "Hudson Valley farmhouse").
- Centerpiece: "How we curate" — 3-step explanation (we visit every property, we screen the hosts, we update photography ourselves) + 3 photo placeholders.
- Stats: Properties curated (1,408 across 47 destinations), Avg stay length (4.2 nights), Returning guests in 2025 (42%), Editorial team (12 in-house curators).
- Customer story: "Hana & Yuki · stayed at a Catskills A-frame in October · 'Sojourn has spoiled us — we can't go back to Airbnb.'"
- Pricing: 12% commission on bookings (vs Airbnb 14-18%). Hosts keep more, guests pay no service fees beyond cleaning.
- FAQ Q's: "What's the application process for hosts — can I list my place?", "What's your cancellation policy?", "Does Sojourn offer insurance for hosts?", "How does pricing compare to Airbnb for similar stays?", "Do you support stays longer than 30 days?".

VARIANT 04: Beacon — Real estate agent personal page.
- Mode: light + warm. Bg #FBF8F2. Accent: deep coral #C53A22. Text #1A1714.
- Display font: Fraunces serif weight 500.
- Pitch: "Hi, I'm Hana Suzuki. I sell homes in <em>Park Slope and Prospect Heights</em>."
- Audience: NYC buyers/sellers in Park Slope/Prospect Heights neighborhood who want a single trusted agent vs a faceless brokerage.
- Hero mockup: round portrait photo placeholder (large) + name + license + "237 homes sold since 2018 · top 2% of Brooklyn agents".
- Featured listings: 6 current listings the agent represents.
- Centerpiece: "What working with me looks like" — 4-step process (intake call → tour curation → offer strategy → close) with mono week labels.
- Stats: Homes sold (237 since 2018), Median above-ask result (+2.4%), Buyer/seller split (60/40), Repeat client rate (38%).
- Customer story: 4 testimonials with quotes from past clients, name + neighborhood + year.
- Press: agent featured in NY Times Realty, Brooklyn Magazine, etc. (4 mono wordmarks).
- Pricing: Standard 6% commission for sellers (2.5% buyer agent + 3.5% listing) OR refer to broker for flat-fee options.
- FAQ Q's: "Which firm are you with and how long?", "What's your typical timeline for a listing?", "Do you work with first-time buyers?", "How do you handle a buyer competing against multiple offers?", "Can you recommend mortgage brokers and inspectors?".

VARIANT 05: Threshold — Property management software for small landlords.
- Mode: dark. Bg #0A0A0A. Accent: electric green #5BD39B. Text #FFFFFF.
- Display font: Inter 700.
- Pitch: "Property management that <em>doesn't need an MBA</em>."
- Audience: independent landlords managing 2-20 doors (small portfolio rental investors) tired of spreadsheets and Yardi's enterprise UI.
- Hero mockup: portfolio dashboard — top card with 8 properties listed (address + occupancy status + rent collected MTD), below it a cashflow chart showing monthly net income across past 12 months. Right side: open maintenance tickets list.
- Centerpiece: "tenant portal" mockup — what the tenant sees (rent due, payment history, request maintenance, lease docs). Combined with landlord side.
- Stats: Landlords using (4,408 across US), Avg time saved per door per month (4.2 hours), Vacancy rate of users (3.8% vs national 6.2%), Tenant satisfaction (4.6/5).
- Customer story: "Marcus Tobin · 8 doors in Buffalo · 'Switched from spreadsheets in March. Now I do everything in 30 minutes/month instead of a Saturday.'"
- Pricing: Free (up to 3 doors, basic features), Pro ($24/mo for unlimited doors + payment processing + maintenance + leasing), Add-ons ($99/lease for state-compliant lease generation).
- FAQ Q's: "What states do you support for lease generation?", "Do you handle online rent payment / ACH / what fees?", "Does it integrate with QuickBooks for Schedule E?", "What about Section 8 / housing voucher landlords?", "How does maintenance ticket routing work — do I need a vendor network?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 14 — Restaurant / Hospitality (5 pages, mostly cream + warm modes)

```
Brief: Produce 5 landing pages for hospitality businesses — full-service restaurants, boutique hotels, coffee shops, wine bars, food markets. These are the BUSINESSES' own marketing pages, not the SaaS that powers them (that's Counter/Tessera in Commerce). Eleven Madison Park / Atrium Hotel / Sweetleaf Coffee / Aman / Berkshire Mountain Bakery level. HEAVY on ambient photography (gradient placeholders for food + space shots), real menus, reservation flows, chef/owner stories.

SHARED AESTHETIC (all 5 variants):
- Display: serif HEAVY (Fraunces, Newsreader, Source Serif 4, Cormorant Garamond) — restaurants signal craft via type.
- Body: Inter 400 OR Newsreader 400. Line-height 1.6.
- Mono: Geist Mono 400 — used for prices, hours, addresses, reservation times.
- Photo placeholders: warm gradients simulating food + interior + portrait photography. Think dim, candlelit, intimate.
- Menu typography: serif headlines + mono prices. Each menu item: name (serif) + description (sans light) + price (mono right-aligned).
- "Hours pill": "Open 5:30pm – 11pm · Tuesday – Saturday" mono.
- Reservation button always prominent.
- No "buy now" CTAs — it's "Reserve" / "Book a table" / "Order online" instead.

SHARED SECTION SKELETON:
1. Nav: restaurant/hotel wordmark + Menu, About, Reservations, Contact, Gift cards + accent CTA pill ("Reserve" or "Book").
2. Hero: pill badge with type ("FULL-SERVICE TRATTORIA" / "10-ROOM INN" / "ESPRESSO BAR") + display headline + sub paragraph + reservation CTA + LARGE photo placeholder of food/interior.
3. About the place: 2-paragraph story with serif italic emphasis. Often the chef or owner's perspective.
4. Menu OR Rooms OR Coffee selection — the CENTERPIECE that varies per variant. Real-feeling sections with actual prices/names.
5. Reservation widget: date picker + party size + time slots (8 visible in a row) + reserve button. Looks functional even if it's a mockup.
6. Press / accolades: small mono row of publication wordmarks ("Featured in: The Times, Eater, Bon Appétit, Saveur") OR awards (Michelin, James Beard).
7. Photo gallery section: 6-9 photo placeholders in a varied grid (some full-bleed, some thumbnails) — food, drinks, dining room, exterior.
8. Owner / chef bio: photo placeholder + serif name + 2-paragraph story.
9. Hours + location + contact band: hours mono table + address + phone (mono) + map placeholder.
10. Private events / catering blurb: 1 small section about hosting private dinners, weddings, or corporate events.
11. Footer: location address + hours + phone + Instagram link.

VISUAL FLOURISHES SPECIFIC TO HOSPITALITY:
- Menu items: serif name + sans-serif tasting description + mono price ($18 / $34) right-aligned.
- Tasting menu format: numbered courses with serif item names.
- "Today's special" pill with mono "Friday Oct 11" and accent.
- Reservation time slots: pill grid 5:00 / 5:15 / 5:30 / 5:45 ... with "Available" highlighted in accent.
- Wine list / cocktail menu: mono with origin/year.
- Photo placeholders should suggest dim lighting (warm gradient with low contrast — not bright photography).
- Accolade badges: Michelin star SVG, James Beard "Finalist" badge.

THE 5 VARIANTS:

VARIANT 01: Marcato — Full-service Italian trattoria in Brooklyn.
- Mode: warm cream + dim. Bg #FBF6EC. Accent: deep terracotta #B05030. Text #1A1714.
- Display font: Fraunces italic 500 for headlines, regular 500 for menu items.
- Pitch: "Pasta cut by hand. Wine from <em>one valley</em>. Open since 2019."
- Audience: Brooklyn locals + travelers booking 4-week-ahead reservations for date nights and small gatherings.
- Hero mockup: dim photo of a candlelit table with pasta + wine glasses + soft hands.
- Centerpiece menu: tasting menu format — "ANTIPASTI" / "PRIMI" / "SECONDI" / "DOLCI" sections with 4-5 items each. Examples: "Bresaola — beef cured 4 months, San Marzano · $19", "Tagliatelle al ragù — 14-hour bolognese · $29", "Branzino — sea bass, salt-crusted, served whole · $54".
- Press: 5 publications — NYT Dining, Eater Best Of 2024, Bon Appétit Top 10 Italian, James Beard nominee.
- Owner bio: "Marcato Bianco — born in Bologna, trained at Babbo and Lilia, opened Marcato in 2019 with his sister Sofia (front of house)".
- Hours: Tue-Thu 5:30-10pm · Fri-Sat 5:30-11pm · Sun 5-9pm · Closed Mondays.
- Reservations: book on Resy 4 weeks ahead. Bar seating walk-in only.

VARIANT 02: Halcyon Lodge — A 10-room coastal inn in Mendocino.
- Mode: warm cream + sage. Bg #F5EFE4. Accent: deep sage #3F6F4F. Text #1F1B14.
- Display font: Newsreader serif 500.
- Pitch: "Ten rooms. <em>Ocean from each one</em>. Nothing else."
- Audience: couples seeking quiet weekends within 3hrs of SF, willing to pay $400-$800/night for a curated stay.
- Hero mockup: dim photo of a coastal cabin interior with fireplace + wide window showing ocean fade.
- Centerpiece "rooms": 10 room cards in a 3-col grid — each with photo placeholder + room name (serif: "The Cove", "The Lookout", "The Cypress") + 1-line description + base rate.
- Centerpiece "what's included": 4-card layout (breakfast included, no Wi-Fi rooms by request, fireplaces stocked, ocean access in 90 seconds).
- Press: 4 placements — Conde Nast Traveler, NY Times Travel, Sunset, Travel + Leisure.
- Owner bio: "Hana Tomita and her partner Marcus built Halcyon Lodge in 2018, after 12 years in restaurant kitchens — they wanted a quieter craft".
- Hours / reservations: 2-night minimum on weekends. Direct booking saves the 12% Booking.com fee.

VARIANT 03: Tide Coffee Roastery — A specialty roaster + café in DTLA.
- Mode: cream. Bg #FAF5EC. Accent: warm orange #C66B3D. Text #1F1B16.
- Display font: Inter 700 for display, mono for prices.
- Pitch: "Single-origin coffee. Roasted Tuesday. <em>Ground in front of you</em>."
- Audience: LA coffee snobs and locals doing daily orders + visiting tourists wanting "the specialty spot".
- Hero mockup: pour-over preparation photo (warm-toned, hands + V60 + clear glass).
- Centerpiece menu: drinks menu in 3 columns (Espresso · Filter · Specialty). Examples: "Cortado · $5", "Hario V60 — Ethiopia Yirgacheffe · $7", "Cardamom oat latte · $7".
- Coffee for home: 4 single-origins as 12oz bags (Ethiopia Yirgacheffe $24, Colombia La Esperanza $22, Guatemala Pulcal $26, Kenya Karatu $28).
- Centerpiece "Open to roast tours": 3-step process (book a tour, see the Probat roaster in action, taste 4 origins side by side).
- Hours: Mon-Fri 7am-3pm · Sat-Sun 8am-4pm.
- Press: 4 mentions in Sprudge, LA Eater, LA Magazine, Sightglass features.
- Owner bio: "Hiroshi Tanaka started Tide in 2016 after sourcing for Blue Bottle for 8 years — wanted to do it smaller and slower".

VARIANT 04: Anchor & Vine — A natural wine bar in Williamsburg.
- Mode: dark + warm. Bg #18120A. Accent: gold #C8A05A. Text #F4EEDC.
- Display font: Cormorant Garamond italic, Fraunces serif as fallback. Serif on dark.
- Pitch: "Natural wine. <em>Honest food</em>. No reservations needed."
- Audience: Brooklyn locals 28-40 looking for a walk-in spot for wine + small plates after work.
- Hero mockup: dim photo of a bar counter with wine glasses + dim warm lights + people in conversation.
- Centerpiece wine list: organized by region (Loire, Beaujolais, Etna, Slovenia, etc.). Each entry: producer (serif) + appellation (mono) + year + price by-glass / by-bottle. "Loire Valley · Domaine de la Pépière · Muscadet 2022 · $14 / $52".
- Small plates menu: 12 items, serif names + prices ("Whipped lardo on grilled bread · $11", "Anchovies on butter · $14", "Octopus terrine · $18").
- Reservations: walk-in only. Bar seats 22.
- Press: 4 mentions in PUNCH, Wine Enthusiast, NY Mag, Bon Appétit.
- Owner bio: "Sofia Russo opened Anchor & Vine in 2020 after sommelier years at Frenchette and a brief stint at Septime in Paris".

VARIANT 05: Berkshire Bakery — A wood-fired bakery in the Hudson Valley.
- Mode: paper light + warm. Bg #FBF7EE. Accent: deep cinnamon #8E4F1B. Text #1A1410.
- Display font: Newsreader serif 500.
- Pitch: "Sourdough. Croissants. <em>One ingredient less</em> in everything."
- Audience: Hudson Valley locals + weekend visitors from NYC doing pickup orders + day-trippers.
- Hero mockup: warm photo of a hand cutting into a sourdough boule on a wooden table.
- Centerpiece bake list: weekly bake schedule shown as a calendar — "Tuesday: country sourdough, baguettes · Thursday: pain au chocolat, croissants · Saturday: chocolate babka, cinnamon roll · Sunday: pretzels, focaccia".
- Pricing list: serif items + mono prices — "Country sourdough · $11", "Baguette · $5", "Pain au chocolat · $4.50".
- Pickup model: order Wednesday by 9pm, pick up Saturday 8am-noon. Limited walk-in stock.
- Press: 4 mentions in NY Mag Best Of, Hudson Valley Magazine, Edible Hudson Valley, Cherry Bombe.
- Owner bio: "Lila Russo trained at Tartine and Acme — opened Berkshire Bakery in 2022 to bake fewer things, better".
- CSA / subscription: $48/mo for weekly bread + croissant pickup.

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 15 — E-commerce PDP (5 pages, mixed modes)

```
Brief: Produce 5 landing pages that are SINGLE-PRODUCT detail pages for DTC (direct-to-consumer) brands. Allbirds shoes / Magic Spoon cereal / Cometeer coffee / Eight Sleep mattress / Hims testosterone / Aesop hand cream level. Each page sells ONE physical product to consumers. Heavy on multiple product images, variant selection, size/fit guides, reviews, "add to cart" UI, and conversion-focused copy.

SHARED AESTHETIC (all 5 variants):
- Display: Inter Display 500-700 OR variant-appropriate serif (Fraunces for premium/beauty, Inter for athletic/tech).
- Body: Inter 400-500.
- Mono: Geist Mono 400 — for SKUs, prices, model numbers, sizing.
- Tabular nums for prices, ratings (4.7 stars), review counts (1,408 reviews).
- Photo placeholders: simulate clean studio product photography. Hero placeholder is LARGE (50%+ of viewport on desktop).
- Variant selector chips (Size XS/S/M/L/XL or Color Black/Cream/Sand) — selected state with accent ring.
- "Add to cart" sticky CTA on desktop scroll (mock — visible after scrolling past hero on desktop).
- Star rating: 5 SVG stars with accent fill.
- Review snippets with name + verified badge + date.
- Free shipping / 30-day return badges in trust-bar.

SHARED SECTION SKELETON:
1. Sticky nav: brand wordmark + 4 nav links (Shop, About, Reviews, Stockists) + cart icon with count.
2. Hero PDP: 2-col split — left has 4-5 product photo placeholders (1 hero + 3-4 thumbnails to swap), right has product info: name + price (large) + 3-star rating with review count + 1-sentence description + variant chips (size / color / quantity) + add-to-cart button + 3-bullet trust row (free shipping, 30-day returns, 1-year warranty).
3. "Why X" features 3-col grid: 3 reason cards with small icon + h3 + paragraph (material, durability, sustainability claims).
4. Big alternating feature 1: product detail photo + paragraph explaining materials / process / craftsmanship + small data callout.
5. Big alternating feature 2: lifestyle photo + paragraph + customer quote inline.
6. Size guide / fit guide / how-to-use section: 3-4 cards with diagrams (size chart table, fit illustrations, dosing schedule, washing instructions).
7. Reviews section: aggregated star rating + count + filter pills + 5-8 review cards. Each card: avatar circle + name + verified badge + 5 stars + headline + 2-3 sentence body + photos (1-2 small placeholders) + helpful count.
8. FAQ: 5 product-specific questions.
9. Comparison: "X vs alternatives" small table (3-col) showing why this beats competitors.
10. Press / featured-in row: 6-8 publication wordmarks.
11. Final CTA: bottom CTA "Add to cart" / "Subscribe and save 15%" banner with photo.
12. Footer: 5-col with Shop / About / Help / Sustainability / Company + Instagram + Privacy.

VISUAL FLOURISHES SPECIFIC TO E-COMMERCE:
- Image gallery: hero + 4 thumbs with click-to-swap (use simple JS in head to swap visible image — okay per shared constraints).
- Star rating row with mono review count "4.7 (1,408 reviews)".
- Variant chips: color swatches as small filled circles, size as pill chips, selected state with ring.
- "Bundle and save" widget: 3 items in a row with checkmarks + discounted bundle price.
- "Subscribe and save" toggle: One-time vs Every 4 weeks (-15%) — radio toggle.
- Add-to-cart button: large, accent background, "Add to Cart · $48" with mono price.
- Sticky bar appears on scroll past hero with product name + variant + add-to-cart.

THE 5 VARIANTS:

VARIANT 01: Pebble Walkers — Casual everyday sneakers.
- Mode: light. Bg #FAFAF7. Accent: deep navy #0E1A3A. Text #1A1714.
- Display font: Inter 600.
- Product: "Pebble Walkers — the everyday sneaker. Merino wool upper, FSC-certified rubber sole. $128."
- Audience: 25-45 year olds who walk a lot, want one quality pair, and care about materials.
- Hero photos: 5 photo placeholders — side angle, top down, on foot, sole detail, lifestyle (urban walking).
- Variants: 6 colors (Cream, Slate, Charcoal, Sand, Olive, Mahogany) + sizes (M 6-13, W 5-12).
- Features: "Merino wool — temperature regulating year-round", "FSC-certified rubber — sustainable supply chain", "Removable insole — air drying friendly", "100,000 footsteps tested — durability rated".
- Size guide: chart for M + W + diagram showing how to measure foot length.
- Reviews: 1,408 reviews, 4.7 stars. Featured review from "Marcus T. · NYC · purchased 8 months ago: 'I've walked 400 miles in these. Still feel like new.'"
- Press: Outside Magazine "Best Walking Shoe 2025", GQ, NY Times Wirecutter, Refinery29.
- Pricing: $128 one-time. Subscribe-and-save not offered (durable goods, single purchase).
- FAQ Q's: "What's the sole made of and is it slip-resistant?", "How does sizing run — should I size up?", "Are these washable?", "What's the return policy if they don't fit?", "Vegan version available?".

VARIANT 02: Cometeer Cold Brew — Frozen coffee capsules.
- Mode: light + cool. Bg #FCFCFC. Accent: deep purple #4B2E83. Text #0A0A0A.
- Display font: Inter 700 (modern tech-vibe for new format).
- Product: "Cometeer — flash-frozen coffee in capsules. Real specialty coffee, no machine needed. $48 / box of 8."
- Audience: serious coffee drinkers who don't want to do daily brewing but won't accept Nespresso quality.
- Hero photos: 5 — capsule pack hero, capsule held in hand, melting into hot water, in iced drink, side-by-side with espresso shot.
- Variants: 4 origin packs (Ethiopia, Colombia, Guatemala blend, Decaf) + quantity (8-pack one-time vs 8-pack subscription).
- Features: "Flash-frozen at -321°F — locks in fresh-brewed flavor", "Specialty grade only — 87+ score from Q-grader", "10 second prep — drop in hot water or milk", "Recyclable aluminum + compostable foil seal".
- Subscription: One-time $48 vs Every 2 weeks ($40, -17%).
- Reviews: 4.6 stars, 8,408 reviews. Featured: "Hana S. · Brooklyn: 'I dropped my $400 espresso machine routine. These taste better.'"
- Press: NY Times Wirecutter, Bon Appétit Best Coffee 2024, Sprudge, Cherry Bombe.
- FAQ Q's: "How long does the capsule stay good frozen?", "Can I make iced coffee — what's the dilution?", "Is this real specialty coffee or bulk grade?", "What's the carbon footprint of frozen shipping?", "Do you offer single-origin subscriptions or only the blend?".

VARIANT 03: Atrium Loft Mattress — A wool-and-coil hybrid mattress.
- Mode: cream. Bg #FAF7F1. Accent: deep teal #1F4F5E. Text #1A1714.
- Display font: Fraunces serif 500 italic for emphasis.
- Product: "Atrium Loft — wool, latex, pocket coils. <em>One mattress, 100-night home trial</em>. From $1,448 Queen."
- Audience: 30-55 year olds replacing a 10-year-old mattress, looking for natural materials over memory foam.
- Hero photos: 5 — bedroom lifestyle shot, layer cutaway, top down on bedframe, wool detail, latex detail.
- Variants: sizes (Twin XL $1,148, Full $1,348, Queen $1,448, King $1,748, Cal King $1,748).
- Features: "Talalay latex — 100% natural, no off-gassing", "American wool — temperature-regulating", "Recycled-steel pocket coils — 988 in queen", "FSC-certified wood frame in case version".
- Centerpiece layer diagram: cross-section SVG showing 7 layers from cover to base.
- 100-night trial: 3-step process visualization (order → ship in 5 days → sleep 100 nights → keep or return).
- Reviews: 4.8 stars, 2,408 reviews. Sleep specialist quote.
- Press: Wirecutter "Best Natural Mattress 2025", Good Housekeeping, Dwell.
- FAQ Q's: "What's the firmness — can I customize?", "How is it shipped — boxed or unboxed?", "Is it really edge-supportive?", "How does the 100-night trial work if I return it?", "What's the warranty and is it transferable?".

VARIANT 04: Solva — A skincare retinol serum.
- Mode: light + warm. Bg #FBF7F0. Accent: warm coral #E07863. Text #1A1410.
- Display font: Source Serif 4 italic for headers, Inter for body.
- Product: "Solva — 0.5% encapsulated retinol serum. <em>Clinical-strength, derm-tested</em>. $68 / 30ml."
- Audience: 28-50 year olds investing in skincare, willing to pay $40-$80 per product for evidence-based formulas.
- Hero photos: 5 — bottle on hand, dropper detail, applied to skin (cheek closeup), packaging, ingredient lab shot.
- Variants: strength levels (0.25% for beginners, 0.5% standard, 1.0% advanced) + bottle size (15ml $38, 30ml $68).
- Features: "0.5% encapsulated retinol — slow-release, less irritation", "Niacinamide 5% — brightening + soothing", "Squalane base — non-comedogenic", "Derm-tested on 240 participants over 12 weeks".
- Routine guide: when to use (PM only) + what to pair with (NOT vitamin C, YES hyaluronic acid) + ramp-up schedule (2x/week → daily over 4 weeks).
- Before/after section: 3 side-by-side photo placeholders with weeks-of-use labels (4 weeks, 8 weeks, 12 weeks).
- Reviews: 4.7 stars, 1,402 reviews. Featured derm quote: "Dr. Sarah Chen, board-certified dermatologist".
- Press: Allure, Marie Claire, Glamour, byrdie, refinery29.
- Subscription: One-time $68 OR every 8 weeks ($58, -15%).
- FAQ Q's: "Can I use this if I'm pregnant or breastfeeding?", "How long until I see results?", "Is this comedogenic?", "Can I use this with my prescription retinol?", "What's the bottle opacity — does it preserve the actives?".

VARIANT 05: Quire — A leather notebook.
- Mode: warm dark + cream details. Bg #14110D. Accent: cream #F4EEDC. Text #F4EEDC.
- Display font: Newsreader serif 500.
- Product: "Quire — A leather-bound A5 notebook. <em>Refillable, 240 pages</em>. $94."
- Audience: writers, designers, executives, students 25-55 wanting a heritage object for daily journaling.
- Hero photos: 5 — closed cover, open with handwritten pages, leather grain closeup, on a desk lifestyle shot, refillable mechanism detail.
- Variants: 4 leather colors (Saddle, Cognac, Black, Forest), 2 paper types (Lined, Dot grid), monogram option (+$14).
- Features: "Vegetable-tanned leather from Tärnsjö, Sweden — ages with use", "Tomoe River 68gsm paper — fountain-pen friendly", "Refillable — replace the insert every ~6 months", "Made by hand in Brooklyn — 4-week lead time".
- Monogramming: 3-letter monogram embossed on cover, available in 4 fonts shown side-by-side.
- Refill subscription: $24 every 4 months (Tomoe River insert refill).
- Reviews: 4.9 stars, 808 reviews. Featured: "Marcus T. · writer in Seattle: 'I bought it 3 years ago. It's now my favorite object.'"
- Press: Field Notes blog, Cool Hunting, Uncrate, Hodinkee, Quill & Pad.
- FAQ Q's: "How long is the lead time to ship?", "What if my fountain pen feathers — does Tomoe River?", "Can I monogram in Spanish or Japanese?", "Is the leather cruelty-certified?", "Do you offer larger sizes (A4, journal)?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 16 — Climate / Sustainability (5 pages, mixed modes)

```
Brief: Produce 5 landing pages for climate-tech and sustainability products — corporate carbon accounting, ESG dashboards for investors, supply-chain traceability, regenerative agriculture platforms, climate consulting. Watershed / Persefoni / Plan A / Sweep / Pachama level. Visual language: charts (emissions over time, scope 1/2/3 stacked bars), supply-chain maps, certification badges, "data-feel" but with a green sensibility (not garish eco-cliché — think Linear meets a carbon accounting firm).

SHARED AESTHETIC (all 5 variants):
- Display: Inter Display 600-700, -0.025em letter-spacing.
- Body: Inter 400-500.
- Mono: Geist Mono 400 — for emissions numbers (CO₂e), measurement units, dates, certification IDs.
- Color palette: data-driven greens (NOT bright eco-green) — deep forest, sage, moss, gray-greens. Or accent could be dark navy or warm earth tone with green data viz.
- Tabular nums on every CO₂e / tCO₂e value.
- Hairline borders rgba(0,0,0,0.08) on light / rgba(255,255,255,0.07) on dark.
- Certification badges: small mono uppercase tracking-wide — "SBTi-aligned", "B-Corp", "GRI-compliant", "TCFD-disclosed", "ISO 14064-1".

SHARED SECTION SKELETON:
1. Sticky nav: wordmark + 4 nav links (Platform, Methodology, Case studies, Pricing) + Sign-in + accent CTA pill ("Start a free audit" / "Get a demo").
2. Hero: pill badge with methodology mention ("SBTi-aligned methodology" / "GHG Protocol certified") + display headline (half-tone trick) + sub paragraph 25 words + dual CTA + product mockup (dashboard / map / report). Mockup ~50% of hero.
3. Trust bar: "Used by 408 companies tracking 14.4 Mt CO₂e" + customer wordmarks marquee + certification badges row.
4. Centerpiece dashboard mockup: BIG product detail — emissions dashboard with scope 1/2/3 stacked area chart, supply-chain map, abatement scenario planner, or compliance report. Specific to variant.
5. Features 3-col grid: each col has icon + sans h3 + paragraph + sub-bullet checkmarks. Climate-specific (automated calculation, scope coverage, audit trail, reporting frameworks).
6. Methodology section: dedicated band explaining the calculation approach with mono spec — "We use GHG Protocol Scope 1/2/3 boundaries · IPCC AR6 GWP factors · annually reviewed by Bureau Veritas".
7. Stats banner: 4 metric cards ("14.4 Mt CO₂e tracked" / "84% scope 3 coverage avg" / "Methodology audit pass rate 100%" / "Companies in 47 countries").
8. Customer story: 1 spotlight company + 2-paragraph quote from sustainability lead + 3 outcome metrics row.
9. Reporting frameworks supported: badges grid showing TCFD, CDP, GRI, SASB, EU CSRD, SEC climate disclosure.
10. Pricing: 2-3 tier OR call-to-discuss model (enterprise climate-tech is typically sales-led).
11. FAQ: 5 climate-specific questions (data sources, scope 3 estimation, audit/verification, regulatory alignment, abatement vs offset).
12. Final CTA: gradient banner with demo CTA.
13. Footer: 5-col with Platform / Methodology / Resources / Company / Climate disclosures (their OWN scope 1/2/3 footprint).

VISUAL FLOURISHES SPECIFIC TO CLIMATE:
- Stacked area chart: scope 1 / 2 / 3 emissions over 5 years with mono labels.
- Supply chain map: SVG with nodes (suppliers) connected by edges (material flow) + CO₂e weight per edge.
- Abatement curve / MACC chart: bars sorted by $/tCO₂e abated.
- Certification badge row in mono.
- "Net zero by 2030" pill with progress bar mockup.
- Methodology footnote with mono superscripts (¹GHG Protocol · ²IPCC AR6 · ³Bureau Veritas).

THE 5 VARIANTS:

VARIANT 01: Tideline — Carbon accounting for mid-market companies.
- Mode: light. Bg #FFFFFF. Accent: deep forest #2F5F47. Text #0A1410.
- Display font: Inter 600.
- Pitch: "Your company's footprint — measured, audited, <em>reported</em>."
- Audience: sustainability/finance leads at 200-2,000 person companies starting their first carbon-accounting program, facing CSRD / SEC disclosure mandates.
- Hero mockup: emissions dashboard — current FY footprint card (14,408 tCO₂e), scope 1/2/3 breakdown stacked bar, year-over-year trend line, top emission sources table.
- Centerpiece methodology: "How we calculate" — 4-step (data ingestion via spend + meter readings + invoices → emission factor application → scope assignment → audit review). Each step with mono spec.
- Stats: Companies tracked (408), Total CO₂e measured (14.4 Mt), Avg scope 3 coverage (84% — vs industry 38%), Audit pass rate (100% across Bureau Veritas reviews).
- Customer story: "Linnea Inc · 1,400 employees · series-C SaaS · published first CDP disclosure in 6 weeks vs typical 6 months".
- Pricing: Starter ($2,408/mo, scope 1 + 2 + simplified scope 3 for <500 employees) + Pro ($4,408/mo, full scope 3 + frameworks + audit support) + Enterprise (custom for 2,000+ employees).
- FAQ Q's: "What's your scope 3 estimation methodology — spend-based, activity-based, or hybrid?", "Are you audited by Bureau Veritas or DNV?", "Do you support CSRD reporting for EU subsidiaries?", "How do you handle insetting vs offsetting?", "What's your data ingestion model — do I need to upload spreadsheets monthly?".
- Logos: Linnea, Forecast, Cargo, Halcyon, Cinder, Brightwave, Stratos, Atrium.

VARIANT 02: Tendril — ESG dashboard for institutional investors.
- Mode: dark. Bg #0A1410. Accent: sage green #7CA982. Text #F4F8F2.
- Display font: Inter 700.
- Pitch: "Real climate data on every company in your portfolio. <em>Not glossy ESG scores</em>."
- Audience: ESG analysts and portfolio managers at PE / asset management / pension funds with $1B+ AUM, frustrated by MSCI/Sustainalytics black-box scores.
- Hero mockup: portfolio screen — 47 holdings table with columns (Company / Sector / Mkt Cap / Scope 1+2 CO₂e / Scope 3 / Trend / SBTi status). One company highlighted with detailed flyout showing 5-year emissions trend chart.
- Centerpiece "Drill into any company": company profile mockup with sourced data fields (emissions, water use, board diversity, etc.) each with link to underlying disclosure (10-K, CDP, sustainability report).
- Stats: Companies covered (4,408 public + 1,408 private), Data sources per company (47 on avg), Update frequency (data refreshed within 14 days of disclosure), AUM analyzed by Tendril clients ($248B).
- Customer story: "Halcyon Capital · $14B PE fund · used Tendril to identify 8 portcos lagging on SBTi alignment, drove targeted engagement".
- Pricing: by AUM — $48k/yr ($1-5B AUM), $148k/yr ($5-50B), Enterprise (custom for $50B+ + multi-asset class).
- FAQ Q's: "How does this differ from MSCI ESG ratings or Sustainalytics?", "What's the data quality — primary vs estimated?", "Do you cover private companies and how is that data sourced?", "Can I integrate Tendril data into our IBOR or PMS?", "How are you compliant with EU SFDR?".
- Logos: Halcyon Capital, Stratos VC, Cinder Fund, Lattice Asset Management, Pavilion Partners, Coast Capital, Beacon Investors.

VARIANT 03: Strand — Supply chain traceability for fashion and food brands.
- Mode: cream + warm. Bg #FAF5EC. Accent: warm earth #8E4F1B. Text #1A1714.
- Display font: Source Serif 4 weight 500.
- Pitch: "Trace every component, from <em>farm to label</em>."
- Audience: sustainability and sourcing leads at $50M-$1B fashion or food brands wanting to verify supply chain claims (Fairtrade, GOTS, organic, etc.) and prep for EU due-diligence laws.
- Hero mockup: supply chain map — origin (Peru cotton farm) → ginning facility → mill in Tamil Nadu → cut-and-sew in Vietnam → distribution → retail. Each node with CO₂e + certification badges + photo placeholder.
- Centerpiece traceability: "Click any product to see its full chain" — example garment (T-shirt) with 12 traceability nodes from cotton field to shelf, each with verification badge.
- Stats: Products traced (148,408 SKUs), Suppliers in network (4,408 across 47 countries), Audit findings logged (28,408), Avg time from order to traceability report (12 days).
- Customer story: "Yuki Pottery + Hana Made · indie skincare brand · achieved Climate Neutral certification in 90 days vs typical 6 months using Strand's traceability data".
- Pricing: Per-SKU tier ($148/SKU/yr for <500 SKUs) + Pro ($14,408/yr for 500-5k SKUs + supplier portal) + Enterprise (custom).
- FAQ Q's: "How do you verify supplier claims — site audits, blockchain, or trust-but-verify?", "Do you support CSRD / EU CSDDD compliance?", "What certifications do you map to (GOTS, Fair Trade, GRS, etc.)?", "How long does onboarding take for a 500-SKU brand?", "Can I share supplier data publicly via a QR code?".
- Logos: Cargo Apparel, Atrium Goods, Linnea Textiles, Beacon Foods, Stratos Crafts, Halcyon Apparel.

VARIANT 04: Floodgate — Regenerative agriculture data platform.
- Mode: light + warm earth. Bg #FBF7EE. Accent: deep moss #4A7A4A. Text #1A1410.
- Display font: Inter 600 + occasional serif italic accent.
- Pitch: "Soil that holds carbon. <em>Farmers paid to do it</em>."
- Audience: regenerative ag co-ops, food brands buying outcome-based commodities, and carbon offset buyers wanting real soil-carbon data (not just acres).
- Hero mockup: farm field map — bird's-eye view of a 408-acre farm divided into 28 management zones, color-coded by soil organic carbon (SOC) change. Side panel: "+1.8 tCO₂e/acre/yr · 14% SOC increase since baseline · Cover crops 84% of season".
- Centerpiece "How we measure soil carbon": 4-step process — baseline soil sample → annual remote sensing + targeted resamples → carbon accrual calculation → payment to farmer per verified tCO₂e.
- Stats: Acres enrolled (1.4M across 47 states), Farmers in network (4,408), tCO₂e sequestered in 2025 (148,408), Avg per-acre payment ($28/acre/yr).
- Customer story: "Berkshire Farm Co-op · 124 farmers · earned $1.4M in soil carbon payments in 2025, 38% above commodity prices".
- Pricing: Free for farmers (we take 18% of verified carbon payment) + Buyer ($148/tCO₂e for verified soil carbon credits with 100-year permanence guarantee).
- FAQ Q's: "How is soil carbon measured at scale — remote sensing accuracy?", "What's the additionality and permanence story?", "Who's your verifier (Verra, Gold Standard, registry)?", "Do farmers actually get paid above commodity rates?", "How does this compare to nature-based offset projects?".
- Logos: Berkshire Co-op, Halcyon Foods, Cargo Naturals, Stratos Grains, Pavilion Agriculture.

VARIANT 05: Compass Climate — Climate consulting for industrial decarbonization.
- Mode: dark. Bg #0E1410. Accent: cyan-teal #4FAA9A. Text #F2F4F0.
- Display font: Inter 700.
- Pitch: "We make heavy industry's net-zero plan <em>actually feasible</em>."
- Audience: VPs of sustainability + ops at heavy industry / manufacturing / cement / steel / chemicals companies trying to plan capital allocation for decarbonization.
- Hero mockup: abatement curve (MACC chart) — 28 abatement levers sorted by $/tCO₂e, color-coded by feasibility (green = ready now, amber = needs CapEx, red = pre-commercial tech). Filter pills above for "By 2030", "2030-2040", "2040-2050".
- Centerpiece scenario planner: side-by-side comparison of 3 abatement pathways (full electrification, hydrogen + CCS, hybrid) with capex / opex / emissions reduction for each.
- Stats: Industrial sites analyzed (408 across cement / steel / chemicals / paper), Total tCO₂e in abatement plans we authored (148.4 Mt by 2035), Capex modeled ($14.8B), Industry sectors covered (12 heavy industries).
- Customer story: "Stratos Steel · 4 mills · used Compass to identify $1.4B of abatement opportunities below $80/tCO₂e, board approved $480M phase-1 in Q3".
- Pricing: Engagement-based — Scoping ($148k flat, 8 weeks), Strategy ($480k+, 12-20 weeks), Implementation support ($1.4M+/yr retainer).
- FAQ Q's: "What's your sector specialization — do you handle cement, or only steel?", "How is your modeling different from McKinsey / BCG climate practices?", "Do you have engineering capability for capital project scoping?", "How do you handle policy uncertainty (EU CBAM, US 45Q)?", "Can you support transition finance structuring (sustainability-linked debt, transition bonds)?".
- Logos: Stratos Steel, Cinder Cement, Halcyon Industrial, Beacon Chemicals, Pavilion Manufacturing, Atrium Paper.

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 17 — Mobile App Landing (5 pages, mixed modes)

```
Brief: Produce 5 landing pages for CONSUMER MOBILE APPS — Apple App Store / Google Play Store aesthetic with a phone mockup as the centerpiece. Headspace / Cash App / Linear Mobile / Whoop level. The phone mockup IS the hero — everything orbits around it.

SHARED AESTHETIC (all 5 variants):
- Display: Inter Display 700, letter-spacing -0.035em.
- Body: Inter 400-500, line-height 1.55 (looser, consumer-friendly).
- Mono: Geist Mono 400 — only for version numbers / in-app metrics.
- Phone mockups: stylized iPhone-shape SVG with rounded corners (~8% radius), notch, status bar (mono "9:41" time + battery + signal icons). Screen content rendered as HTML inside the phone frame via clip-path or container.
- Phone tilt: 3D perspective `rotateY(-6deg) rotateX(2deg)` with soft glow underneath (radial-gradient accent at 30% opacity, 80px blur).
- App Store + Google Play badges: SVG badges in hero CTA area (NOT just "Download" buttons).
- Animated phone screens: subtle CSS scroll animation inside the phone frame (~12s loop).
- More chroma than B2B (less hairline, more bloom + gradient).

SHARED SECTION SKELETON:
1. Nav: app icon (rounded square) + wordmark + 3-4 nav links + sign-in text + accent CTA pill linking to App Store.
2. Hero: 2-col split. Left: pill badge ("Featured on App Store · Editor's Choice"), display headline 6-10 words, sub 25 words, dual CTA (App Store badge + Google Play badge), 4.8★ rating row with "12,408 reviews". Right: PHONE MOCKUP showing the main screen with live-animation.
3. App icon + tagline band: huge centered rounded-square app icon (gradient or glyph), 1-line tagline below.
4. "How it works" 3-step grid: each step has a smaller phone mockup showing the screen for that step.
5. Feature trio with phone mockups: 3 alternating rows, each with phone showing a different screen + text describing the feature.
6. Outcomes banner: 4 user-facing metrics ("Sleep improved 38 min/night avg", "Downloaded 4.4M times in 2025").
7. Reviews carousel: 5-star reviews with reviewer first name + location ("Hana, Tokyo · ★★★★★ · This app changed my mornings.")
8. App Store rating section: BIG 4.8★ display + ratings breakdown chart (5-star 84%, 4-star 12%, etc.).
9. FAQ: 5 consumer-app questions (privacy, offline use, subscription cancellation, device support, free vs paid tier).
10. Final CTA: BIG centered phone with App Store + Google Play badges.
11. Footer: minimal — app icon + wordmark + Privacy / Terms / Support / Careers + © year.

VISUAL FLOURISHES SPECIFIC TO MOBILE:
- Phone mockup at 50-60% hero width on desktop.
- App icon rendered as 80px rounded-square (16% radius) gradient with optional glyph centered.
- Star ratings as SVG (filled gold stars + half star where applicable).
- "Featured on App Store" badge in hero.
- App Store screenshots strip: 4-5 phone-aspect tiles showing different screens in horizontal scroll.
- Subtle floating animation on hero phone (gentle 4-6s up/down bob).

THE 5 VARIANTS:

VARIANT 01: Lumen — A sleep + meditation app for adults who can't unwind.
- Mode: gradient dark→lavender. Bg radial from #0A0814 (top) to #1A0E2E (bottom). Accent: deep lavender #B388FF. Text #F4F0FA.
- Pitch: "Fall asleep without <em>thinking about it</em>."
- Audience: adults 25-50 with chronic sleep struggles, willing to pay $14/mo for a tool that helps them wind down without screens-in-bed guilt.
- Hero phone mockup: tonight's program — "12-min wind-down · 8-min body scan · 22-min sleep story · 2-hr ambient" with soft "Begin" CTA at bottom.
- 3-step: (1) Tell us about your nights, (2) Get a tonight-only program, (3) Track patterns without obsession.
- Outcomes: Avg sleep onset improvement (32 min faster after 30 days), Members renewing past month 6 (84%), Sleep stories in library (240+), App Store rating (4.8 from 28,408 reviews).
- Reviews: 5 real-sounding short reviews — "I'd tried Calm and Headspace. This one finally got the assignment. — Priya, Brooklyn".
- Pricing: Free (3 sessions/week + basic library) + Plus ($14/mo, unlimited + tonight programs + sleep journal).
- FAQ: "Does it work without headphones?", "Can I use it offline on flights?", "How does it compare to Calm?", "What's the cancellation flow?", "Are voices AI-generated or human?".

VARIANT 02: Ribbon — Expense splitting for couples (not roommates).
- Mode: warm cream. Bg #FAF7F0. Accent: sage green #7CA982. Text #1F1B16.
- Pitch: "The money conversation, <em>without the conversation</em>."
- Audience: couples (married, partnered, cohabiting) who hate Splitwise's frat-house vibe and want something quieter + adult.
- Hero phone mockup: home — "This month · You owe Hana $148.42" + recent transactions list (Whole Foods $84.20 split 50/50, Verizon $128 split 60/40, rent auto-split 50/50).
- 3-step: (1) Connect both your accounts, (2) Set your default split (50/50, by income, custom), (3) See where the month landed — no math required.
- Outcomes: Couples on Ribbon (208,408), Money-fight reduction (self-reported −62% in survey), Auto-categorization accuracy (94%), App Store rating (4.7 from 14,402 reviews).
- Reviews: "We stopped having the 'who paid for what' fight. — Marcus & Yuki, Brooklyn".
- Pricing: Free (1 shared budget + manual entry) + Plus ($8/mo, bank-sync + recurring bills + tax-year exports).
- FAQ: "Do you see our actual transactions?", "What if our incomes are very different?", "Does it work with joint AND separate accounts?", "Can we use this if we're not married?", "How is this different from Splitwise?".

VARIANT 03: Slate — A notes app for people who type too fast.
- Mode: paper light. Bg #FCFCF8. Accent: charcoal #1A1A1A. Text #0A0A0A.
- Pitch: "Notes that <em>keep up</em>."
- Audience: knowledge workers (PMs, researchers, writers) who outgrew Apple Notes but find Notion overwhelming.
- Hero phone mockup: note editor — title "Q4 planning thoughts" in serif body, sidebar with folder structure (Inbox · Work · Personal · Archive), Cmd+K bar visible at top.
- 3-step: (1) Capture anywhere (widget, share extension, lock-screen), (2) Organize lazily — or not at all, search finds it, (3) Sync across all devices in ~80ms.
- Outcomes: Active users (1.4M), Notes synced daily (28M), Avg sync latency P95 (84ms), App Store rating (4.9 from 47,408 reviews).
- Reviews: "Notes app that finally respects my keyboard. — Jamie, Stockholm".
- Pricing: Free (1k notes + 1 device) + Pro ($4/mo, unlimited + all devices + version history + share links).
- FAQ: "Is my data encrypted?", "Does it work offline?", "Can I import from Apple Notes / Bear / Obsidian?", "What's the markdown story?", "Is there a web version?".

VARIANT 04: Sprout — Language learning that doesn't feel like a game.
- Mode: gradient light → mint. Bg radial from #FFFFFF to #ECFDF5. Accent: emerald #10B981. Text #064E3B.
- Pitch: "Learn to <em>speak</em>, not to swipe."
- Audience: adults 22-45 who want to actually become conversational in Spanish / Japanese / French / Mandarin within 6 months — tired of Duolingo's gamification loops.
- Hero phone mockup: conversation practice screen — AI tutor speaking in Spanish (waveform animation), user's response shown as transcribed text with subtle accent correction overlay, "Try again" button.
- 3-step: (1) Take a 5-min placement, (2) 15 min/day adaptive lessons + 2 weekly AI conversations, (3) Hit conversational by month 4 (~85% of consistent users).
- Outcomes: Adult learners worldwide (1.4M), Hit conversational milestone by month 4 (84% of consistent users), Languages supported (12 with native AI tutors), App Store rating (4.8 from 38,408 reviews).
- Reviews: "Six months of Sprout > 3 years of Duolingo. — Hana, San Francisco".
- Pricing: Free (1 language, 5 lessons/week + 1 AI conversation/week) + Plus ($14/mo, unlimited everything + offline + accent training).
- FAQ: "How is this different from Duolingo / Babbel / Pimsleur?", "Is the AI tutor a real voice or synthetic?", "Can I practice for the DELE / JLPT?", "Does it work offline on long flights?", "What languages are coming next?".

VARIANT 05: Stride — A running coach in your pocket.
- Mode: dark + neon. Bg #08090A. Accent: electric green #5BFF89. Text #FFFFFF.
- Pitch: "Train for your race. <em>Not for an algorithm</em>."
- Audience: runners (5k → marathon) training for a goal race, age 25-50, want adaptive coaching without a $200/mo human coach.
- Hero phone mockup: today's workout — "Threshold tempo · 5 mi · 7:42 pace target · 28 min" with the route map below and a green "Start workout" CTA.
- 3-step: (1) Tell us your goal race + date, (2) Get a 16-week plan that adapts to your sleep + HRV + life, (3) Show up on race day ready.
- Outcomes: Runners hit goal time (84% of consistent users), Avg plan completion (78% vs industry 18%), Marathons run by Stride users in 2025 (38,408), App Store rating (4.9 from 14,408 reviews).
- Reviews: "PR'd my marathon by 14 min. Coach Stride knew what to do. — Marcus, Austin".
- Pricing: Free (basic plans + GPS) + Plus ($14/mo, AI coach + adaptive plan + HRV integration + race-day strategy).
- FAQ: "What watches does it work with (Garmin, Apple, Coros)?", "Can I import training history from Strava?", "What if I miss a workout — does it re-plan?", "Are the plans certified-coach-reviewed?", "Does it work for ultra distances?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 18 — Course / Cohort / Online Education (5 pages, mixed modes)

```
Brief: Produce 5 landing pages for ONLINE COURSES, cohort programs, bootcamps, workshops, and membership communities. Maven / Lambda / Frontend Masters / Reforge / Akimbo level. Editorial gravitas for the content + modern enrollment urgency.

SHARED AESTHETIC (all 5 variants):
- Display: variant-specific — usually Inter Display 700 OR Source Serif 4 500 italic for the editorial-y ones.
- Body: Inter 400-500, line-height 1.55.
- Mono: Geist Mono 400 — for cohort dates, syllabus weeks, seat counts.
- Instructor photos: warm gradient blobs (no faces) at portrait aspect with hairline border.
- Syllabus rendered as numbered week-by-week list with mono week labels.
- "Cohort dates" mono pill: "Cohort 12 · Apr 18 → May 30 · 14 of 24 seats taken".
- Enrollment urgency: countdown timer to enrollment deadline + seat counter.
- Lots of alumni testimonials with name + role + company + outcome metric.

SHARED SECTION SKELETON:
1. Nav: wordmark + 4 links (Syllabus, Instructor, Alumni, FAQ) + sign-in text + accent CTA pill ("Enroll now" or "Apply").
2. Hero: pill badge ("Cohort 12 · 14 of 24 seats taken"), display headline 6-10 words, sub 30 words, dual CTA ("Enroll · $1,499" + "Read syllabus"), 1-line proof ("Alumni went to Linear, Vercel, Stripe").
3. Trust bar: 8-10 alumni-company wordmarks ("Where our alumni work") in marquee.
4. "What you'll learn" 4-week grid: each week as a numbered card with bullet points of topics + project deliverable.
5. Instructor section: photo placeholder + bio (3 short paragraphs) + 4 credentials in mono ("Ex-Stripe Eng · MS CMU · Author of X").
6. Syllabus deep-dive: collapsible accordion with each week expanded showing 4-6 specific lessons + reading list + project.
7. Alumni outcomes: 4 ROI cards ("78% got a promo within 6 months", "Avg salary delta +$28,408", "184 graduated across 12 cohorts", "Cohort completion rate 89% vs industry 8%").
8. 3-4 alumni testimonials with photo placeholder + name + role/company + 3-sentence quote + outcome metric.
9. Format / logistics section: cohort length, weekly time commitment, live sessions vs async, refund policy, prereqs.
10. Pricing: 1-2 tier (most cohorts are single-tier). Stripe checkout CTA. Scholarship mention if relevant.
11. FAQ: 5 cohort-specific questions (refund, time commitment, prereqs, certificate, missing live sessions).
12. Final CTA: "Cohort 12 opens April 18 · 10 of 24 seats taken" + enroll button.
13. Footer: minimal — wordmark + Cohorts archive + About + Privacy + © year.

THE 5 VARIANTS:

VARIANT 01: Atelier — Self-paced design fundamentals course.
- Mode: warm cream. Bg #FAF5EC. Accent: deep coral #C53A22. Text #1F1B16.
- Display: Source Serif 4 500 italic.
- Pitch: "Learn to <em>see</em> before you learn to draw."
- Audience: working PMs, engineers, marketers (28-45) who want to up-level visual taste — not become designers, but read design.
- Format: 12 self-paced modules, 4-6 hours each, lifetime access. No live sessions.
- Instructor: "Yuki Tanaka — brand designer (formerly at IDEO, currently consulting Series-A founders)".
- Outcomes: Alumni reporting "actually use this weekly" (84%), Modules completed avg per learner (10.4 of 12), Total learners (8,408), Refund rate (<2%).
- Pricing: $399 one-time (lifetime access + 1 portfolio review).
- FAQ: "Is this for me if I'm not a designer?", "How long does it take to finish?", "Do I get a certificate?", "Can my company expense it?", "What if I don't like module 1 — refund?".

VARIANT 02: Hatch — A 12-week full-stack bootcamp with job placement.
- Mode: dark + amber. Bg #08090A. Accent: amber #F5C26B. Text #F4F2EE.
- Display: Inter Display 700.
- Pitch: "Career-change to engineering in 12 weeks. <em>No CS degree required</em>."
- Audience: career-switchers (24-40) with 0 coding background, willing to commit 40+ hrs/week for 12 weeks for a $74k+ first dev role.
- Format: 12 weeks full-time, live Mon-Fri + 1:1 mentorship + capstone project + job-placement support up to 6 months post-grad.
- Instructor team: 4 lead instructors with photos + ex-FAANG / startup backgrounds.
- Outcomes: Job placement rate 6 months post-grad (84%), Avg starting salary ($82,408), Alumni at top-20 startups (380+), Cohorts run since 2022 (28).
- Pricing: $14,408 upfront OR $0 upfront + 12% ISA on first $80k salary for 24 months. Scholarships for underrepresented (4 per cohort).
- FAQ: "What's the actual job placement rate, audited?", "Income-share-agreement terms — fine print?", "Do I need to know any coding to start?", "What if I can't find a job — refund?", "Visa support for international students?".

VARIANT 03: Praxis — 6-week cohort seminar on critical thinking.
- Mode: paper light. Bg #FBF8F0. Accent: deep forest #2D5F3F. Text #1A1714.
- Display: Newsreader 500 (serif).
- Pitch: "Read closely. Argue precisely. Think for <em>yourself</em>."
- Audience: knowledge workers (PMs, founders, analysts, writers) who want to sharpen reasoning — 28 spots per cohort, application-based.
- Format: 6 weeks · Tuesday + Thursday 7-9pm ET · live discussion · 4 essays · final synthesis paper.
- Instructor: "Dr. Maya Levenson — PhD Philosophy Princeton, formerly lectured at Stanford, founding editor at The Reading Room".
- Reading list mention: 12 carefully chosen texts spanning Aristotle to Annie Dillard.
- Outcomes: Alumni reporting "changed how I read" (94%), Cohorts run (14 since 2023), Application acceptance rate (28%), Returning alumni for follow-on cohorts (38%).
- Pricing: $1,499 standard. $499 reduced rate for grad students + non-profit workers (4 spots per cohort).
- FAQ: "How is this different from a philosophy class on Coursera?", "How much weekly reading?", "What's the application process?", "Is live attendance required?", "Will I get a certificate?".

VARIANT 04: Roundtable — 1-day intensive product workshops.
- Mode: clean white. Bg #FFFFFF. Accent: electric blue #4F8FFF. Text #0A0A0A.
- Display: Inter Display 700.
- Pitch: "One day. One topic. <em>Operational depth</em>."
- Audience: senior PMs and engineering leaders who want focused 1-day deep-dives on specific topics (pricing, hiring, growth, observability) — NOT survey-of-everything courses.
- Format: 1 full day · 10am-5pm ET · live on Zoom · 24 spots · pre-reading + workshop + post-session resource pack.
- Topics: rotating monthly — "Pricing & packaging for B2B SaaS · Apr 18", "Hiring senior ICs · May 9", "Growth experiments for product-led-growth · May 30".
- Instructor varies per workshop: each topic has its own ex-operator (ex-Stripe pricing lead, ex-Linear hiring lead, etc.).
- Outcomes: Workshops run since 2024 (38), Avg NPS per workshop (84), Returning attendees (62%), Resource packs shipped (28,408 downloads).
- Pricing: $499 single workshop · $999 for 3-workshop pack (any 3 in 6 months).
- FAQ: "Will this be recorded?", "Can my company expense it?", "Are workshops live every month?", "What if I miss the live day?", "Group discounts for teams?".

VARIANT 05: Crucible — A membership community for engineering leaders.
- Mode: deep navy + gold. Bg #0E1A3A. Accent: gold #C8A06A. Text #F4F2EE.
- Display: Inter Display 700.
- Pitch: "The peer group you'd <em>actually call</em>."
- Audience: engineering leaders (Director / VP / CTO) at 50-2000 person companies, application-based, capped at 280 members.
- Format: ongoing membership · monthly small-group sessions (8 leaders, facilitated) · annual 3-day retreat · private Slack · curated essay archive.
- Founder: "Yusuf Abara — ex-VP Eng at Forecast and Cinder, ran the original 12-leader peer group in 2019 that became Crucible in 2022".
- Outcomes: Active members (280, cap), Avg tenure (28 months), Retreats hosted (12 since 2022), Application acceptance rate (14%).
- Pricing: $4,408/year (includes retreat travel for cohort discussions). Org-sponsored OK.
- FAQ: "How is this different from CTO Connection / Reforge?", "What's the application process?", "Do members actually use it or is it dead Slack?", "Can I expense this?", "What happens at the annual retreat?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 19 — Creator / Link-in-bio (5 pages, mixed modes)

```
Brief: Produce 5 SINGLE-PAGE link-in-bio sites — Carrd / Linktree / Beacons / Bento.me level. STRUCTURALLY DIFFERENT from product landings: single column, mobile-first, big name + avatar + bio + vertical stack of 5-10 CTA buttons + small footer. No pricing, no FAQ, no testimonials grid, no feature trio.

SHARED AESTHETIC (all 5 variants):
- Display: variant-specific — usually serif OR bold sans, large.
- Body: Inter 400-500.
- Mono: rare — only for "since 2018" metadata.
- Single column max-w-md (~448px) on desktop. Mobile-native.
- Hero stack: avatar (rounded circle or square, gradient placeholder), display name, role/tagline 1 line, bio 2-3 lines.
- 5-10 vertical CTA buttons (rounded-2xl, full-width). Each button: optional icon left + label + optional small subtitle right (or below).
- Hover state: subtle lift (translateY -1px) + accent ring.
- Strong personality through color + typography — each variant feels DIFFERENT.
- Background: variant-specific (gradient, photo blob, paper, dark).
- Small footer: social icons row + "made by [name]" mono.

SHARED SECTION SKELETON:
1. Hero stack (centered, ~50vh): avatar + name + role + bio.
2. CTA button stack: 5-10 buttons (each a different destination).
3. Optional: featured content card (a current project highlight with image placeholder + 1-line description + CTA).
4. Optional: upcoming events list (3-5 dates with mono date + venue + city).
5. Optional: small social icons row (Twitter, Instagram, YouTube, GitHub, etc.).
6. Footer: 1-line mono ("made with Tide · last updated Mar 2026 · ©").

THE 5 VARIANTS:

VARIANT 01: Pier — Indie musician with upcoming releases + tour.
- Mode: dark + gradient. Bg radial from #08090E to #1F0E2E. Accent: hot pink #FF4D8F. Text #FFFFFF.
- Display: Inter Display 700, italic.
- Name + avatar: "Hana Ito" — circular gradient avatar in pink→violet.
- Role: "musician · brooklyn".
- Bio: "Producing new album 'Halcyon' for spring 2026. Touring Japan in May. Hi."
- CTA buttons (8): "Listen to 'Eclipse' (latest single)" / "Tour dates" / "Merch shop" / "Instagram" / "YouTube" / "Spotify" / "Apple Music" / "Newsletter signup".
- Featured card: album art placeholder (square gradient) + "New album 'Halcyon' · May 8, 2026 · Pre-save now".
- Upcoming events: 5 tour dates (Tokyo · May 14 · Liquidroom, Osaka · May 18 · Big Cat, etc.).
- Social icons: Instagram, TikTok, YouTube, Spotify, Bandcamp.

VARIANT 02: Coil — Podcast host (audio-first link-in-bio).
- Mode: dark mono. Bg #0A0A0A. Accent: amber #F5C26B. Text #FFFFFF.
- Display: Inter Display 700.
- Name + avatar: "Marcus Tobin" — circular avatar placeholder.
- Role: "Host of The Quiet Hour · 240 episodes".
- Bio: "Weekly conversations with people doing slow, careful work. Mondays, ~38 min."
- CTA buttons (7): "Latest episode: 'On second drafts' (12 min ago)" / "Subscribe on Apple Podcasts" / "Subscribe on Spotify" / "RSS feed" / "Newsletter (weekly recap)" / "Sponsor an episode" / "Recommended reading list".
- Featured card: episode artwork placeholder + "Episode 240 · 'On second drafts' · 38 min · with Maya Levenson".
- Stats inline: "240 episodes · 8.4M downloads · 4 years".
- Social icons: Twitter, Instagram, YouTube (clips).

VARIANT 03: Inkwell — Newsletter writer (long-form, paid tier).
- Mode: paper cream. Bg #FBF6EB. Accent: deep sienna #B05030. Text #1A1714.
- Display: Source Serif 4 500.
- Name + avatar: "Maya Levenson" — soft cream avatar placeholder.
- Role: "writer · Vellum letter · Mondays".
- Bio: "Long-form essays on engineering culture. ~2,000 words, every Monday. 14,408 subscribers."
- CTA buttons (6): "Read the latest essay (Mar 14)" / "Subscribe free" / "Become a paying member ($60/yr)" / "Browse the archive (148 essays)" / "Talks + Podcast appearances" / "About me".
- Featured card: latest essay card with serif title + 1-line excerpt + read-time + date.
- Recent essays: 3-4 mono-dated entries with serif titles.
- Social icons: Twitter, RSS, Mastodon.

VARIANT 04: Halo — Lifestyle creator with affiliate links + brand collabs.
- Mode: warm gradient. Bg radial from #FFF7F0 to #FFE5D9. Accent: warm coral #FF6B5A. Text #1F1B16.
- Display: Fraunces 500 italic.
- Name + avatar: "Priya Anand" — warm gradient avatar.
- Role: "creator · NYC + Mexico City · wellness + travel".
- Bio: "Currently obsessed with: cold plunge tubs, slow mornings, Mexico City coffee shops. 408k IG."
- CTA buttons (10): "My Instagram" / "YouTube (vlogs)" / "Sunday morning routine post" / "My everyday products" / "Mexico City guide" / "Cold plunge I use (affiliate)" / "Book recommendations" / "Newsletter (Sundays)" / "Brand partnerships → email" / "Newest collab: Aesop x Halo bath ritual".
- Featured card: latest blog post image placeholder + "New post · Sunday morning routine · 12 min read".
- Affiliate disclosure mono line: "some links earn me a small commission — supports the work, costs you nothing".
- Social icons: Instagram, TikTok, YouTube, Pinterest, Substack.

VARIANT 05: Anvil — Multi-product creator (courses + books + merch + talks).
- Mode: dark + green. Bg #0F1115. Accent: electric green #5BE584. Text #F0F3F0.
- Display: Inter Display 700.
- Name + avatar: "Jamie Lin" — gradient green avatar.
- Role: "indie builder · 5 products · 28k MRR combined".
- Bio: "I ship small SaaS, write a book a year, run a 4-week course quarterly. Open about all of it."
- CTA buttons (10): "Indie hacker income report (Q1 2026)" / "My new book: 'Slow growth' ($28)" / "Founders 101 cohort (May 12-Jun 8 · 24 spots)" / "All 5 SaaS products" / "Merch shop ('built in 1 weekend' hoodie)" / "Upcoming talks (Microconf 2026)" / "Newsletter (every other Friday)" / "Twitter" / "YouTube (build streams)" / "Office hours (book 30 min · $0)".
- Featured card: book cover placeholder + "New book · 'Slow growth' · Available now · $28".
- Recent achievements line: "Featured on: Indie Hackers · Hacker News · Lenny's Newsletter".
- Social icons: Twitter, GitHub, YouTube, RSS.

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 20 — Open Source Project Home (5 pages, mixed modes)

```
Brief: Produce 5 landing pages for OPEN SOURCE PROJECT HOME pages — htmx.org / drizzle.team / biome.dev / bun.sh / astro.build / vitejs.dev level. These are the project's MARKETING + DOCS-ENTRY home, not the docs themselves. Strongly opinionated typography, code-block-heavy, GitHub-prominent, install command front and center.

SHARED AESTHETIC (all 5 variants):
- Display: variant-specific — usually mono-forward OR Inter Display tight (-0.04em).
- Body: Inter 400-500.
- Mono: Geist Mono OR JetBrains Mono — HEAVY use throughout (install commands, code examples, version numbers, file paths).
- Code blocks: syntax-highlighted with line numbers, copy button top-right, filename header tab, theme matches variant.
- GitHub star count badge prominently displayed.
- "npm install" command front and center in the hero, with one-click copy.
- Sponsor row (GitHub Sponsors / OpenCollective / Polar).
- "Used by" logo cloud of well-known companies (Vercel, Linear, Stripe, Cloudflare).
- Quick-start emphasis — get someone to "hello world" in <60 seconds.

SHARED SECTION SKELETON:
1. Sticky nav: project logo + wordmark + 4 nav links (Docs, Examples, Blog, Community) + GitHub star count + accent CTA pill ("Get started" → docs quickstart).
2. Hero: pill badge ("v2.4 · released Mar 14"), HUGE display headline (project's one-line pitch), sub 25 words, install command in a styled code block with copy button, dual CTA ("Read the docs" + "View on GitHub · 28.4k stars").
3. Trust bar: "Trusted in production at" + 8-10 well-known company logos.
4. Hero code example: BIG centered code block showing the project's most distinctive 8-15 line example. Filename tab + copy button + syntax highlighting.
5. Why-this-exists section: 3-paragraph philosophy + "Things we don't do" list (opinionated rejections).
6. Features 3-col or bento grid: 4-6 features with icon + h3 + paragraph + small code snippet.
7. Comparison table: this project vs 2-3 competitors (with checkmarks).
8. Quick-start steps: numbered 1-2-3 with code blocks per step.
9. Community section: GitHub Discussions count + Discord members + maintainers list + sponsor invitation.
10. Sponsor row: GitHub Sponsors logos of companies + individual sponsors.
11. FAQ: 5 OSS-specific questions (license, production-ready, who maintains it, will it stay free, performance).
12. Final CTA: "Get started in 60 seconds" + install command + read docs CTA.
13. Footer: 4-col with Docs / Examples / Community / About + © + MIT license mention.

VISUAL FLOURISHES SPECIFIC TO OSS:
- GitHub star counter badge with live-feel number.
- Copy-to-clipboard pulse animation on code blocks.
- Mono command prompts with `$` prefix.
- "Made with care by [maintainer] + 148 contributors" line.
- Discord / Matrix / IRC presence indicators.

THE 5 VARIANTS:

VARIANT 01: Heron — A minimalist web framework for hypermedia apps.
- Mode: paper light. Bg #FCFAF6. Accent: rust orange #C2410C. Text #1A1714.
- Display: Source Serif 4 500 italic (opinionated, htmx-inspired).
- Version: "v1.4 · Released Mar 14, 2026 · MIT".
- Pitch: "HTML is the API. <em>Always was</em>."
- Install: `npm install heron` or `<script src="https://unpkg.com/heron@1.4"></script>`.
- Hero code: 12-line HTML example with `hx-get` / `hx-trigger` attributes showing a search-as-you-type interaction.
- Why-it-exists: 3 paragraphs about why hypermedia is the right abstraction for 80% of web apps, why React is overkill, why HTMX inspired this but Heron is leaner.
- Features: server-side rendering, no build step, no bundler, 8kb gzipped, framework-agnostic backend, declarative attributes only.
- Comparison: "Heron vs React: 8kb vs 240kb · 0 build step vs Webpack · HTML attributes vs JSX". Also vs HTMX, vs Hotwire.
- Stats: GitHub stars (28,408), npm weekly downloads (148,408), Contributors (148), Production sites tracked (4,408).
- Sponsors: Vercel, Cloudflare, Sentry, Linear (fictional sponsorship), 47 individual sponsors.
- FAQ: "Is this production-ready?", "Why not just use HTMX?", "Does it work with React / Vue?", "Bundle size guarantees?", "Long-term maintenance commitment?".

VARIANT 02: Cinder — A blazing-fast structured logger for Node + Bun.
- Mode: dark. Bg #08090A. Accent: electric orange #FF6A1F. Text #F4F2EE.
- Display: Inter Display 700.
- Version: "v3.2 · Released Mar 14, 2026 · MIT".
- Pitch: "Structured logging at <em>148ns per log call</em>."
- Install: `npm install cinder` or `bun install cinder`.
- Hero code: 10-line TypeScript example showing logger setup + structured log + child logger + JSON output side-by-side.
- Why-it-exists: 3 paragraphs about why Pino is great but Cinder is 4x faster + zero-config TypeScript + better child loggers.
- Features: 148ns/log benchmark, JSON output, child loggers, redaction support, transport pipeline, hot-reload-safe, works in Bun + Node + Deno.
- Comparison: "Cinder vs Pino: 148ns vs 580ns · TypeScript-native vs JS-first · Built-in redaction". Also vs Winston, vs console.log.
- Stats: GitHub stars (14,408), npm weekly downloads (4.4M), Contributors (84), Microsoft / Vercel / Linear use it.
- Sponsors: Sentry, DataDog, Better Stack, 28 individual sponsors.
- FAQ: "Production-ready?", "Why not Pino?", "TypeScript types accurate?", "How fast is fast — what benchmark?", "Does it support OpenTelemetry?".

VARIANT 03: Borealis — A headless UI component library for React + Vue + Solid.
- Mode: dark + cyan. Bg #0A0E14. Accent: cyan #67E8F9. Text #F0F3F8.
- Display: Inter Display 700.
- Version: "v2.0 · Released Mar 14, 2026 · MIT".
- Pitch: "Unstyled components. <em>Bring your own design system</em>."
- Install: `npm install @borealis/react` or `@borealis/vue` or `@borealis/solid`.
- Hero code: 14-line JSX example showing a Dialog component composed via `<Dialog.Root>` / `<Dialog.Trigger>` / `<Dialog.Content>`.
- Why-it-exists: 3 paragraphs about why headless > styled (Radix UI inspired, but cross-framework + accessibility-tested).
- Features: 38 components across React/Vue/Solid, ARIA-compliant, keyboard navigation, RTL support, server-component-friendly, animation primitives.
- Comparison: "Borealis vs Radix UI: cross-framework vs React-only · 38 components vs 28 · Vue/Solid support". Also vs Ariakit, vs Headless UI.
- Stats: GitHub stars (48,408), npm weekly downloads (2.8M), Contributors (240), Components covered (38).
- Sponsors: Vercel, Linear, Shopify, Figma, 84 individual sponsors.
- FAQ: "Production-ready?", "How is this different from Radix?", "Will React Server Components break it?", "What about animation?", "Long-term commitment vs corporate sponsor lock-in?".

VARIANT 04: Bracket — A modern CLI framework for Rust + Go + TypeScript.
- Mode: dark + green. Bg #08090A. Accent: electric green #5BFF89. Text #FFFFFF.
- Display: JetBrains Mono 600 (mono display — leaning into the CLI aesthetic).
- Version: "v0.8 · Released Mar 14, 2026 · Apache 2.0".
- Pitch: "CLIs that <em>respect your terminal</em>."
- Install: `cargo install bracket` OR `go install github.com/bracket/cli@latest` OR `npm install -g @bracket/cli`.
- Hero code: 18-line Rust example showing command definition with subcommands, flags, help-text generation, color output.
- Why-it-exists: 3 paragraphs about why CLIs are first-class UX (not afterthoughts), and what clap/cobra/yargs do well but missed.
- Features: zero-config color output, auto-generated man pages, completion scripts for bash/zsh/fish, sub-200ms cold-start, JSON output mode for scripts, plugin system.
- Comparison: "Bracket vs Clap (Rust): faster cold-start · plugin system · 3-language consistency". Also vs Cobra (Go), vs Commander.js.
- Stats: GitHub stars (8,408), Downloads via cargo+go+npm (1.4M), Contributors (148), CLIs built with it (4,408 listed).
- Sponsors: ngrok, Fly.io, Railway, 38 individual sponsors.
- FAQ: "Production-ready?", "Why 3 languages, not 1?", "Plugin model security?", "Cold start guarantees?", "Best practices for testing a CLI?".

VARIANT 05: Mesh — A distributed K/V store with built-in replication.
- Mode: dark navy. Bg #0A0F1A. Accent: gold #E5B047. Text #F4F2EE.
- Display: Inter Display 700.
- Version: "v0.12 · Released Mar 14, 2026 · MIT".
- Pitch: "Distributed K/V <em>without the operational tax</em>."
- Install: `cargo install mesh-server` + `npm install @mesh/client` (or Go / Python clients).
- Hero code: 12-line TypeScript client example showing connect + put + get + watch + transactional update.
- Why-it-exists: 3 paragraphs about why etcd / Consul / FoundationDB are overkill for 80% of use cases, and Mesh sits in the sweet spot — bigger than Redis, simpler than Cockroach.
- Features: built-in Raft replication, multi-region, optimistic transactions, watches, range queries, 3-node minimum (no Zookeeper), ARM + x86, single static binary.
- Comparison: "Mesh vs etcd: simpler ops · multi-region built-in · range queries native". Also vs Consul KV, vs Redis (with persistence).
- Stats: GitHub stars (14,408), Production deployments tracked (1,408), Contributors (148), Avg cluster size (5 nodes).
- Sponsors: Cloudflare, Fly.io, Vercel, 28 individual sponsors.
- FAQ: "Production-ready?", "How does failover work in a partition?", "What's the throughput ceiling?", "Backup + restore story?", "How does this compare to FoundationDB?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 21 — Music / Album Release (5 pages, mixed modes)

```
Brief: Produce 5 landing pages for MUSIC RELEASES — independent musicians, album/EP launches, podcast networks. Bandcamp / Spotify-for-Artists / SoundCloud-Pro level — but the artist's own site, not a platform. Album art is hero. Tracklist + streaming platform badges + tour dates + press quotes.

SHARED AESTHETIC (all 5 variants):
- Display: variant-specific — usually large + opinionated (often italic, sometimes mono).
- Body: Inter 400-500.
- Mono: Geist Mono — for track numbers, durations, dates, catalog numbers.
- Album cover art: GIANT placeholder gradient at 1:1 aspect (square) at hero — minimum 480px on desktop, full-bleed feel.
- Tracklist: numbered table with mono track number, song title, duration, optional play button.
- Streaming badges: SVG badges for Spotify, Apple Music, Bandcamp, SoundCloud, YouTube Music, Tidal (a row of 6).
- Tour dates: list with mono date + venue + city + "Tickets" CTA.
- Press quotes: from fictional but believable publications (Pitchfork, NME, Stereogum, The Fader, etc.).
- Often dark or bold colored modes (music sites lean visual + emotional).

SHARED SECTION SKELETON:
1. Minimal nav: artist wordmark + 3-4 anchor links (Music, Tour, Merch, About) + accent CTA pill ("Listen now" or "Pre-save").
2. Hero: 2-col on desktop, stacked on mobile. Left: album art HUGE placeholder. Right: album title display, release date mono, artist name, 1-line tagline, streaming-platform badges row.
3. Tracklist: numbered table — track # / title / duration / play button. Includes feature credits ("ft. Marcus Tobin").
4. Press quotes section: 4-6 pull quotes from publications with attribution.
5. Tour dates: list of 8-14 upcoming dates with date / venue / city / Tickets CTA.
6. Music video / lyric video embed: large 16:9 placeholder with play button overlay + video title.
7. Bio / about: 3 paragraphs about the artist with photo placeholder.
8. Merch shop section: 4-card grid of merch items (LP / cassette / tee / hoodie) with photo placeholders + price.
9. Newsletter signup: "Get tour dates + new releases · subscribe".
10. Social + streaming icons row.
11. Footer: minimal — artist wordmark + © year + Booking inquiry email + Label credit (mono).

VISUAL FLOURISHES SPECIFIC TO MUSIC:
- Album art with subtle ambient glow (radial-gradient behind the cover).
- "Now playing" mock UI element with waveform animation.
- Streaming platform badges as full-color SVG (not monochrome).
- Tour date row hover: subtle slide-right animation + accent underline.
- "SOLD OUT" stamp overlay on tour dates that are gone.
- Lyrics excerpt as pull-quote in serif italic.

THE 5 VARIANTS:

VARIANT 01: Solstice — Indie electronic album (4th album).
- Mode: dark gradient. Bg radial from #0A0A14 to #2E0E4F. Accent: hot magenta #E5407B. Text #FFFFFF.
- Display: Inter Display 700.
- Artist: "Hana Ito" — 4th studio album titled "Solstice".
- Release date: "May 8, 2026 · pre-save now". Catalog: "MIRROR-014 · LP / digital".
- Tracklist (10 tracks): "01 · Equinox · 4:12 · ft. Cinder", "02 · Halcyon Dust · 3:48", "03 · Mirror Year · 5:24", ... up to "10 · Solstice Theme · 6:48".
- Press quotes: "Pitchfork — 'her most fearless work yet'", "The Fader — 'electronic music with a heartbeat'", "NME — 'four albums in, Ito is hitting her stride'".
- Tour dates: 14 dates across US + Japan in summer 2026.
- Music video: "Solstice (official video) · directed by Yuki Tanaka · 4:48".
- Bio: 3 paragraphs about Hana's journey from bedroom producer to four-album career.
- Merch: 12" LP ($38) / cassette ($14) / album tee ($28) / hoodie ($68).

VARIANT 02: Cantata — Classical jazz album with a horn section.
- Mode: cream + warm. Bg #FBF6EB. Accent: deep burgundy #722F3A. Text #1A1714.
- Display: Source Serif 4 italic 500.
- Artist: "Cinder Quintet" — debut album titled "Cantata".
- Release date: "April 18, 2026 · streaming + LP". Catalog: "CINDER-001 · LP / digital · Blue Note imprint".
- Tracklist (8 tracks): "01 · Overture in B minor · 8:24", "02 · Walking in Brooklyn · 6:48", "03 · Ode to Halcyon · 12:08" (long-form jazz tracks).
- Press: "JazzTimes — 'serious, sophisticated, alive'", "Pitchfork — '8.4 · among the year's best jazz debuts'", "The New Yorker — 'a quintet that listens'".
- Tour dates: 8 dates at jazz venues (Village Vanguard NYC, Smalls, Birdland, Blue Note Tokyo, Ronnie Scott's London, etc.).
- Music video: "Walking in Brooklyn (live at the Vanguard) · 14:08".
- Bio: 3 paragraphs about the quintet — formed at Juilliard, recorded live to 2-inch tape, no overdubs.
- Merch: 180-gram LP ($48) / signed test pressing ($148) / sheet music PDF ($28) / quintet hoodie ($88).

VARIANT 03: Static — Punk hardcore EP (single 7" release).
- Mode: brutalist high-contrast. Bg #FFFFFF. Accent: pure red #FF0000. Text #000000.
- Display: Inter 900 ALL CAPS, tight tracking -0.05em.
- Artist: "Reverb Front" — 5-song EP titled "STATIC".
- Release date: "MARCH 28, 2026 · 7" / DIGITAL". Catalog: "STATIC-005 · LIMITED 500 COPIES".
- Tracklist (5 tracks, all under 2 min): "01 · STATIC · 1:48", "02 · NO COMPROMISE · 1:24", "03 · MIRROR THE SOUND · 2:08", "04 · TRADE BOOK · 1:14", "05 · STATIC (REPRISE) · 0:48".
- Press: "Maximum Rocknroll — 'pure intent · zero filler'", "Brooklyn Vegan — 'the EP we needed'", "Pitchfork — '7.8 · loud, fast, smart'".
- Tour dates: 28 dates DIY hardcore tour US + Europe (small venues).
- Music video: "STATIC (live at Saint Vitus) · raw cell phone footage · 1:48".
- Bio: 2 paragraphs — formed in 2024, this is their 3rd EP, no full-length plans.
- Merch: 7" vinyl ($14, limit 500) / EP tee ($24) / patch ($8) / poster ($14).

VARIANT 04: Bloom — Indie folk album from a singer-songwriter.
- Mode: warm pastels. Bg gradient #FFFAF0 → #FFF0F5. Accent: dusty rose #C9788E. Text #2A1810.
- Display: Newsreader 500 italic (serif).
- Artist: "Sofia Reyes" — 2nd full-length album titled "Bloom".
- Release date: "May 18, 2026 · LP / streaming". Catalog: "BLOOM-002 · CD / LP / digital · Folkways imprint".
- Tracklist (12 tracks): "01 · Bloom · 4:08", "02 · Mama's Garden · 3:48", "03 · Berkshire in May · 5:24" (folk + acoustic guitar + occasional strings).
- Press: "Pitchfork — '7.6 · gentle, weighty'", "Folk Radio — 'a songwriter at peak craft'", "NPR — 'best folk debut of 2024 was Sofia's first album · this one is even better'".
- Tour dates: 14 dates at folk venues + house concerts.
- Music video: "Mama's Garden (live at Newport Folk) · 4:48".
- Bio: 3 paragraphs about Sofia's path from Berkshire Mountains farm girl to Brooklyn-based songwriter, recorded album in a Catskills barn.
- Merch: LP ($32) / CD ($14) / tour poster ($24) / handwritten lyrics print ($48 limited).

VARIANT 05: Cascade — Ambient electronic album (long-form pieces).
- Mode: dark teal. Bg radial from #08141A to #0E2A2F. Accent: cyan-teal #4FE5D4. Text #E8F4F2.
- Display: Inter Display 500 thin (lighter weight, ambient feel).
- Artist: "Maya Levenson" — 3rd album titled "Cascade".
- Release date: "April 4, 2026 · LP / digital / cassette". Catalog: "CASCADE-003 · LP / digital · Kranky imprint".
- Tracklist (6 long-form pieces): "01 · Cascade (slow movement) · 14:08", "02 · Halcyon Field · 22:48", "03 · Mirror in C · 18:24" (durations ranging 14-24 min, total album 1h 48m).
- Press: "Pitchfork — '8.2 · drone music that breathes'", "The Quietus — 'Levenson's most patient work'", "Boomkat — 'essential ambient listening for 2026'".
- Tour dates: 8 dates at galleries + art spaces (long-form performances 60-90 min).
- Music video: "Cascade (visual album excerpt) · projected at MoMA PS1 · 14:08".
- Bio: 3 paragraphs about Maya's process — modular synthesis, field recordings from Iceland, recorded over 14 months.
- Merch: 2xLP gatefold ($48) / cassette ($14) / signed art print ($88) / album zine ($28).

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 22 — Gaming / Game Studio (5 pages, mostly dark modes)

```
Brief: Produce 5 landing pages for VIDEO GAMES and GAME STUDIOS — indie game launch pages and studio home pages. Annapurna Interactive / Devolver Digital / Supergiant (Hades) / a great Steam page level. The key art and trailer ARE the hero — everything orbits the game's world.

SHARED AESTHETIC (all 5 variants):
- Display: variant-specific — gaming leans loud (Inter Display 800-900) or characterful (a serif for narrative games).
- Body: Inter 400-500.
- Mono: Geist Mono 400 — version numbers, build dates, system requirements, catalog/edition labels.
- Key art: GIANT gradient placeholder, cinematic, ambient bloom. Hero key art at 16:9 (full-bleed feel) or as a full-viewport background.
- Platform badges: full-color SVG badges for Steam, Epic Games, PlayStation, Xbox, Nintendo Switch, App Store — a row in the hero CTA area.
- Screenshot strip: 4-6 tiles at 16:9 in a horizontal scroll.
- Trailer embed: large 16:9 placeholder with a play-button overlay + title + runtime.
- More chroma + bloom than B2B; dark modes dominate.
- Wishlist / pre-order CTA prominent and repeated.

SHARED SECTION SKELETON (all 5 follow this):
1. Nav: game or studio logo + 4 links (Game, Media, News, Studio) + accent CTA pill ("Wishlist on Steam" / "Pre-order").
2. Hero: 70-100vh. Key art background or 2-col. Logo lockup + 1-line tagline + release-date pill ("Q3 2026 · Steam, PS5, Switch") + platform-badge row + primary CTA (Wishlist / Pre-order).
3. Trailer: big 16:9 embed placeholder + play button + "Announce Trailer · 2:14".
4. About the game: 2-3 paragraphs of premise/world + 3-4 "pillars" cards (e.g. Combat / Exploration / Story), each with an icon.
5. Screenshot gallery: 6 tiles, varied crops.
6. Features grid: 4-6 cards (mechanics, modes, co-op, accessibility).
7. Community CTA band: Discord member count + wishlist count + "follow on Steam" + pulse-dot.
8. Press quotes + awards: 4-6 quotes from fictional outlets (IGN, Eurogamer, Polygon, PC Gamer, Rock Paper Shotgun, The Guardian) + festival laurels ("Official Selection · IndieCade 2025").
9. The studio: 2-paragraph studio story + a small team grid + prior titles.
10. System requirements OR editions: a Minimum/Recommended spec table (mono) OR edition tiers (Standard / Deluxe / Collector's) with included-content checklists.
11. Newsletter / final wishlist CTA.
12. Footer: studio name + platform links + press-kit link + © + ESRB/PEGI rating placeholder.

VISUAL FLOURISHES SPECIFIC TO GAMING:
- Festival laurels: SVG laurel wreaths flanking an award name.
- "Wishlisted" counter with a live-feel tabular number.
- Cinematic key art with layered gradients for a parallax feel.
- ESRB / PEGI rating badge SVG.
- System-requirements table: mono, 2-col (Minimum / Recommended).
- Edition comparison: tiered cards with included-content checklists.

THE 5 VARIANTS — one text/html artifact per variant:

VARIANT 01: Meadowlark — A cozy farming + life-sim game.
- Mode: warm light → soft gold gradient. Bg radial #FBF6E8 → #F4E4C4. Accent: warm honey #E0A43C. Text #3A2E1A.
- Display font: Fraunces 600 (storybook warmth).
- Game pitch: "Build a farm, mend a town, find your people." Half-tone tagline: "A small life, <em>made by hand</em>."
- Audience: cozy-game players (Stardew Valley, Animal Crossing fans), all ages, Switch + PC.
- Release: "Q3 2026 · Steam, Nintendo Switch, iOS".
- Pillars: Farm & forage through four seasons, Befriend 28 townsfolk, Restore the valley, A festival every month.
- Wishlist count: "84,408 wishlisted on Steam".
- Press: "Eurogamer — 'the warmest game of the year'", "Rock Paper Shotgun — 'I lost a weekend and don't regret it'", "Polygon — 'Stardew with a softer heart'".
- Studio: "Foxglove Games — 4 people in Portland; their second title, after the puzzle game Cairn (2021)".
- Editions: Standard ($24.99), Deluxe (+soundtrack + digital art book, $34.99).
- FAQ: "Is there any combat, or is it purely cozy?", "How long is a full playthrough?", "Is there cross-save between Switch and PC?", "Single-player only, or co-op?", "Will there be post-launch content?".

VARIANT 02: Sunder — A fast, brutal action-roguelike.
- Mode: dark + ember. Bg #0B0708. Accent: molten orange #FF5A1F. Text #F4ECE6.
- Display font: Inter Display 900, tight tracking.
- Game pitch: "Die, learn, descend. The dungeon <em>remembers</em>."
- Audience: hardcore roguelike players (Hades, Dead Cells, Returnal fans), PC + PS5 + Xbox.
- Release: "Out now · Steam, PS5, Xbox Series X|S".
- Pillars: 240+ weapon combinations, A dungeon that adapts to how you play, 38 boss encounters, Permadeath with permanent progression.
- Sales counter: "148,408 copies sold in launch week".
- Press: "IGN — '9/10 · the year's most satisfying combat'", "PC Gamer — '92 · it gets its hooks in fast'", "Eurogamer — 'Recommended'".
- Studio: "Ironside Interactive — 9 people in Montréal; their debut commercial title after years of game-jam prototypes".
- System requirements: a Minimum / Recommended spec table in mono.
- FAQ: "How many runs does it take to 'finish' the game?", "Is there an easier difficulty?", "Is it Steam Deck verified?", "Is there couch co-op?", "What's the roadmap for post-launch content?".

VARIANT 03: Foxglove — An indie game studio's home page.
- Mode: dark editorial. Bg #101014. Accent: bright violet #A78BFA. Text #F2F0F6.
- Display font: Inter Display 700.
- This is a STUDIO page, not a single game: "A four-person studio making small games with <em>strange hearts</em>."
- Audience: players following the studio, press, and potential publishers/collaborators.
- Hero: studio wordmark + positioning line + "3 games shipped since 2021".
- Replace "About the game" with "Our games" — 3 game cards (Cairn · 2021, Meadowlark · 2026, an unannounced project) + "How we work": 3 paragraphs of studio philosophy (small scope, no crunch, ship when ready).
- Press: studio-level coverage — "GDC Spotlight — 'a studio to watch'" + festival laurels across their catalog.
- Team grid: 4 cards (designer, two artists, audio + tools).
- Final CTA: "Follow the studio" newsletter + Discord invite.
- FAQ: "Are you hiring?", "Do you take publishing pitches?", "Where can press get assets?", "What engine do you build in?", "Will you port your older games to new platforms?".

VARIANT 04: Overclock — A competitive online team shooter.
- Mode: dark + neon cyan. Bg #06080C. Accent: electric cyan #22D3EE. Text #FFFFFF.
- Display font: Inter Display 800, italic.
- Game pitch: "5v5 tactical shooting at <em>240 frames a second</em>."
- Audience: competitive FPS players (Valorant, CS2 fans), PC-first, esports-curious.
- Release: "Free to play · Out now · PC".
- Pillars: 18 agents with distinct kits, Sub-8ms tick servers, Ranked across 9 tiers, A map pool that rotates every season.
- Live stats: "1.2M peak concurrent players · 4,408 ranked matches started every minute".
- Press: "IGN — 'the most precise shooter since CS'", "Polygon — 'esports-ready out of the box'".
- Esports band: "Overclock Masters 2026 · $1,400,000 prize pool · 14 regions".
- Studio: "Ironside Interactive's live-service division — a team of 84".
- Editions: Free to play + a seasonal Battle Pass ($9.99/season) — show what's cosmetic vs. gameplay (nothing pay-to-win).
- FAQ: "Is it really free — what exactly is monetized?", "Is the anti-cheat kernel-level?", "What are the minimum specs to hit 240fps?", "Is a console version planned?", "How does rank decay work?".

VARIANT 05: Cairn — A narrative puzzle-adventure.
- Mode: cold dark slate. Bg #12161A. Accent: pale moss #9CAF88. Text #E6E9E4.
- Display font: Source Serif 4 500 italic (contemplative).
- Game pitch: "A quiet climb up a mountain that <em>doesn't want you there</em>."
- Audience: narrative-puzzle players (Journey, Inside, Outer Wilds fans), all platforms.
- Release: "Q4 2026 · Steam, PS5, Xbox, Switch".
- Pillars: A wordless story told through the landscape, 40 hand-built environmental puzzles, One continuous shot — no loading screens, A score recorded by a live string quartet.
- Wishlist count: "38,408 wishlisted".
- Press: "The Guardian — 'a small masterpiece in the making'" + festival laurels: "Official Selection · IndieCade 2025", "Tribeca Games Spotlight 2026".
- Studio: "Foxglove Games — their debut, the title the studio was built around; re-releasing alongside Meadowlark".
- Editions: Standard ($19.99), Collector's (+vinyl soundtrack + art print, $59.99).
- FAQ: "How long is the game?", "Is it accessible — can puzzles be skipped?", "Is there any dialogue or text?", "Are there content warnings?", "Will the soundtrack release separately?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 23 — Local Services / Home & Trades (5 pages, mostly light + warm modes)

```
Brief: Produce 5 landing pages for LOCAL HOME-SERVICE BUSINESSES — a plumber, a landscaper, a residential cleaning service, an electrician, a home-remodeling contractor. The kind of real, brick-and-mortar local business a self-hoster's customer actually runs. These are NOT SaaS products — they are a working business's marketing page. Think the best version of a local-business site: a clear service area, a phone number that's always one tap away, "get a free quote," before/after photos, star-rated reviews, and trust badges (licensed, bonded, insured, years in business). Friendly and trustworthy — never corporate.

SHARED AESTHETIC (all 5 variants):
- Display: Inter Display 600-700 OR a sturdy, approachable serif — warm, not techy.
- Body: Inter 400-500, line-height 1.55.
- Mono: Geist Mono 400 — rare; only for license numbers and hours.
- Photo placeholders: warm gradient blobs simulating job-site, before/after, team, and truck photography.
- A big, tappable phone number in the nav AND the hero — these businesses convert by phone.
- Trust badges: "Licensed & Insured", "Family-owned since 2009", "★ 4.9 · 600+ reviews", "BBB A+" — small bordered pills.
- The service area named everywhere ("Serving Park Slope, Carroll Gardens & all of Brooklyn").
- Friendly rounded cards (14-18px radius), soft shadows.
- The CTA is "Get a free quote" / "Book a visit" / "Call now" — never "Buy" or "Sign up".

SHARED SECTION SKELETON (all 5 follow this):
1. Thin top bar: phone number + hours + service area + a "Get a quote" pill.
2. Nav: business logo + 4 links (Services, About, Reviews, Contact) + a loud accent "Free quote" CTA + phone.
3. Hero: pill badge ("Family-owned · Licensed & Insured"), display headline (the problem or the benefit), sub 25 words, dual CTA ("Get a free quote" + "Call (555) 408-2210"), a trust-badge row, and a large job/team photo placeholder.
4. Services grid: 4-8 service cards — icon + service name + 1-line + "free estimate" or "from $X".
5. Why choose us: 3-4 reason cards (fast response, upfront pricing, a real warranty, licensed techs).
6. Before / after: 3 pairs of side-by-side photo placeholders with captions.
7. How it works: 3 steps (call or book → we visit & quote → job done right) with mono step labels.
8. Reviews: aggregate "★ 4.9 from 612 reviews" + 4-6 review cards (name + neighborhood + stars + quote + job type) + a Google/Yelp logo mention.
9. Service area: a simple SVG region map + a list of neighborhoods/towns served.
10. Guarantee / pricing approach: a band on transparent pricing, the satisfaction guarantee, and warranty terms.
11. Final CTA: "Need it fixed? Let's talk." + a quote-form mockup (name / phone / what you need — non-functional) + phone.
12. Footer: business name + address + phone + hours + license # (mono) + service area + social.

VISUAL FLOURISHES SPECIFIC TO LOCAL SERVICES:
- The phone number styled as a click-to-call button, repeated through the page.
- Before/after presented as two photo halves split by a divider line.
- Star-rating rows with mono review counts.
- Trust badges as bordered pills.
- An urgency pill ("Same-day service" / "24/7 emergency") with a pulse-dot.
- Service-area map: a simple SVG region outline with covered towns as pins.

THE 5 VARIANTS — one text/html artifact per variant:

VARIANT 01: Plumbline — A residential plumbing company.
- Mode: clean light + blue. Bg #FFFFFF. Accent: deep water blue #1E5F9E. Text #14202B.
- Display font: Inter Display 700.
- Pitch: "Plumbing done right the <em>first time</em>."
- Business: a family-owned plumbing company, 16 years in business, serving Brooklyn.
- Hero: badge "Licensed Master Plumber · Same-day service" + a photo of a technician at a job.
- Services: Leak repair, Drain cleaning, Water-heater install, Repiping, Fixture install, 24/7 emergency burst-pipe, Sump pumps, Sewer-line camera inspection.
- Before/after: rusted pipe → new copper, clogged drain → clear flow, old tank → tankless heater.
- Urgency: a "24/7 emergency line" pill with a pulse-dot.
- Reviews: ★4.9 from 612, examples from Park Slope, Fort Greene, Bay Ridge.
- Stats: Avg emergency arrival time (under 90 min), Jobs completed in 2025 (3,408), Repeat-customer rate (62%), Years in business (16).
- Guarantee: "Upfront flat-rate pricing · 2-year workmanship warranty · no overtime charges, ever".
- FAQ: "Do you charge for the estimate?", "Are you available nights and weekends?", "Is pricing by the hour or flat-rate?", "Do you pull the permit for water-heater work?", "What's the warranty difference between a repair and an install?".

VARIANT 02: Thicket — A landscaping + lawn-care company.
- Mode: warm light + green. Bg #FAF8F1. Accent: deep garden green #3F7A45. Text #1F2A1C.
- Display font: Fraunces 600.
- Pitch: "A yard you'll actually want to <em>sit in</em>."
- Business: a design-build + maintenance landscaping company for town and suburban clients.
- Hero: badge "Design · Build · Maintain · Since 2011" + a photo of a finished garden.
- Services: Lawn-care plans, Garden design, Hardscaping & patios, Tree & shrub care, Seasonal cleanups, Irrigation, Mulch & beds, Winter snow removal.
- A 4-card seasonal plan (spring cleanup, summer maintenance, fall leaf removal, winter snow).
- Before/after: bare yard → planted garden, cracked concrete → bluestone patio, overgrown lot → cleared beds.
- Reviews: ★4.8 from 388.
- Stats: Yards maintained weekly (240), Design projects completed in 2025 (84), Crew members (14), Avg client tenure (4.2 years).
- Pricing: "Maintenance plans from $180/mo · design-build projects quoted free after a site visit".
- FAQ: "Do you do one-time cleanups or only ongoing plans?", "Who designs the planting — a real designer?", "Are you licensed and insured for tree work?", "Do you offer organic lawn treatments?", "What's the lead time for a patio build?".

VARIANT 03: Brightwork — A residential cleaning service.
- Mode: bright light + fresh. Bg #FCFCFA. Accent: clean teal #2BA39A. Text #16201F.
- Display font: Inter Display 700.
- Pitch: "Come home to a place that <em>feels lighter</em>."
- Business: recurring and deep-clean home cleaning with vetted, employed cleaners.
- Hero: badge "Vetted · Insured · Eco-friendly products" + a photo of a bright, clean room.
- Services: Recurring cleaning (weekly / bi-weekly / monthly), Deep clean, Move-in / move-out, Post-renovation, Apartment & condo, Inside-fridge and inside-oven add-ons.
- Why us: the same cleaner each visit, background-checked, flat per-home pricing, free reschedules.
- Before/after: cluttered kitchen → spotless counters, dusty shelves → clean surfaces.
- Reviews: ★4.9 from 1,408.
- Stats: Homes cleaned monthly (2,408), Cleaners on the team (38, all W-2 employees — not contractors), Same-cleaner retention (84%), Avg first-clean rating (4.9/5).
- Pricing: "Recurring from $119/visit · one-time deep clean from $249 · a transparent per-home quote in 60 seconds".
- FAQ: "Will I get the same cleaner every time?", "Are your cleaners employees or contractors?", "What products do you use — are they safe for pets and kids?", "Do I need to be home during the clean?", "What isn't included in a standard clean?".

VARIANT 04: Voltline — A residential + light-commercial electrician.
- Mode: dark + amber (leaning into the trade). Bg #14130F. Accent: live-wire amber #F2A60C. Text #F4F0E6.
- Display font: Inter Display 700.
- Pitch: "Wiring you never have to <em>think about again</em>."
- Business: a licensed electrical contractor — panels, EV chargers, lighting, troubleshooting.
- Hero: badge "Licensed Electrical Contractor · #EC-44821" + a photo of a clean panel install.
- Services: Panel upgrades, EV-charger install, Lighting & fixtures, Outlet & wiring, Troubleshooting, Whole-home surge protection, Generator hookup, Code corrections for a home sale.
- Why us: licensed and bonded, a photo of every finished job, code-compliant work, upfront quotes.
- Before/after: old fuse box → modern panel, tangled wiring → a clean run.
- Urgency: "Same-week scheduling · emergency callout available".
- Reviews: ★4.9 from 504.
- Stats: Panels upgraded in 2025 (408), EV chargers installed (612), First-time inspection pass rate (100%), Years licensed (14).
- Pricing: "Free quote on installs · $89 diagnostic visit, credited to the repair if you hire us".
- FAQ: "Do you pull the permit and handle the inspection?", "What level of EV charger can you install?", "Is the diagnostic fee credited toward the work?", "Can you bring an old house up to code?", "Do you do panel upgrades for a solar install?".

VARIANT 05: Keystone — A home-remodeling + general contractor.
- Mode: warm cream + slate. Bg #F6F2EA. Accent: deep slate blue #3A4A63. Text #1E2229.
- Display font: Fraunces 600, italic for emphasis.
- Pitch: "Renovations that finish <em>when we said they would</em>."
- Business: a design-build general contractor — kitchens, baths, additions, whole-home remodels.
- Hero: badge "Design-build · Licensed GC · Since 2008" + a photo of a finished kitchen.
- Services: Kitchen remodels, Bathroom remodels, Additions, Basement finishing, Whole-home renovation, Decks & exteriors.
- Process: 5 steps — Consultation → Design & fixed bid → Permits → Build (weekly updates) → Walkthrough & 1-year warranty.
- Before/after: dated kitchen → modern, unfinished basement → living space, cramped bath → spa-like.
- Reviews: ★4.9 from 214 (fewer reviews, bigger jobs).
- Stats: Projects completed since 2008 (480+), On-time completion rate (94%), Avg kitchen-remodel timeline (5-7 weeks), Repeat + referral business (71%).
- Pricing: "Free consultation · a fixed-bid proposal after design · kitchens typically $45k-$90k, baths $22k-$40k".
- FAQ: "Is it a fixed bid or time-and-materials?", "Who handles permits and inspections?", "Can we live in the house during the remodel?", "What happens if you find something behind the wall?", "What does the 1-year warranty actually cover?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 24 — Nonprofit / Cause / Fundraising (5 pages, mixed modes)

```
Brief: Produce 5 landing pages for NONPROFITS and CAUSE ORGANIZATIONS — conservation, literacy/education access, food security, animal rescue, civil-liberties advocacy. charity: water / Khan Academy / Feeding America / Best Friends / a serious legal-advocacy org level. The CTA is "Donate," not "Buy." Heavy on impact metrics, transparency (where the money actually goes), real-feeling beneficiary stories, and donor trust signals. The tone is hopeful and specific — never guilt-heavy, never cliché.

SHARED AESTHETIC (all 5 variants):
- Display: variant-specific — often a warm serif (Source Serif 4, Fraunces) for human weight, or a confident sans for advocacy.
- Body: Inter 400-500, line-height 1.6 (warm, readable).
- Mono: Geist Mono 400 — for impact figures, financial breakdowns, dates, EIN numbers.
- Photo placeholders: warm, human-centered gradient blobs (people, places, fieldwork) — not clinical.
- Impact metrics big, with tabular-nums.
- The "Donate" CTA is the loudest element — sticky, accent, repeated. Preset amounts ($25 / $50 / $100 / custom).
- Trust band: Charity Navigator 4-star, GuideStar/Candid Platinum, "87¢ of every dollar goes to programs", EIN number (mono).
- Donation widget: amount chips + a one-time / monthly toggle + "Donate" — looks real, non-functional.

SHARED SECTION SKELETON (all 5 follow this):
1. Nav: org logo + 4 links (Our Work, Impact, Stories, About) + a loud "Donate" pill (no sign-in UI).
2. Hero: pill badge (the mission line), display headline (with the half-tone trick), sub 25-30 words, dual CTA ("Donate" + "See our impact"), one concrete proof-point ("$2.4M raised · 148 projects funded"), large photo placeholder.
3. The problem / why it matters: a 2-paragraph framing + 3 stat cards quantifying the problem.
4. What we do: 3-4 program cards — icon + program name + 1-line + a metric.
5. Impact section: a BIG 4-metric banner + a "where your money goes" breakdown (donut or stacked bar — programs vs. fundraising vs. admin, mono percentages).
6. Beneficiary story spotlight: one named, real-feeling story with a photo placeholder + 2-3 paragraphs + the outcome.
7. Donation widget centerpiece: amount chips that each NAME a concrete outcome + a one-time vs. monthly toggle + the Donate CTA + a progress-to-goal bar.
8. Ways to give: monthly giving, employer match, legacy/planned giving, in-kind, volunteer.
9. Transparency / financials: Charity Navigator + GuideStar badges + a link to the annual report + a clear program-spend ratio + EIN.
10. Supporters / partners: foundation + corporate-partner logos + "joined by 28,408 donors".
11. FAQ: 5 donor questions (tax-deductibility, where the money goes, monthly vs. one-time, restricting a gift, how impact is measured).
12. Final CTA: "Be the reason this changes" + donate.
13. Footer: org name + EIN + address + Charity Navigator + Privacy + contact + newsletter.

VISUAL FLOURISHES SPECIFIC TO NONPROFIT:
- Donation amount chips that each name a concrete outcome.
- A "where your money goes" donut/stacked-bar with mono percentages.
- A progress-to-goal bar ("$1.84M of $2.4M goal · 28,408 donors").
- Charity Navigator / GuideStar badge SVGs.
- A one-time / monthly toggle on the donation widget.
- Impact metrics with tabular-nums and a small contextual sub-line.

THE 5 VARIANTS — one text/html artifact per variant:

VARIANT 01: Headwaters — A river + watershed conservation org.
- Mode: light + river blue-green. Bg #F7FAF9. Accent: deep river teal #1F6F6A. Text #102524.
- Display font: Source Serif 4 500.
- Pitch: "Clean water starts <em>upstream</em>."
- Mission: protect and restore river headwaters across the American West.
- Hero: badge "Protecting 1.2M acres of watershed" + a photo of a river.
- The problem: 3 stats — miles of degraded streams, communities downstream affected, % of headwater land still unprotected.
- Programs: Land protection, Stream restoration, Water-quality monitoring, Community partnerships.
- Impact: River miles restored (1,408), Acres permanently protected (1.2M), Volunteer monitoring days (28,408), Where money goes (84% programs · 9% fundraising · 7% admin).
- Story: "The Pine Creek restoration — how 14 miles of a dead trout stream came back" — a named landowner + the outcome.
- Donation chips: "$25 — a day of water testing", "$50 — 100 native streamside plants", "$100 — an acre toward permanent protection".
- Transparency: Charity Navigator 4-star, GuideStar Platinum, EIN 84-4408821.
- FAQ: "Is my donation tax-deductible?", "How much goes to programs vs. overhead?", "Can I restrict my gift to a specific river?", "How do you measure restoration success?", "Do you accept land donations?".

VARIANT 02: Lantern — A childhood literacy nonprofit.
- Mode: warm cream + gold. Bg #FBF6EA. Accent: warm lantern gold #D9933A. Text #2A2114.
- Display font: Fraunces 600, italic for emphasis.
- Pitch: "Every kid deserves a book they <em>can't put down</em>."
- Mission: get books and reading support to kids in under-resourced schools.
- Hero: badge "1.4M books delivered since 2016" + a photo of kids reading.
- The problem: 3 stats — kids without a single book at home, the summer reading-loss gap, classrooms with no library.
- Programs: Classroom libraries, Take-home book bundles, Volunteer reading tutors, Family literacy nights.
- Impact: Books delivered (1.4M), Classroom libraries built (4,408), Kids reading at grade level after a year (+38pp), Money to programs (88%).
- Story: a named teacher + a named 8-year-old who went from struggling to reading above grade level.
- Donation chips: "$25 — 10 books for one child", "$50 — a take-home bundle for a family", "$100 — half a classroom library".
- Transparency: Charity Navigator 4-star, GuideStar Platinum.
- FAQ: "How do you choose which schools?", "Are the books new or used?", "Can I donate books instead of money?", "Is there a monthly giving option?", "How do you measure reading improvement?".

VARIANT 03: Commontable — A food-security + community-meals org.
- Mode: warm light + tomato. Bg #FCF7F1. Accent: warm tomato-red #C44A33. Text #241A14.
- Display font: Inter Display 700 + serif accents.
- Pitch: "No one in this town should go to bed <em>hungry</em>."
- Mission: rescue surplus food and run community meals and pantries.
- Hero: badge "2.8M meals served in 2025" + a photo of a community meal.
- The problem: 3 stats — neighbors who are food-insecure, lbs of edible food wasted locally, kids on free lunch with no summer option.
- Programs: Food rescue, Community pantries, Hot-meal sites, Summer kids' meals, A mobile market.
- Impact: Meals served (2.8M), Pounds of food rescued (1.4M lbs), Pantry visits (148,408), Money to programs (91%).
- Story: a named family + a named volunteer driver; the mobile market reaching a food desert.
- Donation chips: "$25 — 75 rescued meals", "$50 — a week of groceries for a family", "$100 — a month of a kid's summer meals".
- Transparency: Charity Navigator 4-star, Feeding America partner.
- FAQ: "How can one dollar provide so many meals?", "Where does the food come from — is it safe?", "Can I volunteer instead of donating?", "Do you serve my neighborhood?", "Is my gift tax-deductible?".

VARIANT 04: Refuge — An animal rescue + sanctuary.
- Mode: warm light + sage. Bg #F7F6F0. Accent: soft sage green #6E9166. Text #1E2419.
- Display font: Fraunces 600.
- Pitch: "A second chance, <em>for the ones who ran out of them</em>."
- Mission: rescue, rehabilitate, and rehome animals; lifelong sanctuary for the unadoptable.
- Hero: badge "12,408 animals rehomed since 2009" + a photo of animals at the sanctuary.
- The problem: 3 stats — animals surrendered to overcrowded shelters yearly, the euthanasia rate for treatable cases, sanctuary spots vs. need.
- Programs: Rescue & intake, Medical rehabilitation, Foster network, Adoptions, Lifelong sanctuary.
- Impact: Animals rehomed (12,408), Foster homes in the network (408), Medical cases treated in 2025 (1,408), Money to animal care (86%).
- Story: a named dog — intake condition → rehabilitation → adopted; plus a sanctuary resident who will stay forever.
- Donation chips: "$25 — a week of food for a rescue", "$50 — vaccines + microchip for one animal", "$100 — toward a surgery fund". Monthly "Sanctuary Circle" emphasized.
- Transparency: Charity Navigator 4-star, GuideStar Platinum.
- FAQ: "Are you a no-kill organization?", "Can I sponsor a specific animal?", "How do I become a foster?", "Where does my monthly gift go?", "Can I visit the sanctuary?".

VARIANT 05: Bulwark — A civil-liberties + legal-advocacy organization.
- Mode: dark + confident. Bg #0E1116. Accent: strong red #E23B3B. Text #F2F3F5.
- Display font: Inter Display 800 (advocacy — bold, urgent).
- Pitch: "Rights aren't self-enforcing. <em>Someone has to stand on them</em>."
- Mission: impact litigation, policy advocacy, and rapid-response defense of civil liberties.
- Hero: badge "148 cases litigated · 47 state legislatures tracked" + a photo of advocates or a courthouse.
- The problem: 3 stats — rights-restricting bills introduced this session, people affected, communities without local legal defense.
- Programs: Impact litigation, Legislative advocacy, Rapid-response legal defense, Know-your-rights education.
- Impact: Cases won or favorably settled (108 of 148), People directly protected (2.4M), Bills defeated or amended (84), Money to legal & advocacy work (82%).
- Story: a named plaintiff whose case set a precedent; a rapid-response win.
- Donation chips: "$25 — an hour of legal research", "$50 — know-your-rights materials for a community", "$100 — toward filing the next case". Monthly "Defenders" program emphasized (predictable funding lets them take multi-year cases).
- Transparency: Charity Navigator 4-star, financials linked, EIN.
- FAQ: "Is my donation tax-deductible — are you a 501(c)(3) or (c)(4)?", "How do you pick which cases to take?", "What share goes to litigation vs. overhead?", "Why does monthly giving matter for legal work?", "Can I give anonymously?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 25 — Wellness / Fitness Studio (5 pages, mostly light + warm modes)

```
Brief: Produce 5 landing pages for physical WELLNESS and FITNESS BUSINESSES — a yoga studio, a strength gym, a pilates/barre studio, a climbing gym, a day spa. These are real brick-and-mortar studios, NOT fitness apps (an app would be the Cadence/Stride territory). CorePower / Barry's / a beautiful local yoga studio / a craft climbing gym level. Heavy on the class schedule, membership tiers, instructor bios, the space itself, and a first-class intro offer.

SHARED AESTHETIC (all 5 variants):
- Display: variant-specific — a calm serif for the yoga/spa variants, a bold sans for strength/climbing.
- Body: Inter 400-500, line-height 1.6.
- Mono: Geist Mono 400 — class times, the schedule grid, membership prices, instructor certifications.
- Photo placeholders: warm gradient blobs simulating the space, classes in motion, and instructors.
- The class schedule rendered as a weekly grid (days across, time slots down), color-coded by class type.
- Membership tiers as cards; the new-client intro offer is prominent ("First class free" / "2 weeks for $39").
- The booking CTA everywhere ("Book a class" / "Start your trial" / "Reserve a spot").
- Generous whitespace — calm for yoga/spa, energetic for strength/climbing.

SHARED SECTION SKELETON (all 5 follow this):
1. Nav: studio logo + 4 links (Classes, Schedule, Membership, About) + accent CTA pill ("Book a class").
2. Hero: pill badge (studio type + neighborhood), display headline, sub 25 words, dual CTA (book + the intro offer), a proof line ("2,408 members · open 7 days"), a large photo placeholder of the space.
3. Intro-offer band: the new-client deal, big and clear.
4. Classes / services grid: 4-8 cards — class or treatment name + intensity or duration + 1-line.
5. Weekly schedule: a real-looking grid — days across, time slots down, class blocks color-coded by type, mono times, with a class-type legend.
6. The space: 3-6 photo placeholders of the studio (the room, lockers, lounge, equipment).
7. Instructors / practitioners: 4-8 cards — photo placeholder + name + specialty + a 1-line bio + certifications in mono.
8. Membership / pricing: 2-3 tiers (drop-in / class pack / unlimited monthly) with a "Most popular" anchor pill on the middle tier.
9. Member stories / testimonials: 3-4 cards — photo + name + how long a member + quote.
10. Location + hours + getting started: address, an hours table (mono), parking/transit, "what to bring for your first class."
11. Final CTA: "Your first class is on us" + book.
12. Footer: studio name + address + hours + phone + Instagram + a class-booking-app mention.

VISUAL FLOURISHES SPECIFIC TO WELLNESS STUDIOS:
- The weekly schedule grid with color-coded class blocks + mono times.
- Class-type legend pills.
- A "spots left" indicator on a class ("4 spots left") with a pulse-dot.
- An intro-offer banner with a deadline feel.
- Instructor cards with certification badges (mono — "RYT-500", "CrossFit L3", "NASM-CPT").
- Membership tier cards with a "Most popular" anchor pill on the middle tier.

THE 5 VARIANTS — one text/html artifact per variant:

VARIANT 01: Stillwater — A neighborhood yoga studio.
- Mode: warm cream. Bg #FAF5EC. Accent: deep clay #B5673E. Text #2A2118.
- Display font: Fraunces 500 italic.
- Pitch: "An hour that's <em>actually yours</em>."
- Studio: vinyasa + restorative + yin yoga, all levels, in a converted loft.
- Intro offer: "Two weeks of unlimited classes — $39".
- Classes: Vinyasa flow, Slow flow, Restorative, Yin, Prenatal, a 4-week Beginner's series, Candlelit evening.
- Schedule: a 7-day grid, ~5 classes/day.
- Instructors: 8 teachers — RYT-200 / RYT-500 certifications.
- Membership: Drop-in ($26), 10-class pack ($210), Unlimited monthly ($169 — Most popular).
- Member stories: 3 testimonials.
- Stats: Members (1,408), Classes per week (47), Years open (9), Avg class size (18).
- FAQ: "I've never done yoga — which class do I start with?", "Do you provide mats?", "Can I freeze my membership?", "Is the room heated?", "Do you offer prenatal classes?".

VARIANT 02: Ironside — A strength + conditioning gym.
- Mode: dark + steel. Bg #121316. Accent: blaze orange #FF6A2B. Text #F2F1EE.
- Display font: Inter Display 800.
- Pitch: "Get strong. <em>On purpose</em>."
- Gym: barbell-focused strength training, small-group coaching, and open gym.
- Intro offer: "Free intro session + movement assessment".
- Classes: Foundations (beginner barbell), Strength small-group, Conditioning, Open gym, Olympic lifting, Powerlifting prep.
- Schedule: a 7-day grid, early-morning through evening blocks.
- Coaches: 6 — CrossFit L2/L3, NASM-CPT, USAW certifications.
- Membership: 2x/week ($129/mo), Unlimited classes ($189/mo — Most popular), Open gym only ($79/mo).
- Member stories: 3 — a first deadlift, a return from injury, a 50-year-old getting strong.
- Stats: Members (612), Coached sessions per week (84), Avg member 3-month strength gain (+38% on main lifts), Coaches (6).
- FAQ: "I've never touched a barbell — is this for me?", "What are class sizes — how much individual coaching?", "Is there a contract, or is it month-to-month?", "Do you have showers and parking?", "Can I do open gym on a class membership?".

VARIANT 03: Poise — A pilates + barre boutique studio.
- Mode: soft light + blush. Bg #FDF8F6. Accent: dusty rose #C77B86. Text #2A2024.
- Display font: Fraunces 600.
- Pitch: "Small movements. <em>Real change</em>."
- Studio: reformer pilates + barre, boutique, small classes.
- Intro offer: "Your first reformer class — free".
- Classes: Reformer pilates, Barre, Mat pilates, Reformer + barre fusion, Prenatal / postnatal, Privates.
- Schedule: a 7-day grid; capped class sizes shown (e.g. "8 reformers").
- Instructors: 6 — comprehensively-certified pilates instructors + barre certifications.
- Membership: Drop-in ($38), 8-class pack ($280), Unlimited monthly ($239 — Most popular).
- Member stories: 3 testimonials.
- Stats: Members (408), Reformers in the studio (8), Classes per week (52), Avg class size (8).
- FAQ: "Pilates vs. barre — what's the difference?", "Do I need experience for the reformer?", "How early should I arrive for my first class?", "Do you offer postnatal classes?", "What should I wear — do I need grippy socks?".

VARIANT 04: Crux — A bouldering + climbing gym.
- Mode: dark + chalk. Bg #15171A. Accent: bright climbing-tape yellow #E4C320. Text #F3F3F0.
- Display font: Inter Display 800.
- Pitch: "Find the move you <em>didn't think you had</em>."
- Gym: a bouldering-focused climbing gym + a fitness/training area + community.
- Intro offer: "Day pass + gear rental — $20, first visit".
- Offerings: Bouldering walls (regraded weekly), Intro-to-climbing class, Youth team, Yoga + training area, Community comp nights.
- Schedule: less classes-heavy — show Intro-class times in a grid + "set days" (when new routes go up) + the comp calendar.
- Staff/coaches: 5 — route-setters + coaches, with certifications.
- Membership: Day pass ($24), Punch card (10 visits $190), Monthly unlimited ($95 — Most popular), Student ($75).
- Member stories: 3 — a first V4, a parent climbing with a kid, a beginner-to-comp story.
- Stats: Members (2,408), Boulder problems set (240, refreshed weekly), Wall area (14,408 sq ft), Route-setters (5).
- FAQ: "I've never climbed — do I need a class first?", "What gear do I need to rent or buy?", "Is there a fitness area beyond climbing?", "How often do routes change?", "Is there a kids' program?".

VARIANT 05: Solace — A day spa + thermal-bathing studio.
- Mode: calm light + eucalyptus. Bg #F4F6F2. Accent: deep eucalyptus green #4C6B5A. Text #1F2722.
- Display font: Source Serif 4 500 italic.
- Pitch: "Step out of the day. <em>Even for an hour</em>."
- Spa: massage + facials + a thermal-bathing circuit (sauna · steam · cold plunge).
- Intro offer: "First-visit thermal circuit + 60-min massage — $129".
- Services: Massage (deep tissue / Swedish / prenatal), Facials, the Thermal bathing circuit, Body treatments, Couples' rooms, Memberships.
- Schedule: instead of a class grid — booking availability for the next 7 days (slots per service) + thermal-circuit session times.
- Practitioners: 6 — licensed massage therapists + estheticians, with license numbers in mono.
- Membership: Single visit (treatments à la carte), Monthly membership ($149/mo — one treatment + unlimited thermal circuit — Most popular), Thermal-only ($69/mo).
- Member stories: 3 testimonials.
- Stats: Treatments given in 2025 (28,408), Licensed therapists (12), Thermal-circuit capacity per session (24), Member retention (78%).
- FAQ: "What is the thermal circuit, and how long does it take?", "Do I need to book, or can I walk in?", "What's included in the monthly membership?", "Can I book a couples' room?", "Are gratuities included?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 26 — Web3 / Crypto Protocol (5 pages, mostly dark modes)

```
Brief: Produce 5 landing pages for ONCHAIN / WEB3 PROTOCOLS — an Ethereum L2, a DeFi lending protocol, an onchain art marketplace, DAO governance tooling, a self-custody wallet. These are crypto-native, onchain products — NOT regulated fintech (that's the Reservoir/Conduit territory). base.org / Uniswap / Optimism / Safe / Rainbow level. Heavy on contract addresses, onchain metrics (TVL/volume), a "connect wallet" UI, gas/latency figures, audit badges, and SDK code. IMPORTANT: keep copy informational — describe the mechanism and the utility. NO "buy the token, price goes up" hype, no investment-return promises. This is a product page, not a token sale.

SHARED AESTHETIC (all 5 variants):
- Display: Inter Display 700, -0.04em — crisp and modern (a mono-display is fine for the dev-heavy variants).
- Body: Inter 400-500.
- Mono: Geist Mono — HEAVY: contract addresses, tx hashes, gas, token amounts, block numbers.
- Tabular-nums on every onchain figure (TVL, APY, volume, addresses).
- Dark modes dominate; a vivid single accent + the occasional gradient mesh.
- Audit badges: small mono pills — "Audited by OpenZeppelin", "Audited by Trail of Bits", "Immunefi bounty: $2M".
- The "Connect wallet" / "Launch app" button is the primary CTA, with wallet glyphs (MetaMask / Rainbow / Coinbase Wallet) as SVG.
- Network pills: "Mainnet · live" with a pulse-dot, "Sepolia testnet".
- An onchain-transparency note — "every contract verified on-chain" with a mono address.

SHARED SECTION SKELETON (all 5 follow this):
1. Nav: protocol logo + 4 links (Docs, Ecosystem, Governance, Blog) + a GitHub link + accent "Launch app" pill.
2. Hero: pill badge (version + network — "Mainnet · v3 live"), display headline (half-tone trick), sub 25 words, dual CTA ("Launch app" + "Read the docs"), and a live onchain-stat row (TVL / volume / addresses).
3. Trust bar: "Securing $X onchain" + ecosystem/integrator logos in a marquee + an audit-badge row.
4. Centerpiece: a BIG product mockup — the app UI (swap/lend panel, mint flow, governance dashboard, wallet screen). Specific to the variant.
5. How it works: a 3-4 step diagram of the onchain flow, with mono labels and contract hops.
6. Features grid: 4-6 cards (non-custodial, gas-optimized, composable, multi-chain, etc.).
7. Developer section: an SDK or contract code block (Solidity or TypeScript) + a "build on it" CTA.
8. Onchain stats banner: 4 metrics (TVL, total volume, unique addresses, transactions) — mono, tabular.
9. Security section: audits (firm names + dates), the bug bounty, contract verification, a "not your keys" note where relevant.
10. Governance section (where relevant): how decisions are made, the governance forum, token utility — described as MECHANISM, not as an investment.
11. FAQ: 5 sophisticated questions (custody, audits, gas costs, the decentralization roadmap, what happens if the team disappears).
12. Final CTA: "Launch app" + docs.
13. Footer: 5-col — Protocol / Developers / Governance / Ecosystem / Community + contract addresses (mono) + a Discord link.

VISUAL FLOURISHES SPECIFIC TO WEB3:
- Contract-address pills: mono, truncated in the middle (0x4f…a821) with a copy icon.
- A "Connect wallet" modal mockup with 4-5 wallet options.
- A live TVL counter with tabular-nums and a pulse-dot.
- An audit-badge row in mono.
- A network-status pill ("Mainnet · 1.2s block time").
- An onchain-flow diagram with contract hops + gas labels.

THE 5 VARIANTS — one text/html artifact per variant:

VARIANT 01: Slipstream — An Ethereum L2 zk-rollup.
- Mode: dark + blue. Bg #080A12. Accent: electric blue #4F7BFF. Text #F2F4FA.
- Display font: Inter Display 700.
- Pitch: "Ethereum security. <em>Cents per transaction</em>."
- Network: a zk-rollup — "Mainnet live · v2".
- Hero stat row: TVL ($1.48B), Avg tx cost ($0.004), Blocks (28.4M), Daily transactions (4.4M).
- Centerpiece: a bridge UI mockup — moving ETH/USDC from Ethereum → Slipstream with the proof time + cost shown.
- How it works: 4 steps — transactions batched → a zk-proof generated → posted to Ethereum → finalized.
- Features: zk-proof finality, EVM-equivalent, 1.2s block time, $0.004 avg fee, native account abstraction, a decentralized-sequencer roadmap.
- Dev section: "deploy a contract — the same Solidity, the same tooling" code snippet.
- Stats banner: TVL, total transactions, unique addresses (8.4M), contracts deployed (148,408).
- Security: audited by OpenZeppelin + Trail of Bits, a $2M Immunefi bounty, an escape-hatch for user funds.
- Governance: the decentralization roadmap (sequencer → multi-prover → governance) — mechanism, not a token pitch.
- FAQ: "How is this cheaper than Ethereum mainnet?", "What happens to my funds if the sequencer goes down?", "Is it EVM-equivalent — will my contracts just work?", "When does the sequencer decentralize?", "How long until a withdrawal to mainnet finalizes?".

VARIANT 02: Keel — A DeFi lending + borrowing protocol.
- Mode: dark + green. Bg #0A0F0C. Accent: mint green #34D399. Text #EAF4EF.
- Display font: Inter Display 700.
- Pitch: "Lend and borrow onchain. <em>No counterparty, no paperwork</em>."
- Protocol: over-collateralized lending markets.
- Hero stat row: TVL ($2.4B), Markets (28 assets), Avg supply APY (variable), Loans outstanding ($840M).
- Centerpiece: the lend/borrow app panel — supply USDC at a live APY, borrow against ETH collateral, a health-factor gauge.
- How it works: 4 steps — supply an asset → it earns yield from borrowers → borrow against your collateral → repay anytime, interest accrues per block.
- Features: over-collateralized only, per-block interest, isolated risk markets, a liquidation engine, no lockups, composable pools other protocols build on.
- Dev section: "integrate the pools" — a TypeScript SDK snippet.
- Stats banner: TVL, cumulative volume ($14.8B), unique lenders + borrowers, liquidations handled.
- Security: audits (OpenZeppelin, Spearbit), a bug bounty, formal verification of the interest-rate model, every contract verified onchain.
- Governance: a governance forum sets which markets list and their risk parameters — described as mechanism.
- FAQ: "What's the risk — can I lose my deposit?", "How does liquidation work, and at what threshold?", "Are interest rates fixed or variable?", "Who can change the risk parameters?", "What audits has the protocol had?".

VARIANT 03: Plinth — An onchain marketplace for digital art.
- Mode: dark editorial. Bg #0D0D10. Accent: warm gold #D8A848. Text #F4F2EC.
- Display font: Source Serif 4 500 italic (gallery-grade).
- Pitch: "A gallery for art that <em>lives onchain</em>."
- Marketplace: a curated digital-art and generative-art marketplace.
- Hero stat row: Artists (4,408), Works minted (148,408), Volume (in ETH), Collectors (28,408).
- Centerpiece: an artwork detail page mockup — the piece (gradient placeholder), the artist, the edition (1 of 25), the price, a "Collect" button, and provenance/ownership history (a mono tx list).
- How it works: 4 steps — an artist mints → the work is curated into a drop → a collector buys → resale royalties route back to the artist forever.
- Features: enforced creator royalties, curated drops, onchain generative-art rendering, low-gas minting (on an L2), provenance you can verify, non-custodial.
- Artist section: "apply to mint" + the minting flow.
- Stats banner: artists, works, volume, royalties paid to artists.
- Security: audited contracts, art stored on IPFS/Arweave (permanence), non-custodial.
- Governance: a curation council + community curation.
- FAQ: "Where is the actual artwork stored?", "Do artists really get royalties on resale?", "What are the fees to mint and to sell?", "What chain does it run on, and why?", "What happens to my collection if Plinth shuts down?".

VARIANT 04: Quorum — DAO governance + treasury tooling.
- Mode: dark + indigo. Bg #0B0B14. Accent: indigo #7C7CF0. Text #F0F0F6.
- Display font: Inter Display 700.
- Pitch: "Run your DAO like it <em>actually has a constitution</em>."
- Product: governance + multisig treasury + proposal tooling for DAOs.
- Hero stat row: DAOs using it (1,408), Treasury secured ($4.8B), Proposals executed (28,408), Voters (148,408).
- Centerpiece: a governance dashboard mockup — active proposals, vote tallies, the treasury balance breakdown, a multisig transaction queue.
- How it works: 4 steps — draft a proposal → an onchain vote (token or multisig) → a timelock → execution.
- Features: onchain voting, a multisig treasury, timelocks, delegation, proposal simulation (preview the onchain effect before executing), Snapshot-compatible.
- Dev section: "define a governance module" — a config snippet.
- Stats banner: DAOs, treasury secured, proposals, the execution success rate.
- Security: audited contracts, the timelock as a safety buffer, simulation that catches a malicious proposal, every action onchain and verifiable.
- Governance: this IS governance tooling — explain delegation and quorum thresholds plainly.
- FAQ: "Token-weighted or one-member-one-vote — which does it support?", "How does the timelock protect against a malicious proposal?", "Can we use it with our existing multisig?", "What does proposal simulation actually check?", "Is voting gas-free?".

VARIANT 05: Holdfast — A self-custody crypto wallet.
- Mode: dark + warm. Bg #100E0C. Accent: warm amber #F0A93C. Text #F4F0E8.
- Display font: Inter Display 700.
- Pitch: "Your keys. Your coins. <em>Finally, your peace of mind</em>."
- Wallet: a self-custody multi-chain wallet (mobile + browser extension) with smart-account safety — social recovery instead of seed-phrase anxiety.
- Hero: a phone + extension mockup — a portfolio view across chains, a "send" flow, the recovery setup.
- Hero stat row: Wallets created (2.4M), Chains supported (28), Assets tracked, "Value self-custodied — we never hold it".
- Centerpiece: the recovery model — a smart-account wallet with social recovery (guardians) instead of a 12-word seed phrase, shown as a clear diagram.
- How it works: 4 steps — create in 30s, no seed phrase → set 3 guardians → use across chains → recover via guardians if you lose your device.
- Features: a smart account (ERC-4337), social recovery, gas sponsorship, multi-chain, hardware-wallet support, transaction simulation (see what a tx does before signing), open-source.
- Dev section: "integrate the wallet" — an SDK / connect-button snippet.
- Stats banner: wallets, chains, transactions signed, phishing transactions blocked by simulation.
- Security: open-source + audited, non-custodial (keys stay on-device), simulation that warns before a malicious approval, no seed phrase to phish.
- FAQ: "If it's self-custody, what can you actually see?", "What happens if I lose my phone — how does social recovery work?", "Is there still a seed phrase?", "Which hardware wallets does it support?", "What chains are supported, and how are new ones added?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 27 — Hardware / Physical Tech Product (5 pages, mixed modes)

```
Brief: Produce 5 landing pages for HARDWARE and CONNECTED-DEVICE companies — a home robot, a smart-home hub, a wearable, a home-energy system, a prosumer drone. Apple / Rivian / DJI / Ecobee / Eight Sleep level. Industrial-design photography hero, spec tables, "what's in the box," a buy/pre-order CTA, the companion app, and warranty terms. These are engineered devices with specs, firmware, and an app — NOT a DTC consumable PDP (that's the E-commerce family).

SHARED AESTHETIC (all 5 variants):
- Display: Inter Display 600-700, -0.03em — clean product marketing.
- Body: Inter 400-500.
- Mono: Geist Mono 400 — model numbers, specs, dimensions, firmware versions, battery figures.
- Tabular-nums for specs (240mm, 4.4 kg, 18 hr, 1080p).
- Product-photography placeholders: clean studio gradients, the device at a slight 3D rotation (CSS transform: rotateY(-8deg) rotateX(4deg)), a soft shadow + an ambient glow.
- Spec tables: mono, 2-col, hairline-divided rows.
- A "what's in the box" flat-lay diagram.
- A companion-app mockup (phone) shown alongside the hardware.
- The Buy / Pre-order CTA prominent, with the price.

SHARED SECTION SKELETON (all 5 follow this):
1. Nav: product/brand logo + 4 links (Product, Specs, App, Support) + accent CTA pill ("Buy · $X" or "Pre-order").
2. Hero: pill badge ("Now shipping" / "Pre-order · ships Nov 2026"), display headline (half-tone trick), sub 25 words, dual CTA (Buy + "Watch the film"), a big product photo placeholder at a 3D angle with a glow.
3. Trust / proof bar: reviews or a press marquee ("★4.8 · 12,408 owners" or press wordmarks).
4. Feature sections: 3 alternating big rows, each with a product-detail photo + h2 + paragraph + a small spec callout.
5. The companion app: a phone mockup + what the app does (control, schedule, insights, firmware updates).
6. Hardware tech-spec section: a full spec table (dimensions, weight, battery, connectivity, sensors, materials) in mono.
7. "What's in the box": a flat-lay diagram of the included items.
8. Use-case / lifestyle band: 3-4 cards showing the device in real scenarios.
9. Stats / outcomes banner: 4 metrics (owners, what it saves or does, battery life, uptime).
10. Pricing / editions: 1-3 buy options (Standard / Plus / a bundle) + a financing mention + warranty + the return window.
11. Reviews + FAQ: an aggregate rating + 3-4 owner reviews; an FAQ of 5 hardware questions (warranty, app subscription, repair, compatibility, setup).
12. Final CTA: "Buy · $X · free shipping · 30-day returns".
13. Footer: brand + Product / Support / Company / Legal + warranty + recycling/sustainability + © + a regulatory note (an FCC ID placeholder, mono).

VISUAL FLOURISHES SPECIFIC TO HARDWARE:
- The device shown at a 3D tilt (rotateY/rotateX) with a soft shadow + a radial glow.
- A spec table: mono, 2-col, hairline rows.
- A "what's in the box" flat-lay with labeled items.
- An exploded-view or callout diagram (lines pointing to components).
- A companion-app phone mockup beside the hardware.
- Battery / range / capacity shown as a labeled gauge or bar.
- A press or award badge ("CES Innovation Award 2026").

THE 5 VARIANTS — one text/html artifact per variant:

VARIANT 01: Roam — An autonomous robotic lawn mower.
- Mode: light + green. Bg #F6F8F3. Accent: deep grass green #3C7A3F. Text #18241A.
- Display font: Inter Display 700.
- Pitch: "The lawn mows itself. <em>You take the morning back</em>."
- Audience: suburban homeowners with 0.1-0.75 acre lawns who would rather not mow.
- Price / status: "$1,899 · now shipping · free delivery".
- Hero: the robot on a lawn at a 3D angle, with a glow.
- Features: wire-free RTK-GPS navigation (no boundary wire to bury), mulching blades, climbs 24° slopes, a rain sensor, theft tracking + a PIN lock.
- App: set zones on a map, schedule, "mow now," see the mow history, firmware updates.
- Specs: cutting width 22cm, max slope 24°, lawn size up to 0.75 acre, battery 5.0 Ah, charge time 65 min, IPX5, noise 58 dB, weight 11.2 kg.
- In the box: the mower, a charging dock, the RTK antenna, 9 spare blades, a power cable.
- Stats: Owners (84,408), Avg hours of mowing saved per season (38), Battery runtime per charge (90 min), Lawns mapped.
- Pricing: Roam ($1,899), Roam Plus (larger battery + up to 1.0 acre, $2,399).
- FAQ: "Do I need to bury a boundary wire?", "How does it handle slopes and obstacles?", "Is it safe around kids and pets?", "Is there an app subscription?", "What's the warranty, and how are repairs handled?".

VARIANT 02: Lintel — A smart-home hub + controller.
- Mode: dark + warm. Bg #14131A. Accent: warm coral #F2755A. Text #F2F0F4.
- Display font: Inter Display 700.
- Pitch: "Every smart device in your home, <em>finally in one place</em>."
- Audience: people with a drawer of incompatible smart-home gadgets across ecosystems.
- Price / status: "$199 · now shipping".
- Hero: the hub (a small ceramic-looking object) at a 3D angle + a phone showing the app.
- Features: a Matter controller + Thread border router, works across Apple Home / Google / Alexa, local-first (works without internet), an automations engine, a physical dial for the most-used scene.
- App: rooms, devices, an automations builder, an energy view, a "leaving home" routine.
- Specs: Thread border router, Matter controller, Wi-Fi 6, Bluetooth LE, 2.4/5GHz, dimensions, weight, local storage, power draw 2.4 W.
- In the box: the hub, a USB-C power adapter, a wall mount, a quick-start card.
- Stats: Homes (148,408), Device brands supported, Automations run daily, Avg setup time (12 min).
- Pricing: Lintel ($199) — and a clear note: "the hub runs automations locally; there is no monthly fee".
- FAQ: "Does it work with Apple Home and Google at the same time?", "What happens to my automations if the internet goes down?", "Is there a subscription?", "What are Matter and Thread — do I need new devices?", "How is my data handled — does it leave the house?".

VARIANT 03: Loop — A health + sleep wearable band.
- Mode: dark gradient. Bg radial #0A0A12 → #15131F. Accent: soft violet #9B8CFF. Text #F2F1F6.
- Display font: Inter Display 700.
- Pitch: "Know how you slept before you <em>open your eyes</em>."
- Audience: adults who want sleep + recovery + activity tracking without a screen on their wrist.
- Price / status: "$229 · ships in 2 weeks".
- Hero: the band at a 3D angle + a phone showing the morning-readiness screen.
- Features: sleep stages, HRV + resting HR, skin temperature, blood-oxygen, a daily readiness score, a 7-day battery, screenless (the app is the screen).
- App: morning readiness, the sleep breakdown, trends, gentle nudges.
- Specs: sensors (PPG, accelerometer, skin-temp, SpO₂), battery 7 days, charge time 45 min, water-resistant to 100 m, weight 8 g, band sizes.
- In the box: the band, a charger, a sizing kit.
- Stats: Owners (612,408), Avg nights tracked per owner, Battery life (7 days), App rating (4.7).
- Pricing: Loop ($229 one-time) — the core app is free; an optional Loop+ membership ($6/mo) adds long-term trends and a daily coaching summary. State this honestly.
- FAQ: "Is there a subscription, and what do I lose without it?", "How accurate is the sleep-stage tracking?", "How is my health data stored — is it ever sold?", "Can I wear it in the shower or swimming?", "Does it have a screen or notifications?".

VARIANT 04: Sunhouse — A home solar + battery system.
- Mode: light + warm sun. Bg #FBF7EE. Accent: warm solar amber #E6952A. Text #1F1A12.
- Display font: Inter Display 700.
- Pitch: "Your roof, <em>finally earning its keep</em>."
- Audience: homeowners considering solar + storage, overwhelmed by quotes and jargon.
- Price / status: "From $14,900 installed · free design + quote".
- Hero: a house with panels + the battery unit in warm light; a phone showing the energy flow.
- Features: high-efficiency panels, a home battery for backup + time-of-use savings, an energy app, blackout backup that switches over in under 20 ms, expandable battery stacks.
- App: a live energy flow (solar → home → battery → grid), savings, a storm-prep "charge to full," backup history.
- Specs: panel wattage, battery capacity 13.5 kWh (stackable to 40.5), the inverter, backup transfer time <20 ms, round-trip efficiency 90%, 12-year warranty.
- "What's included": panels, the battery, the inverter, monitoring, install, permitting + utility interconnection.
- Stats: Homes powered (28,408), Avg annual bill reduction, kWh stored, Avg blackout coverage in hours.
- Pricing: a clear breakdown — the system from $14,900 installed, financing from a monthly figure, the federal tax-credit note, and "the quote is fixed after the design visit."
- FAQ: "How much will this actually cut my bill?", "Does it keep the lights on in a blackout — for how long?", "Who handles the permits and the utility paperwork?", "Can I add more battery later?", "What's covered by the 12-year warranty?".

VARIANT 05: Skylark — A prosumer mapping + inspection drone.
- Mode: dark + sky. Bg #0A0E14. Accent: sky cyan #38BDF8. Text #EFF4F8.
- Display font: Inter Display 700.
- Pitch: "Survey-grade maps, <em>before lunch</em>."
- Audience: surveyors, construction sites, agriculture, and inspection pros — not hobbyist filmmakers.
- Price / status: "$2,449 · now shipping".
- Hero: the drone at a 3D angle + a tablet showing a generated 3D site map.
- Features: RTK centimeter-accuracy positioning, automated mapping flights, a 1-inch sensor, 38-min flight time, obstacle avoidance, swappable batteries, maps that process in the cloud or on-device.
- App: plan an automated grid flight, live map stitching, 3D-model export, volume measurement for stockpiles.
- Specs: sensor 1-inch 20 MP, RTK accuracy 1 cm, flight time 38 min, range, wind resistance, weight 1.1 kg, IP rating, batteries.
- In the box: the drone, the controller, 3 batteries, a charging hub, 6 spare props, a case.
- Stats: Units in the field (14,408), Acres mapped, Flight time per battery (38 min), Map accuracy (1 cm RTK).
- Pricing: Skylark ($2,449), Skylark Survey Kit (+2 batteries + a rugged case + 1 year of cloud processing, $3,199).
- FAQ: "Do I need a license to fly it commercially?", "How accurate are the maps — is it truly survey-grade?", "Is cloud processing required, or can it run offline?", "What's the obstacle-avoidance coverage?", "How are repairs and crash replacements handled?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 28 — Podcast / Show Pages (5 pages, mixed modes)

```
Brief: Produce 5 landing pages for PODCASTS — a long-form interview show, a serialized narrative-documentary podcast, a tech-and-business podcast network, a true-crime investigative show, and a weekly culture-and-comedy show. These are individual SHOW home pages — the page a new listener lands on. NPR / Radiotopia / Wondery / Pushkin / Maximum Fun level. Heavy on cover art, an episode list, a "listen on" badge row (Apple Podcasts, Spotify, Overcast, YouTube, Pocket Casts, RSS), host bios, and a recent-episodes feed. NOT a podcast-hosting SaaS product (that's the SaaS family) — this is one show's marketing page. Mock the audio player UI statically — NO real audio JS.

SHARED AESTHETIC (all 5 variants):
- Display: per-variant — a podcast brand can be serif or grotesk; pick to fit the genre.
- Body: Inter 400-500 (or a serif per variant).
- Mono: Geist Mono 400 — episode numbers, durations, release dates, season tags.
- The cover art is the centerpiece: a SQUARE artwork tile — a gradient + a bold inline-SVG motif + the show title locked up inside it — shown with a soft shadow. It anchors the hero.
- A "listen on" badge row: small pills, each with the platform glyph as inline SVG + the name (Apple Podcasts, Spotify, Overcast, YouTube, Pocket Casts, RSS).
- A static audio-player mockup: a play button, a scrubber with a played/unplayed split + a knob, a procedural waveform strip (varying-height SVG bars), elapsed / total time in mono.
- Episode rows: a number ("EP 142" in mono), the title, a one-line teaser, the duration, the date.

SHARED SECTION SKELETON (all 5 follow this):
1. Nav: the show wordmark + 4 links (Episodes, About, Hosts, Newsletter) + an accent "Subscribe" pill.
2. Hero: the square cover art + the show title + a one-line premise + the listen-on badge row + a static player mockup cued to the latest episode + a "new episode every [day]" line with a pulse-dot.
3. Proof bar: a metric row (episodes published, total downloads, avg rating) + a press marquee or an "as heard on" row.
4. Latest / featured episodes: 4-6 episode rows or cards — number, title, teaser, duration, date, a mini play button.
5. About the show: 2-3 paragraphs on the premise + a "start here" trio of recommended episodes for a new listener.
6. Hosts: 1-3 host cards — an avatar (gradient + initials), a name, a one-line bio, a social link.
7. A pull-quote: a listener review or a press quote, set large.
8. Newsletter: an email signup tied to the show ("show notes + links, every episode").
9. Seasons / back-catalog (where relevant): a season selector or an archive teaser.
10. FAQ: 4-5 questions a listener or a prospective guest would ask (the release schedule, where to listen, transcripts, pitching a guest, ads/sponsorship).
11. Final CTA: "Subscribe" + the listen-on badge row again.
12. Footer: the show + Episodes / About / Follow / Contact + an RSS link + © + a "part of [network]" line where relevant.

VISUAL FLOURISHES SPECIFIC TO PODCAST:
- The square cover-art tile with a bold SVG motif + the title set inside it.
- A procedural waveform strip — varying-height bars in SVG.
- A scrubber with a played-portion fill + a knob.
- Platform glyphs as inline SVG in the listen-on badges.
- Episode-number pills in mono ("S3 · EP 142").
- A pulse-dot on "new episode Thursdays".

THE 5 VARIANTS — one text/html artifact per variant:

VARIANT 01: Wavelength — A long-form interview podcast.
- Mode: dark + warm. Bg #121013. Accent: warm amber #E8A33D. Text #F3F0EA.
- Display: Fraunces 600 — a characterful, literary serif.
- Premise: "Two-hour conversations with people who think for a living — scientists, founders, artists, and the occasional contrarian."
- Cover-art motif: concentric arcs radiating like a waveform.
- New episode: "every Tuesday."
- Stats: Episodes (218), Total downloads (14.8M), Avg rating (4.9 · 24,408 ratings), Countries reached (148).
- Episodes: guest-driven titles — "142 · The neuroscientist who maps boredom", "141 · A war reporter on telling the truth slowly".
- Hosts: 1 — a curious, well-read interviewer.
- Start here: 3 recommended deep-dive episodes.
- FAQ: "How long are episodes, really?", "Where can I get transcripts?", "How do I pitch a guest?", "Are episodes edited or raw?", "Is there an ad-free version?".

VARIANT 02: Spool — A serialized narrative-documentary podcast.
- Mode: cream editorial. Bg #F4EFE4. Accent: deep oxblood #8C3A2E. Text #1E1813.
- Display: Source Serif 4 600 — documentary-grade, cinematic.
- Premise: "One story, told over a season. This year: a town, a missing archive, and forty years of silence."
- Cover-art motif: an unspooling reel of tape — a single thread coming loose.
- Structure: season-based — a prominent SEASON 3 banner, an episode list 1-8, a "previously on" feel.
- New episode: "new chapters every Wednesday through the season."
- Stats: Seasons (3), Episodes this season (8), Avg listeners per episode, Awards (a fictional documentary-podcast award).
- Episodes: chapter-style — "Chapter 4 · The room with no windows".
- Hosts: 1 narrator/reporter + a producer credit row.
- A press quote set large (a magazine reviewing the season).
- FAQ: "Do I need to start from episode 1?", "How many episodes are in a season?", "When does the next season drop?", "Are there transcripts and a sources list?", "Is it based on a true story?".

VARIANT 03: Frequency — A tech-and-business podcast network.
- Mode: dark + electric. Bg #0B0D12. Accent: electric blue #5B8CFF. Text #EEF1F6.
- Display: Inter Display 700, -0.035em — modern, crisp.
- Premise: "Five shows on how technology actually gets built and sold — hosted by people who've shipped." This is a NETWORK home page: it lists multiple shows.
- Cover-art motif: a stacked-bars / equalizer mark — but show a GRID of 5 mini show covers rather than one big tile.
- New episode: "a new episode somewhere on the network almost every weekday."
- Stats: Shows (5), Episodes across the network (1,408), Monthly downloads (3.4M), Subscribers.
- Section twist: instead of one episode list, "the shows" grid (5 cards) + a combined "latest across the network" feed.
- Hosts: a row of 6-8 host avatars across the shows.
- FAQ: "Can I subscribe to just one show?", "Is there a combined feed?", "How do I advertise on the network?", "Do you do live shows?", "How do I pitch my show to join?".

VARIANT 04: Hearsay — A true-crime investigative podcast.
- Mode: dark + moody. Bg radial #0C0A0A → #141011. Accent: muted blood-red #C7443B. Text #ECE7E4.
- Display: Inter Display 700 — tense and restrained, NOT campy or tabloid.
- Premise: "A reporter reopens a case the police closed in 1994. Eight episodes. New evidence in every one." Keep it serious and journalistic — no gore, no exploitation.
- Cover-art motif: a redacted case-file folder with a thin red thread.
- Tone note in the copy: investigative and sober — case timelines, documents, interviews — not sensational.
- New episode: "Thursdays · 8 episodes."
- Stats: Episodes (8), Downloads (28.4M), Tips received from listeners, Avg rating.
- Episodes: "Episode 3 · The 911 call no one logged".
- A "content note" line — handled responsibly, source-driven.
- Hosts: 1 investigative reporter + a producer.
- FAQ: "Is this based on a real case?" (a fictional composite — say so plainly), "How was the reporting verified?", "Can I send a tip?", "Will there be a season 2?", "Are there transcripts and a sources page?".

VARIANT 05: Aside — A weekly culture-and-comedy show.
- Mode: light + playful. Bg #FBF8F3. Accent: hot tangerine #F0612B. Text #1C1815.
- Display: Bricolage Grotesque 700 — friendly, rounded, loud.
- Premise: "Three friends, one hour, zero agenda — overthinking the internet, bad movies, and snacks since 2019."
- Cover-art motif: a bold, goofy cluster of speech bubbles and shapes.
- New episode: "every Friday."
- Stats: Episodes (312), Downloads (8.4M), Avg rating (4.8), Live shows played (24).
- Episodes: funny real-sounding titles — "287 · We ranked every cereal and lost two friendships".
- Hosts: 3 host cards with playful one-line bios.
- A community section — a Discord, listener voicemails, a merch teaser.
- FAQ: "How explicit is the show?", "Can I send in a voicemail?", "Do you tour / do live shows?", "Where's the merch?", "How do I get a shout-out?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 29 — Wedding Websites (5 pages, mostly cream + light modes)

```
Brief: Produce 5 WEDDING WEBSITES — the single-page site a couple shares with their guests. Five couples, five aesthetics: a classic estate-garden wedding, a modern minimal city wedding, a botanical vineyard wedding, a moody candlelit autumn wedding, and an airy coastal wedding. Think the elevated end of Zola / The Knot / Squarespace wedding templates — a designed, bespoke feel. Heavy on the couple's names + the date, an "our story" section, the day-of schedule, venue + travel + accommodations, an RSVP form, and a registry. These are warm, personal, photo-led pages — NOT a wedding-vendor business (that would be Hospitality or Local Services).

SHARED AESTHETIC (all 5 variants):
- Display: per-variant — wedding sites lean serif and characterful; one variant goes clean sans.
- Body: a readable serif or Inter, per variant.
- The couple's two first names + the date are the hero. A two-initial monogram (inline SVG) is a recurring motif.
- A countdown element ("142 days") — render the number statically, no live JS.
- Photo placeholders: soft, warm gradients with a thin inset frame; portrait + landscape crops; a small gallery grid.
- The date shown formally ("Saturday, the twentieth of June, two thousand twenty-seven") AND in mono ("06 · 20 · 2027").
- An RSVP form — name, number of guests, meal choice, song request, attending yes/no — fully styled; it does NOT need a working backend.
- Gentle motion only — soft fades, no aggressive animation.

SHARED SECTION SKELETON (all 5 follow this):
1. A slim anchor nav: the monogram + anchor links (Story, Schedule, Travel, RSVP, Registry).
2. Hero: the two first names (huge), the date, the city/venue, a "we're getting married" line, a hero photo placeholder, the countdown.
3. Our story: how they met → the proposal — 2-3 short passages, a couple of photos, a small timeline.
4. The wedding party (where it fits): a few cards — name, role (Maid of Honor, Best Man), a one-line note.
5. Schedule / the day: a timeline — ceremony, cocktail hour, dinner, dancing — times in mono, with locations.
6. Venue + travel: the venue with a stylized map block, getting there, hotel room blocks, parking, an "out of town" note.
7. Things to do: 3-4 cards for guests staying the weekend (a restaurant, a hike, a coffee spot).
8. RSVP: the form, with a clear reply-by date.
9. Registry: a short, tasteful note + 3-4 registry cards (a store, a honeymoon fund, a charity).
10. FAQ: 5-6 real guest questions (dress code, kids, plus-ones, weather / indoor-outdoor, arrival time, an unplugged ceremony).
11. A closing line + the monogram + a "can't wait to celebrate with you".
12. Footer: the names, the date, an email for questions, the wedding hashtag.

VISUAL FLOURISHES SPECIFIC TO WEDDING:
- A two-initial monogram as inline SVG — interlocking letters or a small wreath.
- A large countdown number set in the display face.
- A day-of timeline — a vertical line with time nodes.
- A stylized venue map block — an SVG abstraction, not a real map.
- A small photo-gallery grid with mixed crops.
- Decorative dividers — a thin botanical sprig, or a hairline rule with a centered dot.

THE 5 VARIANTS — one text/html artifact per variant:

VARIANT 01: Magnolia — Maya & Daniel · a classic estate-garden wedding.
- Mode: cream + classic. Bg #F6F1E7. Accent: deep magnolia green #2F4A3A + a soft blush #D9A89C secondary. Text #211C16.
- Display: Cormorant Garamond 600 — a timeless, high-contrast serif.
- Where / when: a historic estate garden outside Charleston · "Saturday, June 20, 2027".
- Tone: formal, gracious, timeless — black-tie optional.
- Story beats: met at a friend's wedding, together eight years, proposed in the same garden.
- Schedule: ceremony 4:30, cocktails on the lawn, dinner in the orangery, dancing to midnight.
- FAQ: dress code (black-tie optional), kids (an adults-only reception), the ceremony is outdoors (a weather plan), shuttle times, an unplugged ceremony.

VARIANT 02: Vow — Priya & Sam · a modern minimal city wedding.
- Mode: light + minimal. Bg #FCFCFB. Accent: a confident ink black #161616 + one warm pop, saffron #E2A12D. Text #161616.
- Display: a clean grotesk — Inter Display 700, very tight; generous whitespace.
- Where / when: a loft event space in downtown Chicago · "10.03.2027".
- Tone: design-forward, minimal, confident — "we kept it simple."
- Story beats: matched on an app, a first date that ran six hours, proposed on an ordinary Tuesday.
- Schedule: a tight evening — ceremony 6:00, dinner, a DJ.
- FAQ: dress code (cocktail), the venue is one room (all indoors), transit + parking, the plus-one policy, the registry is mostly a honeymoon fund.

VARIANT 03: Bower — Elena & Thomas · a botanical vineyard wedding.
- Mode: light + botanical. Bg #F7F6F0. Accent: vineyard green #5A7350 + a dusty grape #7E5C74. Text #25241C.
- Display: Fraunces 500 italic — soft, romantic, leafy.
- Where / when: a family vineyard in the Willamette Valley · "Saturday, September 11, 2027".
- Tone: romantic, garden-party, golden-hour — botanical dividers throughout.
- Story beats: met working a harvest, long-distance for two years, proposed between the rows at sunset.
- Schedule: ceremony among the vines 5:00, a long-table dinner, string lights, dancing under the old oak.
- FAQ: dress code (garden formal — flat shoes for grass), kids welcome, mostly outdoors, the nearest towns + hotels, carpooling.

VARIANT 04: Evermore — Noor & James · a moody candlelit autumn wedding.
- Mode: dark + romantic. Bg #15110F. Accent: candle gold #C9A24B + a deep ember #9A3B2E. Text #F0E9DF.
- Display: Cormorant Garamond 600 — dramatic, high-contrast on dark.
- Where / when: a restored barn and manor library in the Hudson Valley · "Saturday, November 7, 2027".
- Tone: intimate, candlelit, autumnal — warm low light, deep tones, a fireside feel.
- Story beats: friends first for a decade, the slow realization, a winter proposal.
- Schedule: an evening wedding — ceremony 5:30 at dusk, a candlelit dinner, a band, a late-night bonfire.
- FAQ: dress code (formal, autumn layers — it gets cold), it's an indoor evening, kids (a note), hotel blocks, an end-of-night shuttle.

VARIANT 05: Seaglass — Ava & Mateo · an airy coastal wedding.
- Mode: light + coastal. Bg #F4F7F7. Accent: sea blue #3F7E94 + a warm sand #D8B98A. Text #1B2A2E.
- Display: a light, airy serif — Spectral 500 or Cormorant 500.
- Where / when: a bluff above the water on the Mendocino coast · "Saturday, July 17, 2027".
- Tone: relaxed, sun-and-salt, barefoot-elegant — light and airy, lots of white space.
- Story beats: met surfing badly, taught each other things, proposed on the beach at low tide.
- Schedule: ceremony on the bluff 5:00, a clambake dinner, a bonfire and dancing on the sand.
- FAQ: dress code (coastal cocktail — bring a layer for the wind), kids welcome, the ceremony is on sand (shoe advice), tides + timing, where to stay, an unplugged ceremony.

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 30 — Travel & Tourism (5 pages, mixed modes)

```
Brief: Produce 5 landing pages for TRAVEL businesses — a small-group adventure trekking operator, a bespoke luxury trip-planning agency, a regional destination-marketing site, a classic multi-day rail journey, and a surf-and-dive retreat operator. Much Better Adventures / Black Tomato / a "Visit [place]" tourism board / Belmond / a boutique retreat brand level. Heavy on destination photography, day-by-day itineraries, departure dates + trip prices, what's-included lists, small-group sizes, and a booking/enquiry CTA. These pages sell a TRIP or a DESTINATION — NOT a single hotel or restaurant (that's the Hospitality family).

SHARED AESTHETIC (all 5 variants):
- Display: per-variant — travel brands range from rugged grotesk to elegant serif.
- Body: Inter 400-500 (or a serif per variant).
- Mono: Geist Mono 400 — dates, trip lengths, distances, altitudes, prices, group sizes.
- Big landscape photo placeholders: rich gradients evoking the destination (alpine, desert, ocean, vintage rail); full-bleed photo bands; a stacked gallery.
- Itinerary blocks: "Day 1 / Day 2 …" with a route line, place names, and a one-line summary each.
- A trip-facts strip: duration, group size, difficulty/grade, best season, price-from — in mono.
- A departures table: dates, price, availability ("3 spots left", with a pulse-dot on the ones filling up).
- A stylized route map — an SVG abstraction with numbered stops, not a real map.

SHARED SECTION SKELETON (all 5 follow this):
1. Nav: brand logo + 4 links (Trips/Destinations, Itinerary, Dates, About) + an accent CTA ("Book" / "Plan my trip" / "Enquire").
2. Hero: a pill badge (a season or a tagline), display headline (half-tone trick), sub 25 words, a primary CTA, a full-bleed destination photo, the trip-facts strip beneath.
3. Trust bar: a metric row (travelers hosted, years running, avg rating) + a press marquee or an "as featured in" row.
4. The trip / destination overview: 2-3 paragraphs + 2-3 highlight photos + a stylized route map.
5. Day-by-day itinerary: 6-10 day blocks, each with a number, a title, a 2-line description; a route line connecting them.
6. What's included / not included: two columns — meals, guides, transfers, permits, gear vs. flights, insurance, tips.
7. Where you'll stay: 3-4 cards (lodges, mountain huts, a sleeper cabin, a beach house).
8. The guides / the team: 2-3 cards — name, a one-line bio, languages, years guiding.
9. Departures + pricing: a dates table (date, price, availability) + what the price includes + a deposit note.
10. Reviews: an aggregate rating + 3-4 traveler reviews, each with a trip + a date.
11. FAQ: 5-6 real questions (the fitness/grade required, solo travelers, group size, what to pack, cancellation + insurance, visas/permits).
12. Final CTA: "Book" / "Enquire" + the next departure date.
13. Footer: brand + Trips / About / Travel info / Contact + a financial-protection (ATOL-style) badge placeholder + © + a sustainability note.

VISUAL FLOURISHES SPECIFIC TO TRAVEL:
- A stylized route map — an SVG line with numbered stops.
- An itinerary timeline with day nodes.
- A trip-facts strip in mono (12 days · max 12 people · moderate · from $X).
- A departures table with availability pills + a pulse-dot on "filling up".
- A "best time to go" mini calendar / a season bar.
- Full-bleed destination photo bands.

THE 5 VARIANTS — one text/html artifact per variant:

VARIANT 01: Switchback — A small-group adventure trekking operator.
- Mode: dark + alpine. Bg #0E1113. Accent: trail orange #EE6C2B. Text #EEF1F2.
- Display: Inter Display 700, -0.035em — rugged, modern.
- Pitch: "The Dolomites, the high way. <em>A bed and a hot dinner at every stop.</em>"
- The hero trip: "The Dolomites High Route — 9 days, hut to hut." The brand runs many treks; this page sells this one, with a "more trips" teaser.
- Trip facts: 9 days · max 12 people · moderate-to-hard · June–September · from $2,890.
- Itinerary: 9 day blocks across alpine passes and mountain huts, with a summit day.
- Stays: mountain refugios / huts.
- Guides: 2 IFMGA-certified mountain guides.
- Stats: Travelers hosted (38,408), Operating since (1994), Avg rating (4.9), Routes (60+).
- FAQ: "How fit do I need to be?", "Do I need technical climbing experience?", "Is it okay to come solo?", "What gear do I bring vs. rent?", "What's the cancellation and insurance policy?", "How big are the groups?".

VARIANT 02: Wayfare — A bespoke luxury trip-planning agency.
- Mode: cream + editorial. Bg #F4EFE6. Accent: deep indigo #2E3A5C + a brass #B08A4A secondary. Text #1E1A14.
- Display: Cormorant Garamond 600 — refined, quietly luxurious.
- Pitch: "Tell us how you want to feel. <em>We design the rest.</em>"
- The pitch in full: not a fixed itinerary — a bespoke service. Sample journeys are shown as inspiration, not a catalog.
- Section twist: instead of a fixed day-by-day, show 3 "sample journeys" (Japan in autumn, Patagonia, a Kenya safari) as cards, plus a "how it works" 4-step (a call → a designed proposal → refine → travel with 24/7 support). The trip-facts strip becomes a "what bespoke includes" strip.
- The team: travel designers, each with a region of expertise.
- Stats: Journeys designed, Designing since (2009), Repeat clients (a high %), Destinations (90+).
- A large client quote.
- FAQ: "How much does a trip typically cost?", "How far ahead should I plan?", "What does the planning fee cover?", "Can you handle a multi-generational group?", "What happens if something goes wrong mid-trip?", "Do you book flights too?".

VARIANT 03: Latitude — A regional destination-marketing site.
- Mode: light + bright. Bg #F8FAF9. Accent: a vivid sea-teal #1B9E8A + a warm coral #F0784A secondary. Text #16201E.
- Display: Bricolage Grotesque 700 — friendly, bright.
- Pitch: "Forty beaches, two seasons, <em>one very easy decision.</em>"
- The page: a tourism-board site for a fictional place — "Visit the Marisol Coast" (a fictional coastal region). It markets a DESTINATION, not one tour.
- Section twist: no single itinerary — instead "things to do" categories (beaches, food, hikes, towns, culture) as a grid; a "where to stay" range (from camps to resorts); a seasonal "when to visit" bar; "getting here" (the airport, ferries); 3-4 suggested 3-day itineraries as cards.
- Stats: Annual visitors, Beaches (40+), Miles of coastline, Avg sunny days a year.
- Photo-forward — lots of full-bleed bands.
- FAQ: "When is the best time to visit?", "How do I get there?", "Do I need a car?", "Is it family-friendly?", "What's the local currency and language?", "Is it expensive?".

VARIANT 04: Overland — A classic multi-day rail journey.
- Mode: warm + vintage. Bg #F3EBDD. Accent: deep forest green #2C4A35 + an oxblood #7E3A2C secondary. Text #211B12.
- Display: Fraunces 600 — a characterful, heritage serif.
- Pitch: "Four days to the mountains, <em>at the speed of a good book.</em>"
- The trip: "The Highland Line — a 4-day sleeper journey from the coast to the mountains," aboard a restored vintage train.
- Tone: romantic, slow travel, golden-age railway posters — vintage but not kitsch.
- Itinerary: 4 day blocks, each a leg of the line — the stops, the scenery, the dinners; a route map along the rail line.
- Stays: the train's sleeper cabins — a 3-tier comparison (Twin, Cabin Suite, Observation Suite).
- Trip facts: 4 days · 3 nights onboard · 2 departures a week · April–October · from $3,400 per person.
- Stats: Years running, Miles of track, Cabins (a small, intimate number), Avg rating.
- FAQ: "What's a sleeper cabin actually like?", "Are all meals included?", "Can I get on and off at the stops?", "Is there a single-traveler option?", "What should I pack?", "Is there wifi and phone signal?" (lean into "mostly not — that's the point").

VARIANT 05: Offshore — A surf-and-dive retreat operator.
- Mode: dark + ocean. Bg #081318. Accent: a bright aqua #2BC4D4. Text #E9F4F5.
- Display: Inter Display 700 — clean, energetic.
- Pitch: "Surf twice a day. <em>The rest of the week is yours.</em>"
- The trip: a week-long surf-and-dive retreat on a fictional tropical coast — 7 nights, twice-daily surf, an optional dive certification, a shared beach house.
- Tone: energetic but laid-back — salt, sun, a small crew.
- Itinerary: a 7-day rhythm — dawn surf, breakfast, free time, an afternoon session or dive, sunset — shown as a "typical day" + a week grid, looser than a trek itinerary.
- Stays: a shared beach house — room types (a shared room, a private room, a cabana).
- What's included: accommodation, all surf sessions, board use, breakfast + dinner, airport transfers; the dive certification is an add-on.
- Trip facts: 7 nights · max 14 guests · all levels · year-round · from $1,690.
- Stats: Retreats run, Guests hosted, Surf coaches, Avg rating (4.9).
- FAQ: "I've never surfed — is that okay?", "Do I need to be a strong swimmer?", "Can non-surfers come along?", "What's the dive-certification add-on?", "Is it social, or can I keep to myself?", "What's the cancellation policy?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 31 — Food & Beverage Brand (5 pages, mostly light + warm modes)

```
Brief: Produce 5 landing pages for FOOD & BEVERAGE consumer brands — a specialty coffee brand, a craft non-alcoholic sparkling-drink brand, a premium chocolate maker, a pantry-staples brand (olive oil + condiments), and a better-for-you snack brand. Think the brand home page of Oatly / Olipop / Dandelion Chocolate / Graza / Magic Spoon — the page that carries the brand story and shows the whole range. Heavy on a strong brand voice, the product range (multiple SKUs), ingredient + sourcing stories, a "where to buy" / stockist section, and a shop CTA. This is a multi-product BRAND page — NOT a single-product DTC PDP (that's the E-commerce family) and NOT a café or restaurant (that's Hospitality).

SHARED AESTHETIC (all 5 variants):
- Display: per-variant — F&B brands lean into characterful type (a chunky grotesk, a warm serif, a retro face).
- Body: Inter 400-500 (or a warm serif per variant).
- A strong, confident brand color — F&B is allowed to be bright; pick a palette that reads like packaging.
- Product placeholders: render the PACKAGE itself — a bag, a can, a bar, a bottle, a jar — as a CSS/SVG construction (a rounded shape, a label lockup, the brand mark, the flavor name) with a soft shadow. Show the RANGE: 3-6 products in a row, each in a different flavor color.
- A range row where each SKU is its own color chip.
- Ingredient callouts: short, honest, specific ("4 ingredients", "60% cacao, nothing else", "5g of sugar, all from fruit").
- A "find us" / stockist feel — store wordmarks, a "now at" line.

SHARED SECTION SKELETON (all 5 follow this):
1. Nav: brand logo + 4 links (Shop, Our Range, Story, Stockists) + an accent "Shop" pill (with a price-from or "free shipping over $X").
2. Hero: a pill badge ("New: [flavor]" or a brand tagline), display headline (half-tone trick), sub 25 words, a primary "Shop" CTA, and a hero product render — the package front and center, or a row of the range.
3. Proof bar: reviews ("★4.8 · 9,408 reviews") + a press marquee ("as seen in") or stockist wordmarks.
4. The range: a grid of 3-6 products — each render + name + a one-line description + a price; each in its flavor color.
5. The brand story: 2-3 paragraphs — why the brand exists, the founder's reason, what they refused to compromise.
6. Ingredients / how it's made: a sourcing or process section — 3-4 steps, or a "what's in it / what's not" comparison; honest and specific.
7. A bestseller spotlight: one product, big — the detail, the taste notes, an alternating render/copy row.
8. Ways to enjoy / a subscription: a usage section (recipes, pairings, a ritual) OR a subscribe-and-save block.
9. Reviews: an aggregate rating + 3-4 customer reviews (a name + the product they bought).
10. Where to buy: stockist logos / a store list + a store-locator teaser ("now in 1,200 stores") + an online-shop CTA.
11. FAQ: 5 questions (ingredients/allergens, shipping + how it ships, shelf life, the packaging's sustainability, subscription terms).
12. Final CTA: "Shop the range" + a free-shipping line.
13. Footer: brand + Shop / Our story / Stockists / Help + a newsletter signup + © + an allergen / nutrition-info link placeholder.

VISUAL FLOURISHES SPECIFIC TO FOOD & BEVERAGE:
- The product package rendered in CSS/SVG — a bag / can / bar / bottle / jar with a label lockup.
- A range row where each SKU has its own flavor color.
- Ingredient pills — short and bold ("4 ingredients", "Gluten-free", "30% less sugar").
- A "what's in it / what's not" two-column comparison.
- Taste-note tags ("notes of cocoa, dried cherry, brown sugar").
- A stockist logo strip.

THE 5 VARIANTS — one text/html artifact per variant:

VARIANT 01: Daybreak — A specialty coffee brand.
- Mode: cream + warm. Bg #F3EBDD. Accent: deep roast brown #4A2E1E + a burnt-orange #D2622B pop. Text #1F1710.
- Display: Fraunces 600 — a warm, characterful serif.
- Pitch: "Coffee worth <em>waking up early for.</em>"
- Product: whole-bean and ground coffee in bags — a range of 4 roasts (a bright single-origin, a balanced house blend, a dark roast, a decaf) + a subscription.
- Render: a stand-up coffee bag with a one-way valve and a roast-name label, in 4 roast colors.
- Story: a roaster who started in a garage, direct relationships with 6 farms, roasts to order.
- Process: green sourcing → roast to order → ships within 48 hours of roasting; a roast-date stamp on every bag.
- Spotlight: the house blend, with taste notes.
- Subscription: subscribe-and-save — choose the grind and the cadence.
- FAQ: "Whole bean or ground?", "How fresh is it — when was it roasted?", "How should I store it?", "Can I pause or skip a subscription?", "Do you ship internationally?".

VARIANT 02: Highball — A craft non-alcoholic sparkling drink.
- Mode: light + vivid. Bg #F7F9FA. Accent: an electric lime #5BC23A + a bright grapefruit #F0533F secondary. Text #15201A.
- Display: Bricolage Grotesque 800 — bold, rounded, loud.
- Pitch: "All the ritual of a good drink. <em>None of the next morning.</em>"
- Product: cans of a craft sparkling drink — a "better soda" with real botanicals, a touch of fruit, low sugar. 5 flavors.
- Render: a slim 12oz can in 5 punchy flavor colors, with a condensation / fizz feel.
- Story: founders who wanted something to drink that wasn't water or alcohol; built a soda with 5g of sugar.
- Ingredients: a "what's in it / what's not" — real botanicals, 5g sugar, no alcohol vs. no syrups, no sweeteners you can't pronounce.
- Spotlight: the bestselling flavor.
- Ways to enjoy: over ice, as a mocktail mixer, the 4pm pick-me-up.
- FAQ: "Is it actually non-alcoholic?", "How much sugar is in it?", "What are the botanicals — is there caffeine?", "Is it sold by the case?", "Is the can recyclable?".

VARIANT 03: Bittersweet — A premium chocolate maker.
- Mode: dark + rich. Bg #16100D. Accent: gold #C99A4B + a deep cacao-red #7A2E22. Text #F1E8DD.
- Display: Cormorant Garamond 600 — a high-contrast, gallery-grade serif.
- Pitch: "Three ingredients. One origin. <em>Nothing to hide behind.</em>"
- Product: bean-to-bar chocolate — single-origin bars and a couple with inclusions (sea salt, hazelnut). 6 bars, each a different origin / percentage.
- Render: a chocolate bar in its wrapper — an elegant label with the origin, the % cacao, and a small map mark — in 6 origin colors.
- Story: a maker who sources cacao directly, a small-batch stone grind, no vanilla or lecithin to mask anything.
- Process: bean-to-bar — sourcing, roasting, a 3-day stone grind, tempering; tasting notes per origin.
- Spotlight: the flagship 70% single-origin, with taste notes.
- A gifting block — a tasting set of all 6 bars.
- FAQ: "What does single-origin mean here?", "Is it dairy-free / vegan?", "How should I store and taste it?", "Do you ship in summer — will it melt?", "Where does the cacao come from?".

VARIANT 04: Larder — A pantry-staples brand.
- Mode: cream + earthy. Bg #F1ECDF. Accent: olive green #6B7340 + a terracotta #C06A3E secondary. Text #221E14.
- Display: a confident grotesk with character — Inter Display 700, or a slab.
- Pitch: "The good stuff, <em>for the cooking you actually do.</em>"
- Product: everyday pantry staples done well — extra-virgin olive oil, a finishing oil, flaky salt, a couple of vinegars, a chili crisp. A small, tight range — 6 products.
- Render: a tin of olive oil + bottles + a jar — clear, utilitarian-but-warm labels; 6 products.
- Story: the founders were tired of olive oil that was old before it hit the shelf — a harvest date on every tin, single-estate.
- Sourcing: a single-estate harvest, a press date stamped on the tin, "a cooking oil and a finishing oil — know the difference."
- Spotlight: the everyday extra-virgin tin.
- Ways to use: a few simple pairings + a "starter pantry" bundle.
- FAQ: "What's the harvest date — how fresh is it?", "Cooking oil vs. finishing oil — which do I need?", "How do I store olive oil?", "Is the tin recyclable?", "Do you do a starter bundle?".

VARIANT 05: Crumb — A better-for-you snack brand.
- Mode: light + friendly. Bg #FBF8F1. Accent: a warm honey-gold #E9A12C + a berry #C8466E secondary. Text #1E1A14.
- Display: Bricolage Grotesque 700 — rounded, friendly, approachable.
- Pitch: "Snacks that read like a recipe, <em>not a chemistry set.</em>"
- Product: better-for-you snacks — seeded crackers, granola, and a fruit-and-nut bar. A few SKUs across 3 lines.
- Render: a snack bag / a box — bright, friendly labels — in flavor colors across the 3 lines.
- Story: a parent who started reading labels and didn't like the homework; made snacks from ingredients you'd have at home.
- Ingredients: a "you can pronounce all of it" angle — the short ingredient list shown literally; whole grains, real fruit, no seed-oil filler.
- Spotlight: the bestselling cracker.
- A "snack drawer" bundle / a lunchbox angle.
- FAQ: "What are the allergens?", "Is it nut-free / gluten-free?" (be specific per line), "How much sugar?", "Is it kid-friendly?", "Do you offer a multi-pack or a subscription?".

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 32 — Fashion & Apparel (5 pages, mixed editorial modes)

```
Brief: Produce 5 landing pages for FASHION & APPAREL labels — a minimalist luxury ready-to-wear house, a streetwear drop-culture brand, a heritage workwear-and-denim label, a sustainable slow-fashion basics brand, and a bold contemporary designer label. The Row / Totême / Aimé Leon Dore / Carhartt WIP / Everlane / a runway designer's site level. Heavy on lookbook imagery, a current collection / a seasonal drop, the brand's point of view, fabric + craftsmanship detail, stockists, and a "shop the collection" CTA. This is a fashion BRAND / a collection page — NOT a single-product DTC PDP (that's the E-commerce family).

SHARED AESTHETIC (all 5 variants):
- Display: per-variant — fashion swings from austere grotesk to high-contrast serif; let the type carry the brand's point of view.
- Body: Inter 400-500 (or an editorial serif per variant).
- IMAGE-FORWARD — large image placeholders ARE the design: full-bleed lookbook bands, a campaign image, a lookbook GRID (an editorial spread of mixed crops — a model shot, a flat-lay, a fabric close-up). Refined gradients + a thin frame; treat negative space generously.
- Minimal chrome: small type, wide letter-spacing on labels, lots of whitespace — the imagery leads.
- A lookbook grid: 6-9 tiles of mixed aspect ratios, a few captioned with a look number ("Look 04").
- Look / piece cards: an image, the piece name, the fabric, the price — restrained.
- A "stockists" / "available at" section — store wordmarks, a "find a store" feel.

SHARED SECTION SKELETON (all 5 follow this):
1. Nav: the wordmark (the brand name set as the logo) + 4 links (Collection/Shop, Lookbook, About, Stockists) + a slim "Shop" link. Minimal.
2. Hero: a full-bleed campaign image + the collection name / a season ("Autumn–Winter 2027") + a short line of intent + a "Shop the collection" CTA.
3. The collection: a grid of 6-10 looks / pieces — image, name, fabric, price.
4. Lookbook: an editorial spread — a mixed-crop grid of campaign imagery with look numbers and a season caption.
5. The point of view: 2-3 paragraphs — what the brand believes, who it's for, what it refuses to do; a restrained, confident voice.
6. Craft / fabric / make: a section on materials and construction — the mills, the fabrics, where it's made, the detail that matters; honest and specific.
7. A featured garment: one piece, large — an alternating image/copy row with the fabric story and the fit.
8. The campaign / a film: a wide image band — the season's campaign, with a photographer / creative-direction credit line.
9. Stockists / availability: store wordmarks + a "find us" line + the online-shop CTA; sizing / fit notes.
10. Journal / newsletter (where it fits): a short "journal" teaser or a signup ("first access to the next drop").
11. FAQ: 5 questions (sizing + fit, fabric care, shipping + returns, restocks / the next drop, made-where / ethics).
12. Final CTA: "Shop the collection" + a season line.
13. Footer: the wordmark + Shop / Lookbook / About / Help + a newsletter signup + © + a sizing-guide and care-guide link placeholder.

VISUAL FLOURISHES SPECIFIC TO FASHION:
- A lookbook grid — mixed-aspect tiles, a few with "Look 0X" captions.
- Full-bleed campaign image bands.
- Wide-tracked small-caps labels (FABRIC, ORIGIN, SEASON).
- Look / piece cards with the fabric + price set small and quiet.
- A drop / season pill ("AW27", or "Drop 04 · Friday 10am").
- A photographer / creative-direction credit line.

THE 5 VARIANTS — one text/html artifact per variant:

VARIANT 01: Drape — A minimalist luxury ready-to-wear house.
- Mode: cream + austere. Bg #EFEBE3. Accent: a near-black ink #1A1815 — a minimal accent; the imagery carries the page. Text #1A1815.
- Display: Cormorant Garamond 500, set quietly with generous tracking — quiet luxury.
- The brand: a small ready-to-wear house — considered tailoring, fluid drape, a tight seasonless wardrobe. AW27 is a small collection.
- Voice: restrained, almost austere — "we make fewer things, better, and we don't chase a season."
- Collection: ~8 pieces — a coat, trousers, a knit, a shirt — in a muted palette.
- Craft: Italian mills, full-canvas tailoring, a fabric-led approach.
- Featured garment: "the coat" — one piece, a long fabric story.
- FAQ: sizing / fit (it runs relaxed), fabric care (a lot of wool and silk), shipping + returns, "do you restock, or is it seasonless?" (seasonless), where it's made.

VARIANT 02: Bolt — A streetwear drop-culture brand.
- Mode: dark + electric. Bg #0C0C0E. Accent: a charged volt yellow #E8FF3A, used boldly. Text #F2F2F3.
- Display: Inter Display 900 — loud, big, tight (or a heavy condensed face).
- The brand: streetwear built on weekly drops — graphic tees, hoodies, caps, a cut-and-sew piece.
- Voice: energetic, in-the-know, community-driven — drops sell out, the calendar matters.
- Section twist: a prominent DROP section — "Drop 14 · Friday 10am ET" with a static countdown, a "set a reminder", and a past-drops archive grid; "join the list for early access."
- Collection: the current drop — 6-8 pieces, with "sold out" tags on some.
- Community: a Discord / a community of "X members"; the drop ritual.
- FAQ: "When's the next drop?", "Why does everything sell out?", "Do pieces restock?", "How does early access work?", "What's the return policy on a drop?".

VARIANT 03: Selvage — A heritage workwear-and-denim label.
- Mode: warm + utilitarian. Bg #EDE6D8. Accent: indigo #2E3C5C + a worn-leather tan #9A6B3E secondary. Text #211C14.
- Display: a sturdy slab or a workmanlike grotesk — characterful, honest.
- The brand: heritage workwear — selvedge denim, chore coats, work shirts, made to age well. Built to last, not to trend.
- Voice: plainspoken, durable, anti-disposable — "buy it once."
- Craft: a deep fabric section — selvedge denim on vintage shuttle looms, the weight (in oz), the loom, raw vs. washed, how the denim fades to the wearer; a lifetime repair / mending program.
- Collection: ~8 pieces — jeans (in a few weights), a chore coat, a work shirt, a tee.
- Featured garment: the signature jean — the fabric, the fit options, the fade.
- A "made to fade" angle + the repairs program.
- FAQ: "Raw vs. washed denim — which should I buy?", "How do I size raw denim — will it shrink?", "How do I care for and fade my jeans?", "Do you repair worn-in pieces?", "Where is it made?".

VARIANT 04: Flax — A sustainable slow-fashion basics brand.
- Mode: light + natural. Bg #F6F4ED. Accent: a soft sage #7C8A6A + a warm clay #C2785A secondary. Text #211F18.
- Display: a calm, soft grotesk — Inter Display 600 with generous spacing.
- The brand: slow-fashion essentials — tees, a knit, trousers, a dress — in natural fibers (organic cotton, linen, responsible wool); a small, permanent, season-light range.
- Voice: calm, transparent, anti-overconsumption — "a small wardrobe, made honestly."
- Craft / transparency: a real transparency section — the fiber, the mill, the factory, and a per-piece impact note (a "true cost" line or a CO₂e / water figure per piece); a take-back / resale program.
- Collection: ~8 timeless essentials in a natural palette.
- Featured garment: the everyday tee — the cotton, the fit, "made to last 5+ years."
- A care + repair + resale loop section.
- FAQ: "What fibers do you use, and why?", "How do you define 'sustainable'?", "How should I care for it to make it last?", "Do you take pieces back?", "Where and by whom is it made?".

VARIANT 05: Notch — A bold contemporary designer label.
- Mode: dark + high-contrast. Bg #101013. Accent: a sharp magenta-red #E5294B. Text #F4F3F4.
- Display: a dramatic display face — a high-contrast serif (Cormorant 600) or an editorial grotesk pushed huge — set very large, very tight.
- The brand: a contemporary designer label with a clear runway point of view — sharp tailoring, an asymmetric cut, a confident silhouette. AW27 is a real collection with a statement.
- Voice: bold, opinionated, art-directed — a designer with something to say.
- Section twist: a prominent CAMPAIGN / FILM band (a big art-directed image, a photographer + stylist credit), and "the collection" presented as numbered LOOKS (Look 01–12), like a runway lineup.
- Lookbook: a strong editorial spread — the show, the looks, the silhouette.
- The point of view: the designer's statement for the season.
- FAQ: sizing / fit (it's cut sharp — fit notes), fabric care, shipping + returns, "is the runway piece available, or made to order?", press / stockist enquiries.

Produce all 5 as separate text/html artifacts.
```

---

## Link-in-bio briefs (Prompts 33–37)

These 5 prompts produce **link-in-bio creator hubs** — single-screen pages with avatar + bio + vertical button stack — not marketing landings. They override the marketing-specific items in the Shared output constraints (no logo cloud, no pricing tiers, no FAQ, no testimonials, no bento grid). The per-prompt SECTION SKELETON below is the structural source of truth.

All 5 prompts map to the existing `creator` template family. Register each variant via:

```bash
npm run templates:add -- <file.html> --id=<slug> --name="<Creator name>" --family=creator --accent=<#hex> --mode=<dark|light|cream> --pitch="<one-line vibe>" --description="<sentence>" --status=published
```

---

## Prompt 33 — Streamer / Gaming Link Hub (5 dark-neon pages)

```
Brief: Produce 5 link-in-bio pages for streamers and gaming creators — the kind of single-page hub a Twitch / YouTube creator drops in their stream bio. Aesthetic: neon-soaked, CRT-inflected, kinetic. Each variant is ONE creator persona.

SHARED AESTHETIC (all 5 variants):
- Mode: dark. Background #08070C or #0D0716 with subtle radial fades.
- Display: Space Grotesk 600-700 OR Anton 400, tight letter-spacing -0.03em.
- Body: Inter 400-500.
- Mono: JetBrains Mono 500 — for live timestamps, viewer counts, version tags.
- One dominant neon accent per variant + a thin secondary accent for highlights.
- 32px dot-grid background at 4% opacity OR very faint scan-line overlay (alternating 1px horizontal lines at 2% opacity).
- "LIVE" indicator (when applicable): pulse-dot in the accent with a "LIVE · 2,484 watching" mono label.
- Lift-on-hover for link buttons (translateY -2px + accent ring fade in over 120ms).

SHARED SECTION SKELETON (link-in-bio format — mobile-first, vertical, centered):
- Max content width 480px on desktop, centered. On mobile (≤640px), full width with 20px horizontal padding. Vertical flow only.
1. Top status bar (12px tall): MONO uppercase eyebrow ("STREAMING NOW · DAY 47 OF SUMMER GAMES" or "OFFLINE · NEXT STREAM SAT 8PM PT") + dynamic timestamp. ONE row, the kinetic anchor.
2. Header block: avatar (96px circular, accent ring with pulse on LIVE variants) + creator name (display, 32px, accent gradient or solid) + handle (mono, fg-faint, "@persona · 412k followers") + 2-line bio (Inter 400, 14px, specific + opinionated — what they do, what they're playing, voice).
3. Featured content tile: 16:9 thumbnail card with play-icon overlay, title underneath (2 lines max), and a "WATCH ON YOUTUBE" / "VOD ON TWITCH" mono action. Shows latest VOD or upcoming match.
4. Link stack: 6-9 vertical link buttons. Each row: small leading icon (12-14px) + label (15px medium) + trailing chevron-right or external-arrow. Card background (slightly lighter than page), 1px accent border at 25% opacity, full-width, rounded-xl. Lift-on-hover.
5. Social row: 5-7 small (32px square, ghost button) icons in one horizontal row — Twitch, YouTube, Twitter/X, Discord, TikTok, GitHub, Steam, Bluesky as relevant. Pure inline SVG, no labels.
6. Footer microline (centered, 10px mono, fg-faint at 40% opacity): "© 2026 PERSONA · made with openlen". One row.

VISUAL FLOURISHES SPECIFIC TO STREAMER/GAMING:
- Pulse-dot animations for "LIVE" indicators.
- Optional: animated viewer-count flicker via CSS-only keyframes (last digit shifts every few seconds).
- Glitch-shift on accent text hover: brief horizontal split at ±2px for 80ms (CSS @keyframes).
- Heavy use of mono cells for stats: hours streamed, top game, current rank, ping, donation total.
- Neon glow on featured tile + primary CTAs — box-shadow: 0 0 24px accentRGB at 35% alpha.

THE 5 VARIANTS — produce one text/html artifact per variant in this conversation:

VARIANT 01: phasewalk — Speedrunner, Hollow Knight + Celeste specialist.
- Accent: acid-lime #C7F432. Secondary: hot-magenta #FF49C9 (rare highlight).
- LIVE status: "STREAMING NOW · ATTEMPT 1,847 OF ANY%" + ticking timer.
- Bio: "Speedrunning Hollow Knight Any% since 2022. 4:18 PB. Two-time GDQ. Coffee-fueled."
- Featured: "VOD · 4:18.04 — New Any% world record (commentary)". 318k views, 2 weeks ago.
- Link stack: Twitch · LIVE PB attempts, YouTube · 1.2M subs · WR explainers, Latest run · 4:18.04, Speedrun.com profile, Splits + setup (notion), Merch · phasewalk WR tee, Discord · 8,247 runners, Schedule · Tue/Thu/Sat 9PM PT.
- Social row: Twitch, YouTube, Twitter, Discord, Speedrun.com, GitHub.

VARIANT 02: ironscape.gg — Tactical FPS pro (Valorant/CS-style team IGL).
- Accent: deep-orange #FF5527. Secondary: cyan #00E5FF (sparingly).
- Status: "OFFLINE · NEXT MATCH SAT 18:00 CEST vs aviary".
- Bio: "Pro IGL for Solstice. EMEA Stage 2 champion. Building habits, watching demos, drinking yerba mate."
- Featured: "VOD · Grand Final vs aviary — 16-13, Lotus map review (45 min, English)".
- Link stack: Twitch · post-match VODs + scrims, YouTube · review series, Team Solstice (official), Tip / Donate (Stream Elements), Schedule · Tue/Wed/Fri 19:00 CEST, Sponsor · Logitech G PRO, Tracker.gg · KD 1.34 / ADR 168, Discord · 4,118 in scrim queue.
- Social row: Twitch, Twitter, Instagram, YouTube, Steam, Discord.

VARIANT 03: holler.studio — Art streamer / illustrator (long-form drawing).
- Accent: warm-coral #FF8463. Secondary: soft-teal #58E0C0.
- Status: "PAINTING NOW · STAGE 3 — INKING · 412 watching". Less rigid than gaming variants.
- Bio: "Illustrator. Stream long-form ink + watercolor commissions on Twitch. Slow + quiet + chatty. Working on a book."
- Featured: "WIP · The Cartographer (commission) — 4hr stream, midway through inks".
- Link stack: Twitch · live drawing M/W/F, Instagram · finished pieces, Commissions OPEN · queue 3/8, Print shop · new this week, The book · launch 2027, Subscriber Discord, Process timelapses · YouTube, Patreon · early access + brushes.
- Social row: Twitch, Instagram, YouTube, Patreon, Twitter, Bluesky.

VARIANT 04: oldworldco — Retro / arcade gaming creator (CRT + chiptune nights).
- Accent: candy-cyan #2EFFD5. Secondary: vivid yellow #FFD400.
- Heavy scan-line overlay. Pixel-art accents OK. Optional CRT vignette via radial-gradient.
- Status: "OFFLINE · NEXT STREAM SAT 9PM — A-RANK MEGA MAN X".
- Bio: "Retro gamer, arcade hunter, CRT enthusiast. Grinding A-rank Mega Man X. 600+ NES titles in archive."
- Featured: "PILGRIMAGE — every Konami arcade cabinet in Akihabara, 2025 trip recap". Cinematic thumbnail.
- Link stack: Twitch · weekend retro nights, YouTube · 320k subs · arcade docs, Cabinet collection · 47 machines, Mega Drive / Saturn JP archive (cart list), Discord · 6,200 retro heads, Streaming rig + CRT setup (notes), Merch · Phosphor shirt drop.
- Social row: Twitch, YouTube, Twitter, Discord, Bluesky.

VARIANT 05: lumen.vtuber — VTuber variety streamer with original character.
- Accent: lavender-pink #C77BFF. Secondary: pale-aqua #B5F3F3.
- Softer, more playful. Gradient mesh background OK instead of dot-grid. Avatar is a stylized cute creature (inline SVG, NOT generic anime).
- Status: "DEBUTED 3 MONTHS AGO · 184 streams · 1.4k watching".
- Bio: "Variety streamer. Cozy games, horror nights (Tuesdays), karaoke (Sundays). Character by holler.studio. ENG / 日本語."
- Featured: "ENDURANCE: Outer Wilds, full game in one stream (8h21m)".
- Link stack: Twitch · LIVE most days 6PM PT, YouTube · clips + karaoke archive, Throne wishlist · prop budget, Schedule (Google Cal), Discord · 3,127 members, Twitter · daily art / shitposts, Merch · plush + sticker pack, Character art by @holler.studio.
- Social row: Twitch, YouTube, Twitter, TikTok, Discord, Throne.

Produce all 5 as separate text/html artifacts. Each should feel like a real person — specific, opinionated, alive.
```

---

## Prompt 34 — Musician / Producer Link Hub (5 dark-warm pages)

```
Brief: Produce 5 link-in-bio pages for musicians and producers — the link a band, DJ, or producer drops in Instagram bio + Spotify "about". Aesthetic: dark + warm, album-cover energy, music-first. Each variant is ONE artist persona with a clear genre point of view.

SHARED AESTHETIC (all 5 variants):
- Mode: dark warm. Backgrounds in deep burgundy / navy / charcoal-with-warmth — NOT cold pure black. Examples: #14080B, #0F0E1A, #1A1310.
- Display: a dramatic display face — Fraunces (semi-italic OK) or Cormorant Garamond — set large, tight leading. Some variants use a sans (Inter, Anton) per persona below.
- Body: Inter 400-500.
- Mono: Geist Mono 500 — for catalog numbers, BPM, runtime.
- Each variant has ONE warm-toned accent + cream/off-white text. NO neon. Think record-sleeve color theory.
- Subtle grain overlay on background (CSS gradient noise or repeating dot pattern at 1% opacity).
- Lift-on-hover for link buttons.

SHARED SECTION SKELETON (mobile-first, vertical, centered, max 480px desktop):
1. Eyebrow: MONO uppercase, single line — catalog number / release date / tour status ("CAT NO. WRL-014 · OUT FEB 28" or "EU TOUR · 2026 SPRING").
2. Header block: square album art (96-128px, rounded-md, slight shadow) for solo / band photo OR custom inline-SVG mark for producers + artist name (display, 36-44px) + handle (@artist) + 2-line bio (specific genre, scene, what they're working on right now).
3. Featured release tile: large album art (square, full-width-of-container, ~440px) + tracklist preview (3-5 tracks with runtimes in mono) + a row of streaming badges (Spotify, Apple Music, Bandcamp, SoundCloud, Tidal). Tracklist is just text — DO NOT mock a player UI.
4. Link stack: 6-10 vertical buttons. Examples: "Listen on Spotify · 184k monthly", "Bandcamp · digital + vinyl", "Latest mix · Boiler Room set", "Tour dates · 14 shows", "Merch · new shirt drop", "Mailing list · early access", "Press kit · download", "Sync licensing · contact".
5. Tour / shows strip (when applicable): 4-6 upcoming dates as a mono table — date · city · venue · status (SOLD OUT / TICKETS / FEW LEFT). Use real-feeling cities + venue names.
6. Social row: 5-7 small icons — Spotify, Apple Music, Bandcamp, SoundCloud, Instagram, YouTube, TikTok, Twitter.
7. Footer microline: catalog number + management contact ("BOOKING — agency@example") OR distributor line. One row, mono, fg-faint.

VISUAL FLOURISHES SPECIFIC TO MUSICIAN:
- Tracklist rendered in mono with hairline rules between tracks. Runtime right-aligned, tabular-nums.
- Pulse-dot for "NOW PLAYING" or "TOUR ON SALE" indicators.
- Subtle glow on the featured album art — box-shadow with the accent at low alpha.
- For DJ / electronic variants: a horizontal BPM / key strip is OK ("128 BPM · F minor").

THE 5 VARIANTS — produce one text/html artifact per variant:

VARIANT 01: lantern hollow — Gothic-folk band (4-piece, indie label).
- Accent: amber #E0A156. Bg #14080B (deep burgundy-black). Display: Fraunces 600 italic.
- Eyebrow: "WRL-014 · LP OUT 28 FEB · PRE-ORDER OPEN".
- Bio: "Four people, two guitars, harmonium, slow drums. Recorded in a cabin north of Halifax. New record February."
- Featured: "WAYFARE / SECOND HOUSE — LP, 9 tracks, 41:08". Stream + pre-order vinyl badges.
- Link stack: Pre-order LP (signed + clear vinyl), Listen on Spotify · 84k monthly, Bandcamp · pay-what-you-want demos, Tour 2026 · 11 shows, Mailing list · early demos, Press kit, Booking (US/EU), Merch · cabin tee.
- Tour: 11 dates Halifax → Boston → NYC → London → Amsterdam → Berlin (mix of "SOLD OUT" + "TICKETS" + "FEW LEFT").

VARIANT 02: matterhorn dj — Minimal techno DJ + label head.
- Accent: cold-cream #F4ECD7. Bg #0E0E12. Display: Inter 700, very tight tracking.
- Eyebrow: "MTH-022 · NEW 12" · 19 MARCH".
- Bio: "DJ + label head, Matterhorn Records. Berlin / Tokyo. Minimal, deep, slow. Sets recorded in one take, no decks software."
- Featured: "MTH022 — Halverson — 'NORTH FACE' EP, 4 tracks, 32:14" (with BPM/key per track).
- Link stack: Boiler Room set · Berlin Atonal, Resident Advisor profile, Bandcamp · label catalog, Soundcloud · 184k followers, Booking (worldwide), Matterhorn Records, Press · DJ Mag interview, Spotify · monthly mix.
- Tour: 6 dates Berlin → Tokyo → Tbilisi → Amsterdam, mostly SOLD OUT.

VARIANT 03: kid mireille — Modern soul / R&B artist (solo, women-of-color voice).
- Accent: rose-gold #D89B7C. Bg #1A1310 (warm chocolate). Display: Fraunces 500.
- Eyebrow: "DEBUT EP · 'MEDIAN' · STREAMING EVERYWHERE".
- Bio: "Singer, songwriter, sometimes producer. Brooklyn via Lyon. Soul that takes its time. Debut EP 'Median' out now."
- Featured: "MEDIAN — EP, 6 tracks, 24:08". All streaming badges.
- Link stack: Listen on Spotify · 412k monthly, Apple Music · editorial feature, Bandcamp · digital, Cover series on YouTube · 1.4M views, Instagram · process clips, Tour US 2026 · 12 dates, Press · NPR Tiny Desk, Mailing list · early demos.
- Tour: 12 dates US east coast → Chicago → LA → Vancouver.

VARIANT 04: tape diary — Lo-fi / jazz producer (solo bedroom producer).
- Accent: pale-mustard #C9B47A. Bg #100D0A. Display: Crimson Pro 500.
- Eyebrow: "TD-007 · TAPE OUT NOW · CASSETTE + DIGITAL".
- Bio: "Lo-fi jazz, beats, late-night warm. Cassette label, instrument-of-the-week series. New tape every full moon."
- Featured: "TD007 — 'LATE BLUE' — 11 tracks, 38:42, recorded on a 4-track in Aug 2025".
- Link stack: Bandcamp · all tapes, Spotify · monthly listeners 92k, YouTube · 'instrument-of-the-week' series, Sample pack · free download, Mailing list · new tape alerts, Patreon · stems + sample chains, Merch · cassette + tote, Discord · 1,824 producers.

VARIANT 05: anton kvass — Contemporary classical composer (post-minimal).
- Accent: deep-ink #5B7C99 (cold but warm-toned). Bg #0F1014 (warm graphite). Display: Cormorant 500.
- Eyebrow: "PREMIERE · NOV 2026 · BARBICAN, LONDON".
- Bio: "Composer. Quartets, sextets, occasional larger works. Recorded by Quatuor Béla. Studied at the Conservatoire de Paris."
- Featured: "STRING QUARTET No. 3 — premiered by Quatuor Béla, Lyon, March 2026 (32:14)" with a play-on-Spotify badge.
- Link stack: Listen on Spotify, Apple Classical · curated, Score · purchase + perusal, Commissions · open through agent, Upcoming premieres · 4 in 2026, Press · Gramophone review, Booking (agent), Mailing list · score releases.
- Tour: 4 upcoming premieres — Barbican London, Concertgebouw Amsterdam, Suntory Hall Tokyo, Walt Disney Concert Hall LA.

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 35 — Visual Artist / Photographer Link Hub (5 cream + light pages)

```
Brief: Produce 5 link-in-bio pages for visual artists, photographers, and illustrators — the link an artist shares in gallery bios + Instagram. Aesthetic: gallery whitespace, image-forward, quiet, refined. NO neon, NO bento, NO dark mode here. Each variant is ONE artist persona with a clear medium + practice.

SHARED AESTHETIC (all 5 variants):
- Mode: cream OR light (not pure white — softer paper tones: #F6F2EA, #F0EDE6, #FCFAF5).
- Display: a refined serif — Fraunces 400-500 (some italic) OR Crimson Pro 400 OR Source Serif 4 400. Large, generous leading.
- Body: Inter 400-500 OR Crimson Pro 400 for some.
- Mono: JetBrains Mono 500, rarely used — only for catalog numbers, year ranges, gallery codes.
- One subtle accent per variant — usually a tonal hue (sage, terracotta, slate) NOT vivid. Most contrast comes from typography + image.
- Hairline borders rgba(0,0,0,0.08).
- NO dot-grids, NO scan-lines, NO glow effects. Use whitespace as the structural device.

SHARED SECTION SKELETON (mobile-first, vertical, centered, max 480px desktop):
1. Eyebrow: small mono OR small caps serif — single line. ("WORKS · 2018–2026" or "REPRESENTED BY GAGOSIAN" or "SELECTED · 2024 SHORTLIST, PRIX PICTET").
2. Header block: large square portrait or signature artwork (128-160px) — round OR square, NO ring. Artist name (display serif, 36-48px, possibly italic) + practice line (a quiet one-liner: "Photographer, Brooklyn"). 2-3 line bio (specific medium, where they work, current project — written in artist-statement voice, not marketing voice).
3. Featured work tile: a single large image placeholder (gradient div as image, 4:5 or 1:1) + caption underneath in italics + small mono catalog line ("PL-2024-018 · gelatin silver print · ed. 7"). NO play button, NO CTA — it's just the work.
4. Link stack: 5-8 vertical buttons, but quieter than other prompts. Hairline borders not filled cards. No icons OR very small (10px) line-only icons. Examples: "Portfolio / works", "Print store", "CV (PDF)", "Studio visits · by appointment", "Gallery representation", "Available works · contact", "Workshops · spring '26", "Press / interviews".
5. Recent + upcoming (optional, when relevant): a 4-line vertical list in italics — "Selected · 2024 Aperture Portfolio Prize / Group show · MoMA PS1 · Mar 2026 / Solo · Gallery TBD · Oct 2026 / Book · second monograph, fall 2027".
6. Social row: 3-5 small icons — Instagram, Bluesky, Are.na, Substack, Vimeo. Subtle, line-only.
7. Footer microline: studio location + gallery contact OR copyright with edition info. Italic, fg-faint.

VISUAL FLOURISHES SPECIFIC TO VISUAL ARTIST:
- Italics used purposefully — for captions, gallery names, dates.
- Hairline rules between sections (1px, rgba(0,0,0,0.08), 60-80% width centered).
- ONE accent flourish max — e.g., a small drop-cap on the bio, or italic accent text in a single button label.
- Image placeholders are subtle bg-gradient-to-br in muted tones, never bright.
- Numbering: artworks numbered in mono ("01 / 12", "PL-2024-018").

THE 5 VARIANTS — produce one text/html artifact per variant:

VARIANT 01: clara mendes — Documentary photographer (long-form, B&W, social-realist).
- Accent: warm-slate #6B6157. Bg #F4F0E8. Display: Fraunces 400 italic.
- Eyebrow: "WORKS · 2016–2026 · SÃO PAULO + LISBON".
- Bio: "Photographer. Long-form documentary, gelatin silver. Eight years on a single project about Brazilian agrarian workers."
- Featured: "PL-2024-018 — Aurora, Mato Grosso (gelatin silver, ed. 7, framed 60×80cm)". Caption in italic.
- Link stack: Portfolio · the agrarian project, Print store · editioned silver prints, CV (PDF), Galeria Vermelho · São Paulo, Galeria Pedro Cera · Lisbon, Press · Aperture interview, Studio visits · by appointment, Mailing list · new prints.
- Recent + upcoming: "2024 Aperture Portfolio Prize finalist / Solo · Galeria Vermelho · Sept 2026 / Monograph · Mack, Spring 2027 / Workshop · Arles, July 2026".

VARIANT 02: yuki abe — Fashion illustrator (editorial, monograph-style, Tokyo).
- Accent: terracotta #B5694F. Bg #FBF6EE. Display: Crimson Pro 400.
- Eyebrow: "ILLUSTRATION · EDITORIAL + COMMISSIONS".
- Bio: "Illustrator working between Tokyo and Paris. Editorial work for Vogue Japan, The New York Times Style, Aesop."
- Featured: "VOGUE JAPAN · Autumn issue 2025 — six-page editorial, ink on washi". Italic caption.
- Link stack: Selected works · 2018–present, Editorial clients · Vogue / NYT / Aesop, Available prints · limited series, Commissions OPEN · queue 4/6, Process · Instagram, Workshop · Paris Mar 2026, Agent · Bryan Wolff Studio, Mailing list.
- Social: Instagram, Are.na, Vimeo (timelapses), Substack.

VARIANT 03: marian holst — Ceramic artist (vessels, slow practice, rural studio).
- Accent: sage #8FA28A. Bg #F0EDE6. Display: Source Serif 4 400.
- Eyebrow: "STUDIO · KENT · 2010–PRESENT".
- Bio: "Ceramicist. Hand-built vessels from local clay, wood-fired. Two firings a year. Pieces go fast — small batch, no overstock."
- Featured: "GROUP 14 — eleven vessels, autumn 2025 firing, ash glaze on local stoneware".
- Link stack: Works · current available, Studio visits · spring + autumn open studios, Galleries · stocked at 3 spaces, Workshops · 6-week wheel intensive, Commissions · waitlist 2027, Press · Crafts Magazine, Mailing list · firing announcements.
- Social: Instagram, Substack (the firing log).

VARIANT 04: nikolai vetrov — Fine-art painter (oil, large-scale, quiet abstraction).
- Accent: ink-blue #4A5C7A. Bg #F6F2EA. Display: Cormorant 500.
- Eyebrow: "STUDIO · BROOKLYN · REPRESENTED BY VARDIK".
- Bio: "Painter. Large-format oil on linen, abstract. Working on a 30-canvas cycle, two years in."
- Featured: "FIELD 22 — oil on linen, 200×280cm, 2025 (the cycle 'Slow Light')".
- Link stack: Selected works · 2014–2026, Vardik Gallery · Brooklyn, Studio visits · by appointment, Available works · contact gallery, Press · Artforum review, Monograph · Hatje Cantz 2024, CV (PDF), Mailing list · openings.
- Recent + upcoming: "Solo · Vardik · March 2026 / Group · Aspen Art Museum · Summer 2026 / Monograph · revised edition 2027 / Residency · Civitella Ranieri · Sept 2026".

VARIANT 05: aria delph — Graphic designer (identity, indie publications, type-led).
- Accent: aubergine #5D3F5B. Bg #FCFAF5. Display: Fraunces 500.
- Eyebrow: "STUDIO · TYPE + IDENTITY · 2019–PRESENT".
- Bio: "Independent designer. Identity, publication design, occasional type. Selected clients: A24, MIT Media Lab, NTS Radio."
- Featured: "NTS RADIO · 10-year rebrand, identity system (2024–25)". Italic caption.
- Link stack: Selected work · 2019–present, Available for project work, Studio · solo + 2 collaborators, Recognition · ADC + D&AD, Type · two faces in progress, Workshop · Werkplaats Sept 2026, Newsletter · monthly + occasional, Contact.
- Social: Instagram, Are.na, Read (Substack).

Produce all 5 as separate text/html artifacts.
```

---

## Prompt 36 — Premium Membership Creator Link Hub (5 dark-rose pages)

```
Brief: Produce 5 link-in-bio pages for premium membership creators — the link a lifestyle, fitness, travel, dance, or paid-content creator shares to drive subscribers to their gated platforms. Aesthetic: luxe, intimate, sophisticated. NOT tacky. Treated as a premium lifestyle brand. Rose-gold + deep burgundy on near-black. Each variant is ONE creator persona with a clear membership offer.

SHARED AESTHETIC (all 5 variants):
- Mode: dark + rich. Backgrounds in deep burgundy / aubergine / near-black-with-warmth — NOT cold black. Examples: #120A0E, #14070C, #1A0F12.
- Display: an elegant serif — Cormorant Garamond 500 italic OR Fraunces 500. Large, slightly tracked.
- Body: Inter 400-500 — generous leading.
- Mono: JetBrains Mono 500 — rare, used for tier labels and member counts.
- Each variant has a rose-gold / champagne / muted-pink accent. Cream off-white text. Soft glows.
- Subtle radial gradient at the top + bottom of the page (accent at 6% alpha, fading to transparent).
- Lift-on-hover for link buttons with a soft accent glow.

SHARED SECTION SKELETON (mobile-first, vertical, centered, max 480px desktop):
1. Eyebrow: MONO uppercase, single line — member count or tier ("4,182 MEMBERS · 3 TIERS" or "PRIVATE COMMUNITY · INVITE-FRIENDLY").
2. Header block: avatar (96-128px, soft accent ring, slightly blurred backlight glow) OR a tasteful blurred-edge portrait. Creator name (display serif italic, 32-40px) + handle (@persona) + 2-line bio (intimate, voice-driven, specific about what they offer — NOT generic "lifestyle creator").
3. Featured offer tile: the main paid offer — a large card with the tier name (display, 24px) + 1-line value prop + 3-4 bullet inclusions (small mono check rows) + member count + a primary CTA button ("Join · $12/month"). Soft accent glow.
4. Link stack: 6-9 vertical buttons. Lead with the paid platforms (Patreon / OnlyFans / Substack / Fanhouse / Fansly equivalents — pick the relevant ones per persona) then the free funnel (Instagram, TikTok, YouTube). Examples: "Premium · monthly · $12", "Annual · $96 · 2 months free", "VIP tier · waitlist", "Latest post · members only", "Instagram · daily", "YouTube · weekly".
5. Social proof microbar (optional): 3 inline stats in mono — members · countries · years online. Italic.
6. Social row: 5-7 small icons — Instagram, TikTok, YouTube, Twitter, Telegram, Discord, Substack as relevant. Refined, line-only.
7. Footer microline: business contact + management line + age-verification note when relevant ("18+ · for press: agent@example"). One row, mono, fg-faint.

VISUAL FLOURISHES SPECIFIC TO PREMIUM MEMBERSHIP:
- Soft accent glow on the featured tile + primary CTAs.
- Italic display headings give an intimate, editorial register.
- Subtle gradient mesh background (multiple radial-gradients layered at low alpha) gives depth.
- NO emoji, NO crass language, NO "subscribe for exclusive content!!!" tone. Voice is poised + adult.
- The featured-offer card uses a 1px hairline accent border at 30% alpha + a faint inner glow.
- Member counts in tabular-nums mono.

THE 5 VARIANTS — produce one text/html artifact per variant:

VARIANT 01: maren — Lifestyle creator (daily vlogs + members-only weekly letters + Q&A).
- Accent: rose-gold #D89B7C. Bg #14070C.
- Eyebrow: "8,412 MEMBERS · WEEKLY LETTER + Q&A".
- Bio: "Brooklyn. Writing about the practice of being a woman in her thirties. Daily on Instagram, depth on Substack."
- Featured: "Substack — paid, $8/month — weekly letter + monthly Q&A + members-only Discord (3,847 members)".
- Link stack: Substack · paid · $8/month, Annual · $84 · 2 months free, Latest letter · 'On waiting', Free posts · weekly preview, Instagram · daily, YouTube · long-form interviews, Discord · members only.

VARIANT 02: lev k — Fitness coach (premium 8-week programs + form review).
- Accent: champagne #C9A87C. Bg #100808.
- Eyebrow: "412 ATHLETES · 3 PROGRAMS · WAITLIST OPEN".
- Bio: "Strength coach. Pull-from-the-floor programming for intermediate lifters. Eight-week blocks, video form review."
- Featured: "FOUNDATIONS — 8-week intermediate program, $148, video form review included. Next cohort: Mar 9."
- Link stack: Foundations · $148, Advanced · $228 (waitlist), Form review only · $48/review, Free Sample week (email), YouTube · technique series, Instagram · daily, Newsletter · weekly, Press · Outside Magazine.

VARIANT 03: theo wren — Travel creator (paid trip guides + members-only itineraries).
- Accent: amber-gold #D4A658. Bg #14100A.
- Eyebrow: "2,184 MEMBERS · 27 GUIDES · 11 COUNTRIES".
- Bio: "Slow travel. Detailed city guides for people who skip the highlights. Member-only itineraries with everything I actually used."
- Featured: "Membership — $12/month — full guide library + monthly new city + 1:1 trip help (2,184 members)".
- Link stack: Membership · $12/month, Annual · $108 · 2 months free, Latest guide · Naples 7-day, Free preview · Lisbon excerpt, Instagram · daily, YouTube · trip recaps, Substack archive, Press · Condé Nast.

VARIANT 04: noor lev — Dance + movement artist (online masterclasses + private studio).
- Accent: dusty-rose #C18B92. Bg #160A0E.
- Eyebrow: "1,847 STUDENTS · 4 MASTERCLASSES · INTENSIVE FEB".
- Bio: "Contemporary dance artist. Trained Batsheva. Teach online masterclasses + a 6-week intensive twice a year. Currently choreographing for Berlin Festival."
- Featured: "INTENSIVE — 6 weeks, 12 sessions live + recorded, $448. Next cohort starts Feb 28 (28 spots left of 80)."
- Link stack: Intensive · Feb 28 · $448, Masterclass library · $18 each, Annual all-access · $228, Free intro class (email), Instagram · daily practice, YouTube · class recordings, Performances 2026 · 4 shows, Press · The Stage.

VARIANT 05: priya rose — Premium content creator (Patreon / OnlyFans-equivalent style, treated with restraint).
- Accent: deep-rose #B26B7E. Bg #160810.
- Eyebrow: "PREMIUM · 3 TIERS · 18+".
- Bio: "Writer, model, host of the podcast 'The Long Hour'. Premium tiers for the people who want closer access. London."
- Featured: "Premium tier — $14/month — weekly intimate writing + voice notes + monthly video letters. The Long Hour podcast included."
- Link stack: Premium · $14/month, VIP · $48/month · waitlist, The Long Hour podcast · free, Instagram · daily, TikTok · clips, Newsletter · free, Press kit, Business contact · agency.
- Footer: "18+ · all content posted on premium platforms. For press: agent@example."

Produce all 5 as separate text/html artifacts. Voice is poised, intimate, adult — NOT crass.
```

---

## Prompt 37 — Indie Maker / Builder-in-Public Link Hub (5 cream + mono pages)

```
Brief: Produce 5 link-in-bio pages for indie makers, SaaS founders, and builders-in-public — the link an indie hacker drops in their Twitter / X bio + GitHub README. Aesthetic: warm cream paper + heavy monospace, terminal-warm hybrid. Specific, factual, ego-light. Each variant is ONE builder persona with multiple shipped projects + writing.

SHARED AESTHETIC (all 5 variants):
- Mode: cream (warm paper) for 4 variants, ONE dark-terminal variant for variety. Cream bg examples: #F6F2E8, #FBF6EC, #F0EBE0. Dark variant: #0A0907 with cream text.
- Display: Inter 600-700 with tight tracking -0.025em — modern, builder voice. NOT serif (this isn't editorial — it's a working maker).
- Body: Inter 400-500.
- Mono: JetBrains Mono OR Geist Mono 500 — heavy use, for project metadata, tiny labels, sparkline annotations, commit-style entries.
- One muted accent per variant — usually a single warm hue (warm-coral, terracotta, bronze, indigo, forest). Restraint over neon.
- Subtle dot-grid at 24px, 3% opacity, in the accent OR neutral.
- Lift-on-hover for link buttons.

SHARED SECTION SKELETON (mobile-first, vertical, centered, max 480px desktop):
1. Eyebrow: MONO uppercase, single line — current focus or shipping status ("SHIPPING · OPENLEN V1 · WK 18" or "INDIE · 4 PROJECTS LIVE · $4,128 MRR").
2. Header block: small square mark (64px, rounded-md — either a wordmark OR a stylized initial) + name (Inter 600, 28-32px) + handle (@maker) + 2-line bio (specific: what they build, where they ship, current focus). Voice is matter-of-fact, no hype.
3. "Now shipping" tile: the headline current project. A card with project name + 1-line pitch + 3-4 mono stats (MRR, users, version, stage) + small inline sparkline (commits over the last 30 days, computed in inline JS at render — accent stroke, 1.5px). Single CTA: "Visit" or "Try it".
4. Link stack: 6-10 vertical buttons. Lead with shipped projects, then writing, then community. Examples: "openlen.com · landing-page builder · $1,400 MRR", "Newsletter · 2,184 readers · monthly", "Twitter · daily build logs", "GitHub · 142 repos · 4.8k stars", "Mailing list · ship updates".
5. Shipped strip: a 4-6 line mono table — "PROJECT — STATUS — REVENUE — STARTED" rows. Examples: "openlen — LIVE — $1.4k MRR — Mar 2026", "captureflow — PAUSED — $214 MRR — Oct 2025", "graphd — SOLD — $14k exit — 2024".
6. Social row: 5-7 small icons — Twitter/X, GitHub, Bluesky, LinkedIn, Substack, YouTube, RSS. Line-only.
7. Footer microline: location + open-to ("Lima, PE · open to: consulting, advisory, angels"). One row, mono, fg-faint.

VISUAL FLOURISHES SPECIFIC TO INDIE MAKER:
- Inline sparkline SVG generated from a JS data array at end of body — accent stroke + cream fill. ~24 points over 30 days.
- Mono tables with hairline rules, tabular-nums.
- "$X MRR" / "$X ARR" / "X users" badges in mono, restrained.
- Optional: a tiny "committed 14h ago" mono cell next to the GitHub link.
- NO testimonial cards, NO pricing tiers, NO hero gradients with glow. The vibe is plain, well-typeset, factual.

THE 5 VARIANTS — produce one text/html artifact per variant:

VARIANT 01: jose @ openlen — SaaS founder shipping in public (the user's persona — make this one feel like the user could literally use it).
- Accent: warm-coral #FF5527. Bg #FBF6EC. Mode: cream.
- Eyebrow: "SHIPPING · OPENLEN V1 · WK 18 · LIMA → SELF-HOST".
- Bio: "Solo. Building openlen — a landing-page builder that publishes to a real subdomain. Hetzner-hosted, no Vercel."
- Now shipping: "openlen.com — landing-page builder with AI generation + visual editing. v1 in 6 weeks. Currently 12 alpha users." Stats: $0 MRR · 12 users · v0.4 · alpha. Sparkline: 30 days of commits.
- Link stack: openlen.com · try it (alpha invite), Newsletter · monthly build log · 184 readers, Twitter · daily ship log, GitHub · 84 repos · 1.2k stars, Mailing list · v1 launch, Past projects · 3 shipped, Consulting · 1 day/week open.
- Shipped: "openlen — ALPHA — $0 — May 2026 / inariwatch — LIVE — $84 MRR — Jan 2026 / [past project] — SUNSET — $0 — 2023".
- Footer: "Lima, PE · open to: angel intros + design feedback".

VARIANT 02: marie b — Indie hacker, 4 small SaaS products, lifestyle business.
- Accent: terracotta #B5694F. Bg #F6F2E8. Mode: cream.
- Eyebrow: "INDIE · 4 PROJECTS LIVE · $6,428 MRR · BCN".
- Bio: "Indie maker. Small SaaS that solve specific problems. Solo, no funding, no employees, no pivots. Barcelona."
- Now shipping: "scriptface.com — desktop screen recorder with AI captions. Mac-only, $14/mo, 312 users." Stats: $4,368 MRR · 312 users · v2.1.
- Link stack: scriptface.com · main, kanrai.app · invoice generator · $1,184 MRR, ticktock.tools · meeting-cost timer · $612 MRR, draft.review · grammar API · $264 MRR, Twitter · build logs, Newsletter · 4,128 readers, RSS · blog feed.
- Shipped: "scriptface — LIVE — $4.4k MRR — 2024 / kanrai — LIVE — $1.2k MRR — 2023 / ticktock — LIVE — $612 MRR — 2022 / draft — LIVE — $264 MRR — 2025".
- Footer: "Barcelona, ES · open to: API customers + reseller deals".

VARIANT 03: avery k — ML / AI engineer (research + tools + open source).
- Accent: indigo #5E6AD2. Bg #0A0907. Mode: dark-terminal (the dark variant of this prompt).
- Eyebrow: "RESEARCH · LLM EVAL · GRAPHQL FUZZER · SF".
- Bio: "ML engineer. Open-source eval harnesses, weird agent experiments, occasional papers. Was at Anthropic / now independent."
- Now shipping: "evalkit — open-source LLM eval harness with side-by-side judge mode. 4.2k stars in 8 weeks." Stats: 4,218 stars · v0.7 · 32 contrib · MIT. Sparkline of GitHub stars over 30 days.
- Link stack: evalkit (GitHub) · 4.2k stars, gqfuzz · GraphQL fuzzer · 1.8k stars, Substack · 'Weekly Eval' · 8,247 readers, Twitter · daily research, Talks · 6 in 2026, Papers · NeurIPS '25, Office hours · Fridays, Consulting · 2 days/week.
- Shipped: "evalkit — LIVE — 4.2k stars — Apr 2026 / gqfuzz — LIVE — 1.8k stars — 2025 / promptd — ARCHIVED — 412 stars — 2023".

VARIANT 04: dion park — Designer-developer (case-study heavy, working sites + writing).
- Accent: bronze #A4794A. Bg #F0EBE0. Mode: cream.
- Eyebrow: "DESIGNER + DEV · 11 LIVE SITES · TORONTO".
- Bio: "I design + build websites for people who care about typography. Eleven sites live this year. Available for selected projects in Q3 2026."
- Now shipping: "verre — typography studio site for a Montreal foundry. Shipped March 2026." Stats: ship date · 14 weeks · 4 collaborators.
- Link stack: Work · 11 case studies, Available for projects · Q3 2026, Writing · 14 essays on design + craft, Newsletter · 2,184 readers, Side projects · 3 tools, Twitter · process clips, Are.na · references, Talks · 4 in 2026.
- Shipped: "verre — LIVE — Mar 2026 / cantine — LIVE — Jan 2026 / lyriq — LIVE — Nov 2025 / brulé — LIVE — Sep 2025".

VARIANT 05: kit ren — Creator-engineer (newsletter + open source + small apps).
- Accent: forest #4F7A52. Bg #F6F2E8. Mode: cream.
- Eyebrow: "NEWSLETTER · 12,408 READERS · OPEN SOURCE · BERLIN".
- Bio: "Write a weekly newsletter on small software, ship open-source tools when I find a problem worth solving. Currently working on a book."
- Now shipping: "minus.tools — a hand-curated set of 24 small Mac apps under $14. Updated monthly." Stats: 24 apps · 12 reviewed/mo · v3.
- Link stack: Newsletter · weekly · 12,408 readers, minus.tools · curated apps, jot · CLI scratchpad (GitHub · 8.4k stars), kindle-export · 412 stars, The book · 'small software' · spring 2027, Twitter · weekly digest, RSS, Sponsor · Carbon Ads (open).
- Shipped: "minus.tools — LIVE — 24 apps — 2024 / jot — LIVE — 8.4k stars — 2023 / kindle-export — LIVE — 412 stars — 2025 / [the book] — DRAFT — 84% — 2024".

Produce all 5 as separate text/html artifacts. Voice is matter-of-fact, factual, builder-quiet — no hype, no growth-hack language, real numbers.
```

---

## Prompt 38 — Booking & Appointments (6 pages, mostly light + warm + cream modes)

```
Brief: Produce 6 landing pages in the "Bookable" aesthetic — premium service-business sites with an integrated booking feel, the kind a salon, clinic, coach, or studio actually wants. Think Squire's barbershop pages, the Mindbody/Boulevard "book the chair" flow, NexHealth dental, Calendly's discovery-call clarity, and a Glossier-clean med-spa. These are real brick-and-mortar (or 1:1) service businesses, NOT SaaS — the entire page exists to get a stranger to pick a time. The signature element is a BOOKING WIDGET in the hero: a mini month calendar with a chosen day, a column of time-slot pills (some greyed "booked"), a selected service + price summary, and a "Confirm booking" button — looks real, fully non-functional. The CTA everywhere is "Book appointment," never "Buy" or "Sign up."

SHARED AESTHETIC (all 6 variants):
- Mode: mostly light / warm / cream — calm, trustworthy, premium-local; one dark-warm variant (the barbershop). Per-variant fonts: a confident serif (Fraunces, Source Serif 4, Cormorant) for the grooming/spa/pilates feel OR a clean sans (Inter Display, Geist) for the dental/coaching feel · Body: Inter 400-500, line-height 1.55-1.6 · Mono: Geist Mono 400 — ONLY for times, durations, prices, hours, and license numbers (tabular-nums) · letter-spacing: tight display (-0.02em) on headlines · borders: hairline 1px on the calendar grid, slot pills, hours table · background texture: a faint warm grain or a barely-there dotted grid; calendar/widget on a raised card with a soft shadow · signature motion: the selected day + selected time-slot pill animate to the accent on load; a pulse-dot on the "live availability" indicator.
- Generous rounded cards (14-18px radius), soft shadows. The booking widget reappears as a sticky CTA on scroll. A trust row near the hero (★ 4.9 · Google reviews · years in business · "Walk-ins welcome" or "By appointment").

SHARED SECTION SKELETON (all 6 follow this order):
1. Sticky nav: wordmark + links (Services, Pricing, Team / About, Reviews) + a prominent accent "Book appointment" CTA pill.
2. Hero: pill badge (business type + neighborhood), display headline (with the half-tone trick), sub ~22 words, dual CTA ("Book appointment" + "Call · Directions"), a trust line ("★ 4.9 · 312 reviews · open 6 days"), and the SIGNATURE MOCKUP — the booking widget (mini month calendar with one selected day, a time-slot pill column with 2-3 greyed "booked", a chosen service + price summary line, "Confirm booking" button).
3. Services + prices: a list/grid of services with durations (mono) + prices (mono) — real-feeling.
4. How it works: 3 steps — Pick a time → Get a reminder (text/email) → Show up — with mono step labels.
5. Team / practitioners: cards with a gradient/SVG avatar, name, role, specialty, and a "Book with <name>" link.
6. Gallery / before-after: gradient-div placeholders in a tasteful grid (work, the space, results).
7. Reviews: 4-6 five-star cards with real-sounding local names + neighborhoods + a Google-style aggregate ("4.9 · 312 reviews") and the Google "G" mark.
8. Location + hours: address block, an hours table (mono), parking/transit, and an inline-SVG stylized neighborhood map (streets + a pin — NOT an external map image).
9. FAQ: 5 questions a real buyer/patient/client asks (deposits, cancellation window, insurance, walk-ins, first-visit prep).
10. Final CTA band: "Book now" + the widget echoed or a "next available" line.
11. Footer: business name + address + phone + hours + booking-app mention + Instagram + (where relevant) license #.

VISUAL FLOURISHES SPECIFIC TO BOOKING & APPOINTMENTS (use across the 6 as appropriate):
- The hero booking widget: mini month grid (7 cols, ~5 rows), one day ringed in the accent; a vertical stack of time-slot pills with 2-3 greyed/struck "booked" and one selected; a service+price summary row; a "Confirm booking" button. A tiny inline script may set the SVG calendar-cell positions or the map path d= — no framework JS.
- A "next available" line with a pulse-dot ("Next opening: today 3:30pm").
- "X spots left this week" / "booking 2 weeks out" urgency pill.
- Time-slot pills in mono, the booked ones at 40% opacity with a strike.
- A duration+price chip on every service row (mono, tabular-nums).
- The inline-SVG neighborhood map: a few street lines, a block or two, and an accent map-pin marking the location.
- A reminder/confirmation toast mockup ("✓ Booked — Tue, Jun 9 · 3:30pm. Reminder sent.").

THE 6 VARIANTS — produce one text/html artifact per variant:

VARIANT 01: Fade & Co — A modern barbershop + grooming lounge.
- Mode: dark-warm. Bg #16130D. Accent: amber #E8A33D. Text #F4EDE0.
- Display font: Inter Display 800 (tight) with a small caps wordmark; Geist Mono for times/prices.
- Logo: an inline-SVG straight-razor crossed with a comb forming an "F," or a single amber barber-pole stripe wrapping the "&".
- Pitch: "A cut worth the chair." Half-tone: "A cut worth <muted>the chair</muted>."
- Audience: guys who want a precise, repeatable fade and a hot-towel finish — not a $12 chop-shop.
- Hero mockup: month calendar with Thu Jun 11 selected; slot pills 10:00 (booked), 10:45 (booked), 11:30 (selected), 12:15, 1:00; service summary "Skin fade + beard · 45 min · $66 · with Marcus"; "Confirm booking."
- Sections specifics: Services — Signature cut $38 · 30 min, Skin fade $42 · 35 min, Beard trim & line-up $28 · 20 min, Cut + beard combo $66 · 45 min, Hot-towel shave $40 · 30 min, Kids' cut (under 12) $26 · 25 min, Gray-blending $20 add-on, Buzz $24 · 15 min. "Next available: today 3:30pm" pulse-dot. Team — Marcus (owner, scissor work), Deon (fades + designs), Theo (beards + shaves), Ray (classic cuts).
- FAQ Q's: "Do you take walk-ins or is it appointment-only?", "Is there a deposit, and what's your no-show policy?", "Can I book the same barber every time?", "Do you do beard designs and hairline edge-ups?", "How early should I show up for my first visit?".
- Social proof names: Andre Whitfield (Bushwick), Sam Okafor, Luis Reyes, Marcus's regulars wall, "Cuts & Co Supply," Trell B., Devon M.

VARIANT 02: Northbrook Dental — A family dentistry + orthodontics practice.
- Mode: light, calm + trustworthy. Bg #FFFFFF. Accent: teal #14B8A6. Text #102A2A.
- Display font: Inter Display 700; Source Serif 4 500 for the "gentle, family" warmth lines.
- Logo: an inline-SVG rounded tooth with a single teal leaf/check, or a soft arch over "ND."
- Pitch: "Dental care your whole family can relax into." Half-tone: "Dental care your whole family can <muted>relax into</muted>."
- Audience: parents booking the family, plus adults wanting Invisalign — anxious-dentist-avoiders included.
- Hero mockup: month calendar with Tue Jun 9 selected; slots 8:00, 9:00 (booked), 10:30 (selected), 1:00, 2:30 (booked), 4:00; summary "New-patient exam + cleaning · 60 min · $0 with most insurance · Dr. Patel"; "Confirm booking." A small "Accepting new patients" pulse-dot.
- Sections specifics: Services — New-patient exam + X-rays + cleaning (covered by most insurance), Routine cleaning $130, Whitening $349, Invisalign from $3,900 (free consult), Crowns, Implants (free consult), Emergency same-day visit, Kids' first-visit. "How it works" reframed: Book online → Text reminder → We verify your insurance before you arrive. Team — Dr. Aisha Patel DDS (general), Dr. Ryan Cole DMD (ortho), Maria the hygienist, a kids-friendly note.
- FAQ Q's: "Do you take my insurance, and what's covered on a first visit?", "I haven't been to a dentist in years — will I be judged?", "Do you see kids, and at what age should they start?", "What's the cost of Invisalign and do you offer payment plans?", "Can you see me today for a toothache?".
- Social proof names: The Alvarez family, Jenna R. (Northbrook), Pawel K., Dana Whitfield, Marcus & Lily (siblings), "★ 4.9 · 312 reviews."

VARIANT 03: Mantel — A boutique reformer-pilates studio.
- Mode: cream, serene. Bg #F6F0E6. Accent: terracotta #C56A4E. Text #2A2017.
- Display font: Cormorant 600 (high-contrast serif) for headlines; Geist Mono for class times.
- Logo: an inline-SVG single reformer-spring coil curling into an "M," or a clean lowercase serif "mantel" with a hairline underline.
- Pitch: "Strength, slowly. Then suddenly." Half-tone: "Strength, slowly. <muted>Then suddenly.</muted>"
- Audience: people who tried mat pilates on an app and want the real reformer, in small classes, with form correction.
- Hero mockup: month calendar with Wed Jun 10 selected; class-slot pills 6:00am (booked), 7:15am (selected), 9:00am, 12:00pm (booked), 5:30pm, 6:45pm; summary "Reformer Flow · 50 min · 6 spots · with Sofia"; "Reserve your spot." "4 spots left · Wed 7:15am" pulse-dot.
- Sections specifics: Classes/pricing — Single class $34, 5-class pack $155, 10-class pack $290, Unlimited monthly $239 (Most popular), Intro offer "First reformer class $19." Class types — Reformer Flow, Slow & Strong, Jumpboard cardio, Prenatal reformer, Foundations (first-timers). A weekly grid hint: ~6 classes/day, max 8 reformers. Team — Sofia (founder, classical + contemporary), Priya, Elena, with mono certs "Balanced Body · 500hr."
- FAQ Q's: "I've never used a reformer — is there a beginner class?", "What's your class-cancellation window before you charge me?", "How many people are in a class?", "Do I need grip socks, and do you sell them?", "Can I freeze my unlimited membership?".
- Social proof names: Clara Bennett, Noor H., Yuki T., Megan (Riverside), "joined 1,180 members," Anaïs L., a 4.9 Google aggregate.

VARIANT 04: Reid Advisory — 1:1 executive + business coaching (book a discovery call).
- Mode: light, premium-restrained. Bg #FBFAF8. Accent: deep indigo #2D4A7C. Text #14181F.
- Display font: Source Serif 4 600 for gravitas; Inter for body; Geist Mono for the call slots + timezone.
- Logo: an inline-SVG monogram "RA" in a thin ruled box, or a single ascending plotted line through "Reid."
- Pitch: "Clarity, on the calendar." Half-tone: "Clarity, <muted>on the calendar.</muted>"
- Audience: founders and senior leaders booking a paid 1:1 engagement — the hero books a free 30-min discovery call.
- Hero mockup: a Calendly-style booking — month calendar with Mon Jun 8 selected; slots in a timezone line "(GMT-5)" 9:00 (booked), 11:00 (selected), 2:00, 3:30 (booked), 4:30; summary "Discovery call · 30 min · free · video"; "Confirm time." A "Replies within 1 business day" line.
- Sections specifics: Services/pricing — Free discovery call (30 min), 1:1 monthly coaching $1,200/mo (2 sessions), Intensive day "Strategy Day" $2,400, Founder sprint (6 weeks) $4,800, Team offsite facilitation (quoted). "How it works" reframed: Book a discovery call → We map your goals → Choose a coaching cadence. About/credentials instead of a team grid — 18 years operating + advising, ICF-PCC cert (mono), ex-COO note, client logos marquee.
- FAQ Q's: "What happens on the free discovery call — is it a sales pitch?", "How are sessions delivered and how long is the commitment?", "What's your reschedule/cancellation policy for a paid session?", "Do you work with early-stage founders or only execs?", "Is anything we discuss confidential?".
- Social proof names: a logo marquee — "Mileu," "Northwind Labs," "Carta-style fintech," plus named quotes: Dana Osei (VP Product), Tomás R. (founder), Helena Brandt (COO).

VARIANT 05: Bramble & Paw — Pet grooming + daycare.
- Mode: warm light, friendly. Bg #FCF8F0. Accent: sage #6B8E5A. Text #20271C.
- Display font: Fraunces 600 (a touch playful); Geist Mono for slot times/prices.
- Logo: an inline-SVG paw-print where one toe-bean is a sage leaf, or a rounded "B&P" with a tiny dog-ear.
- Pitch: "A spa day for the good boy." Half-tone: "A spa day for <muted>the good boy.</muted>"
- Audience: dog (and some cat) owners booking a groom, plus parents of daycare regulars — friendly, reassuring, not clinical.
- Hero mockup: month calendar with Fri Jun 12 selected; drop-off slot pills 8:00 (booked), 9:00 (selected), 10:00, 11:00 (booked), 1:00; summary "Full groom · medium dog · ~2.5 hrs · $78 · with Tasha"; "Book drop-off." A "3 grooming slots left this week" pulse-dot.
- Sections specifics: Services/pricing by size — Bath & brush (sm $42 / md $54 / lg $68), Full groom (sm $62 / md $78 / lg $96), Nail trim $18, Teeth-brushing add-on $12, De-shed treatment $25, Daycare full day $40 / half day $26 / 10-day pass $340, Puppy intro day $20. Team — Tasha (master groomer, doodles + double-coats), Marco (cats + small breeds), the daycare crew. Gallery = before/after fluff grid.
- FAQ Q's: "Does my dog need vaccinations to come, and which ones?", "How long does a full groom take — do I leave them or wait?", "What's your policy if my dog is anxious or reactive?", "Do you do daycare and grooming the same day?", "What's the cancellation/no-show fee for a grooming slot?".
- Social proof names: "Bailey's mom" Erin K., the Castillos (& Mochi), Greg + Waffles, Priya N. (& two cats), "★ 4.9 · 268 reviews," Hannah & Biscuit.

VARIANT 06: Lumen Aesthetics — A med-spa / skin + aesthetics clinic.
- Mode: light-luxe. Bg #FDFBF8. Accent: rose-gold #C9A36B. Text #1C1814.
- Display font: Cormorant 600 (elegant) for headlines; Inter for body; Geist Mono for treatment durations/prices.
- Logo: an inline-SVG thin rose-gold ring with a soft inner glow around an "L," or a serif "LUMEN" with a hairline gold rule.
- Pitch: "Skin that looks like rest." Half-tone: "Skin that looks <muted>like rest.</muted>"
- Audience: people booking facials, injectables, and laser — wants discretion, licensed providers, and clear consult-first messaging.
- Hero mockup: month calendar with Thu Jun 11 selected; slots 10:00 (booked), 11:30 (selected), 1:00, 2:30, 4:00 (booked); summary "Signature HydraGlow facial · 60 min · $185 · with Dr. Lane, RN"; "Book consultation." A "Complimentary consult before any injectable" line + pulse-dot.
- Sections specifics: Services/pricing — HydraGlow facial $185 · 60 min, Chemical peel $160 · 45 min, Microneedling $290 · 75 min, Botox $13/unit (free consult), Dermal filler from $650/syringe, Laser hair removal from $120/session, IPL photofacial $325, Lip flip $120. "How it works": Book a consult → Custom plan from a licensed provider → Treatment + aftercare. Team — Dr. Elise Lane RN (medical director, mono "RN · 12 yrs"), Camille (master esthetician), Dr. Kwan (oversight).
- FAQ Q's: "Do I need a consultation before injectables or laser?", "Is there downtime after microneedling or a peel?", "Who actually performs the treatment — a nurse or an esthetician?", "What's your deposit and cancellation policy for booked appointments?", "Are results guaranteed, and how many sessions will I need?".
- Social proof names: Brooke A., Naomi S. (Eastside), Valentina R., "★ 4.9 · 207 reviews," Priscilla M., Jordan T., a discreet "as seen in" local-press strip.

Produce all 6 as separate text/html artifacts.
```

Registration table (one row per variant — run `templates:add`):

```
fade-and-co        | family=local-services | mode=dark  | accent=#E8A33D | pitch="A cut worth the chair." | description="Modern barbershop and grooming lounge — book a barber, see slot availability, and lock in your fade and beard combo online."
northbrook-dental  | family=health-tech    | mode=light | accent=#14B8A6 | pitch="Dental care your whole family can relax into." | description="Family dentistry and orthodontics with online booking, insurance-checked first visits, and Invisalign consults."
mantel-pilates     | family=wellness       | mode=cream | accent=#C56A4E | pitch="Strength, slowly. Then suddenly." | description="Boutique reformer-pilates studio with small classes, live spot availability, and a first-class intro offer."
reid-advisory      | family=local-services | mode=light | accent=#2D4A7C | pitch="Clarity, on the calendar." | description="1:1 executive and business coaching — book a free discovery call and choose a coaching cadence."
bramble-and-paw    | family=local-services | mode=light | accent=#6B8E5A | pitch="A spa day for the good boy." | description="Pet grooming and dog daycare with size-based pricing, drop-off booking, and before-after results."
lumen-aesthetics   | family=health-tech    | mode=light | accent=#C9A36B | pitch="Skin that looks like rest." | description="Med-spa and aesthetics clinic — book facials, injectables, and laser with licensed providers, consult-first."
```

---

## Prompt 39 — Newsletter & Publication (6 pages, mixed: 2 dark · 3 light/cream · 1 cream+mono)

```
Brief: Produce 6 landing pages in the "Subscribe-First Publication" aesthetic — premium-editorial subscribe pages for independent newsletters, with the conversion intent of Substack/Ghost/Beehiiv but the typographic taste of a printed quarterly. References: the quiet authority of Stratechery's subscribe page, the cream newspaper grade of The Browser, and Ghost's clean members-first templates — every variant's job is to make a reader type their email in the hero.

SHARED AESTHETIC (all 6 variants):
- Mode: 2 dark · 3 light/cream · 1 cream-with-mono (per-variant accent below) · Display + Body + (per-variant) a mono or serif accent named from Google Fonts · tight display tracking -0.02em to -0.03em · hairline rules at currentColor opacity 0.10-0.14 · paper/dot-grid or faint vertical-rule "column" texture on hero only · signature motion = the subscribe button settles into a "✓ Subscribed — check your inbox" confirmation state on submit (one tiny inline script toggling a class; NO real network call), plus a slow opacity pulse on the live "joined this week" dot.

SHARED SECTION SKELETON (all 6 follow this order):
1. Sticky nav: wordmark + links (Archive · About · Sponsor [optional]) + a high-contrast "Subscribe" CTA pill.
2. Hero: editorial eyebrow + display headline + 1-line dek + the SIGNATURE MOCKUP = a prominent subscribe form (email input + button) with a subscriber-count + cadence line directly under it ("Join 11,204 readers · every Tuesday, 6am ET") + a small "read by people at <3-5 wordmarks>" row.
3. "What you'll get" — 3-4 value props, each tied to a NAMED recurring section of the letter (not generic "quality content").
4. Sample issue preview: one styled excerpt card that reads like a real issue — issue number + date + title + a serif pull-quote + a figure/chart placeholder (inline SVG) + read-time + "Read the full issue →".
5. Archive grid: 6-8 past-issue cards (issue №/date · title · 1-line dek · read-time), titles specific enough to sound real.
6. Author / masthead: bio card with an inline-SVG avatar monogram, name, one-line credentials, and a 2-line "why I write this" note.
7. Social proof: 2-3 subscriber quote cards + a metric strip (open rate · subscribers · issues shipped · avg read-time) in tabular-nums.
8. Pricing: a Free tier and ONE Paid tier (real price) — Paid card lists exactly what it unlocks (full archive · subscriber-only deep dives · community/threads).
9. FAQ: 5 questions a real subscriber actually asks.
10. Final subscribe CTA: restated headline + the email form again + the count/cadence line.
11. Footer: wordmark + Archive/About/Privacy + "Powered by [platform]" microline + an unsubscribe-anytime reassurance line.

VISUAL FLOURISHES SPECIFIC TO NEWSLETTER (use across the 6 as appropriate):
- The subscribe form is the hero — oversize it: large input (h≈56px), bold button, the count+cadence line styled as a single quiet caption underneath; the button flips to a "✓ Subscribed" state on click (inline script, class toggle only).
- A "fresh off the press" issue card with a faint left ruled margin and an issue-number tab (e.g. "№ 142") in the corner.
- Chart/figure placeholders drawn as inline SVG appropriate to the letter: a benchmark bar set, a price line, a type-specimen block, a recipe step-diagram, a strength-progression line, an MRR sparkline — set d=/heights via one tiny inline script from a data array.
- Open-rate / subscriber / issues-shipped metric strip in tabular-nums with hairline column rules.
- "Read by people at" marquee or static row of 4-6 plausible wordmarks.
- A subtle accent-colored "ribbon" or №-tab on the paid tier ("Reader-supported").

THE 6 VARIANTS — produce one text/html artifact per variant:

VARIANT 01: Signal Theory — sharp AI/tech analysis: essays plus original benchmarks.
- Mode: dark editorial. Accent: electric violet #7C5CFC. Bg #0B0A12, text #ECE9F5. Display: Söhne-like via Inter Tight 600 / Body: Inter 400 / Mono: IBM Plex Mono 500 (benchmark tables, issue numbers).
- Logo: inline SVG — a thin violet sine wave crossing a hairline baseline, "ST" monogram set in the trough.
- Pitch: "The benchmark behind the hype." Half-tone: "The benchmark <muted>behind the hype</muted>."
- Audience: ML engineers, founders, and analysts who want measured takes, not threads.
- Hero mockup: subscribe form over a faint violet column-grid; under it "Join 18,402 readers · every Wednesday, 7am ET · read by people at Anthropic · Ramp · Modal · Hugging Face". Beside the form, a small benchmark card: "GPT-class latency p50 — 4 models, bars at 312/418/506/611 ms" drawn as inline-SVG bars.
- Sections specifics: "What you'll get" = The Benchmark (one original eval per month), The Margin (footnotes + corrections), Signal vs Noise (one chart, one claim). Sample issue: "№ 142 · The agent eval everyone's quoting is measuring the wrong thing." Pricing: Free (essays + the weekly note) / Pro $12/mo or $120/yr (full benchmark datasets · model-card deep dives · the private analyst thread).
- FAQ Q's: "Free vs Pro — what's actually paywalled?" · "How often do you send, and will you sell my email?" · "Can I expense this through work?" · "Do you publish your benchmark methodology?" · "Refunds if I don't find it useful?"
- Social proof names: Modal, Ramp, Hugging Face, Vercel, Linear, Replicate, Baseten, Cohere.

VARIANT 02: The Ledger — markets, macro, and money, once a week.
- Mode: cream / newspaper-grade. Accent: gold #B08D2E. Bg #F6F1E6, text #1B1813, rule lines warm. Display: Libre Caslon Display 600 (masthead serif) / Body: Source Serif 4 400 / Mono: JetBrains Mono 500 (tickers, dates).
- Logo: inline SVG — an engraved-style "TL" inside a thin ruled rectangle with a tiny rule below, like a newspaper nameplate.
- Pitch: "Money, explained like you're smart." Half-tone: "Money, explained <muted>like you're smart</muted>."
- Audience: operators, founders, and curious professionals who want macro without the doom or the jargon.
- Hero mockup: a nameplate masthead ("THE LEDGER · EST. 2023 · ISSUE № 168") above the subscribe form; cadence line "Join 31,890 readers · every Sunday, 8am ET · read at Stripe · Brex · Mercury · a16z". A small price-line SVG: "10-yr yield, 12 weeks — line from 3.9% → 4.6%" with a gold stroke.
- Sections specifics: "What you'll get" = The Open (the week in one paragraph), The Chart (one figure, explained), Position (what it means for your money — not advice). Sample issue: "№ 168 · The carry trade nobody's pricing in." Pricing: Free (Sunday open + one chart) / Paid $9/mo or $90/yr (full Sunday letter · the midweek macro note · the archive of 168 issues · charts as CSV).
- FAQ Q's: "Is this financial advice?" (no — clear disclaimer) · "Free vs paid — what do I miss on free?" · "Cadence — really just Sundays?" · "Can my employer expense it?" · "Will you ever sell or rent my email?"
- Social proof names: Stripe, Brex, Mercury, a16z, Carta, Ramp, Bloomberg desk readers, Sequoia.

VARIANT 03: Off-Grid — a weekly letter on design, type, and the craft of making things.
- Mode: light, type-forward. Accent: red #E5484D. Bg #FBFAF8, text #16140F. Display: Fraunces 72pt 500 (display optical) / Body: Inter 400 / Mono: Space Mono 500 (issue tabs, captions).
- Logo: inline SVG — a bold lowercase "o" with a single red baseline-grid line struck through it, like a type-specimen mark.
- Pitch: "A weekly look at things made well." Half-tone: "A weekly look at <muted>things made well</muted>."
- Audience: designers, typographers, and makers who care about the seams.
- Hero mockup: subscribe form on a faint baseline-grid; under it "Join 9,640 readers · every Thursday, 9am · read by designers at Figma · Pentagram · Frank Collective". Beside it a type-specimen block: a huge red Fraunces "Ag" with metric lines (cap-height, x-height, baseline) labeled in mono.
- Sections specifics: "What you'll get" = The Specimen (one typeface, examined), Found Objects (5 things worth your eye), The Margin Note (one craft principle). Sample issue: "№ 87 · Why grotesks feel honest and humanists feel kind." Pricing: Free (the Thursday letter) / Supporter $7/mo or $70/yr (the full specimen archive · downloadable grid templates · the readers' show-and-tell thread).
- FAQ Q's: "What do I get on free vs Supporter?" · "How often, and what time zone?" · "Can I expense a Supporter membership?" · "Do you sell or share my email — ever?" · "Can I cancel and keep what I downloaded?"
- Social proof names: Figma, Pentagram, Frank Collective, Monotype, Readymag, It's Nice That, Klim Type, Cosmos.

VARIANT 04: Mise — a chef's weekly letter on recipes and technique.
- Mode: warm cream. Accent: olive #6E7B2E. Bg #F4EFE3, text #1E1B12, warm rules. Display: Cormorant Garamond 600 (elegant kitchen serif) / Body: Inter 400 / Mono: IBM Plex Mono 500 (timings, quantities).
- Logo: inline SVG — a single olive chef's knife rendered as a clean line mark over the word "mise" in small caps.
- Pitch: "Cook like you mean it." Half-tone: "Cook like you <muted>mean it</muted>."
- Audience: home cooks who already own a good knife and want technique, not 40-ingredient gimmicks.
- Hero mockup: subscribe form on warm paper; under it "Join 14,206 readers · every Friday, 4pm — in time for the weekend · read in kitchens at Bon Appétit · Eleven Madison alumni · Serious Eats". Beside it a recipe step-diagram: a 4-node SVG flow ("brine 2h → sear 90s/side → rest 8m → slice") with olive connectors and mono timings.
- Sections specifics: "What you'll get" = The Recipe (one dish, tested 6 ways), The Technique (the one move that fixes it), Pantry Note (an ingredient, demystified). Sample issue: "№ 96 · The 8-minute confit that makes any white fish taste expensive." Pricing: Free (the Friday recipe) / Table $8/mo or $80/yr (the full tested-recipe archive · printable cards · the subscriber cook-along thread + monthly Q&A).
- FAQ Q's: "What's free vs on the Table plan?" · "How often do recipes land, and when?" · "Can I expense this if I cook for work?" · "Are recipes printable / saveable?" · "Do you sell my email to brands?"
- Social proof names: Bon Appétit, Serious Eats, Eleven Madison alumni, Food52, Smitten Kitchen readers, Kenji's notes, Ottolenghi test kitchen, Caraway.

VARIANT 05: Baseline — evidence-based strength and health coaching, in your inbox.
- Mode: light, energetic. Accent: lime #65A30D. Bg #FCFCFA, text #14160C. Display: Archivo 700 (athletic grotesk) / Body: Inter 400 / Mono: Space Grotesk 500 (set/rep notation, dates).
- Logo: inline SVG — a lime ascending bar-step mark (3 rising bars) beside "BASELINE" in tight caps.
- Pitch: "Get strong on the evidence, not the hype." Half-tone: "Get strong on the evidence, <muted>not the hype</muted>."
- Audience: intermediate lifters and busy professionals tired of fitness-influencer noise.
- Hero mockup: subscribe form on clean white; under it "Join 22,118 readers · every Monday, 6am · read by coaches at Whoop · Eight Sleep · Renaissance Periodization". Beside it a strength-progression line SVG: "estimated 1RM, 16 weeks — 84kg → 112kg" with lime stroke + a dashed deload week marked in mono.
- Sections specifics: "What you'll get" = The Study (one paper, translated to your gym) , The Program Note (a tweak you can use Monday), Ask the Coach (one reader question, answered). Sample issue: "№ 131 · Junk volume is real — here's where your sets stop counting." Pricing: Free (the Monday letter) / Coached $10/mo or $96/yr (full periodized programs as PDFs · video form-check reviews · the lifters' Q&A thread).
- FAQ Q's: "Is this medical or training advice?" (clear disclaimer) · "Free vs Coached — what's behind the paywall?" · "How often, and can I deload the emails too?" · "Can I expense Coached through a wellness stipend?" · "Do you ever sell my email or health info?"
- Social proof names: Whoop, Eight Sleep, Renaissance Periodization, StrongLifts readers, Barbell Medicine, Stronger by Science, Fitbod, Hevy.

VARIANT 06: Workbench — an indie maker's build-in-public log: revenue, shipping, lessons.
- Mode: cream + mono. Accent: orange #F97316. Bg #F7F3EA, text #161310, dot-grid texture. Display: Inter Tight 600 (-0.03em) / Body: Inter 400 / Mono: JetBrains Mono 500 (heavy — MRR, dates, commit-style entries).
- Logo: inline SVG — an orange bracket-and-bolt "[w]" mark, terminal-flavored.
- Pitch: "Building it in public, numbers and all." Half-tone: "Building it in public, <muted>numbers and all</muted>."
- Audience: indie hackers, solo founders, and builders who learn from real revenue, not launch tweets.
- Hero mockup: subscribe form on dot-grid cream; under it "Join 11,204 readers · every Tuesday, 6am ET · read by makers at Resend · Beehiiv · Plausible". Beside it an MRR sparkline SVG: "MRR, last 90 days — $0 → $4,128" with orange stroke + tabular-nums "$4,128 MRR · 312 users · v2.1" mono caption.
- Sections specifics: "What you'll get" = The Numbers (MRR, churn, the real dashboard), Shipped (what went out + what broke), The Lesson (one mistake, so you skip it). Sample issue: "№ 54 · I cut my pricing page from 3 tiers to 1 and revenue went up." Pricing: Free (the Tuesday log) / Builder $9/mo or $90/yr (the full metrics archive as CSV · teardown deep-dives · the makers' private thread + monthly office hours).
- FAQ Q's: "Free vs Builder — what's gated?" · "How often, and do you actually share real numbers?" · "Can I expense Builder as a business cost?" · "Will you sell my email to sponsors?" · "Cancel anytime — do I keep the archive I paid for?"
- Social proof names: Resend, Beehiiv, Plausible, Tinybird, Posthog, Render, Polar, Lemon Squeezy.

Produce all 6 as separate text/html artifacts. Voice per masthead: V01 measured-analytical, V02 dry newspaper authority, V03 type-nerd intimate, V04 confident kitchen-warm, V05 no-bullshit coach, V06 plain builder-honest with real numbers.
```

Registration table (run `templates:add` once per row):

```
signal-theory  | family=editorial      | mode=dark  | accent=#7C5CFC | pitch="The benchmark behind the hype."           | description="Subscribe page for a dark-editorial AI/tech analysis newsletter — original benchmarks, model-card deep dives, and a paid analyst thread."
the-ledger     | family=editorial      | mode=cream | accent=#B08D2E | pitch="Money, explained like you're smart."      | description="Newspaper-grade cream subscribe page for a weekly markets-and-macro letter with a serif nameplate masthead and paid archive."
off-grid-type  | family=editorial      | mode=light | accent=#E5484D | pitch="A weekly look at things made well."        | description="Type-forward light subscribe page for a weekly design-and-typography letter with a specimen block and supporter tier."
mise-letter    | family=food-beverage  | mode=cream | accent=#6E7B2E | pitch="Cook like you mean it."                   | description="Warm-cream subscribe page for a chef's weekly recipe-and-technique newsletter with a step-diagram and tested-recipe archive."
baseline-strength | family=creator     | mode=light | accent=#65A30D | pitch="Get strong on the evidence, not the hype." | description="Energetic light subscribe page for an evidence-based strength-and-health coaching letter with a 1RM progression chart and coached tier."
workbench-log  | family=creator        | mode=cream | accent=#F97316 | pitch="Building it in public, numbers and all."  | description="Cream-and-mono subscribe page for an indie-maker build-in-public log — MRR sparkline, shipped/broke notes, and a paid metrics archive."
```

---

## After claude.ai produces the HTML(s)

Save each artifact as `.html` locally. To get one published as a landing page on your subdomain, paste the HTML content here in Claude Code chat — I'll create a project + tell you the URL to open in `/new-v2` and hit Deploy.

Once we validate the loop works for one page, we can batch the rest (e.g., a script that takes a folder of `.html` files and creates a project per file).
