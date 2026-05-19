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

VARIANT 03: Hearth — Vacation rental marketplace for design-conscious travelers.
- Mode: warm cream. Bg #FAF5EC. Accent: warm terracotta #C66B3D. Text #1F1B16.
- Display font: Source Serif 4 weight 500.
- Pitch: "Vacation rentals we'd <em>actually stay in</em>."
- Audience: design-conscious travelers (couples + small families) frustrated by Airbnb's mediocre stock, willing to pay $300-$1,500/night for curated stays.
- Hero mockup: large 16:9 photo placeholder of a coastal cabin interior (warm-toned gradient) + small overlay "Bookable June 14-21 · 2 BR · Mendocino, CA · $480/night".
- Featured stays: 9 property cards organized by location tags ("Mendocino coast", "Catskills retreat", "Joshua Tree desert", "Hudson Valley farmhouse").
- Centerpiece: "How we curate" — 3-step explanation (we visit every property, we screen the hosts, we update photography ourselves) + 3 photo placeholders.
- Stats: Properties curated (1,408 across 47 destinations), Avg stay length (4.2 nights), Returning guests in 2025 (42%), Editorial team (12 in-house curators).
- Customer story: "Hana & Yuki · stayed at a Catskills A-frame in October · 'Hearth has spoiled us — we can't go back to Airbnb.'"
- Pricing: 12% commission on bookings (vs Airbnb 14-18%). Hosts keep more, guests pay no service fees beyond cleaning.
- FAQ Q's: "What's the application process for hosts — can I list my place?", "What's your cancellation policy?", "Does Hearth offer insurance for hosts?", "How does pricing compare to Airbnb for similar stays?", "Do you support stays longer than 30 days?".

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

VARIANT 05: Vellum — A leather notebook.
- Mode: warm dark + cream details. Bg #14110D. Accent: cream #F4EEDC. Text #F4EEDC.
- Display font: Newsreader serif 500.
- Product: "Vellum — A leather-bound A5 notebook. <em>Refillable, 240 pages</em>. $94."
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

## After claude.ai produces the HTML(s)

Save each artifact as `.html` locally. To get one published as a landing page on your subdomain, paste the HTML content here in Claude Code chat — I'll create a project + tell you the URL to open in `/new-v2` and hit Deploy.

Once we validate the loop works for one page, we can batch the rest (e.g., a script that takes a folder of `.html` files and creates a project per file).
