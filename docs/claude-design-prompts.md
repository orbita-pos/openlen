# 30 landing pages via 6 prompts — claude.ai design briefs

Six prompts to paste into claude.ai (Opus 4.7) under your Max 20x subscription. Each prompt produces **5 distinct, production-quality landing pages** as separate `text/html` artifacts in a single conversation. Total: **30 landing pages** across 6 aesthetic families.

## How to use

For each prompt below:

1. Open claude.ai → New chat → Opus 4.7
2. Paste the **Shared output constraints** block (immediately below). One paste per conversation.
3. Paste **one of the six prompts**. claude.ai produces 5 artifacts.
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

## After claude.ai produces the HTML(s)

Save each artifact as `.html` locally. To get one published as a landing page on your subdomain, paste the HTML content here in Claude Code chat — I'll create a project + tell you the URL to open in `/new-v2` and hit Deploy.

Once we validate the loop works for one page, we can batch the rest (e.g., a script that takes a folder of `.html` files and creates a project per file).
