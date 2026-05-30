# OpenLen section library — claude.ai briefs (102 → ~204)

17 prompts to paste into claude.ai (Opus 4.x) under your Max subscription. Each prompt produces **6 distinct, production-quality SECTION variants** as separate `text/html` artifacts in a single conversation. Total: **102 new sections** across the 17 section types (variants 07–12 per type) — growing the library from 102 to ~204.

Sibling doc: `docs/claude-design-prompts.md` (full-page templates). This one is sections only.

## How to use

1. Open claude.ai → New chat → Opus 4.x
2. Paste the **Shared output constraints** block (below). One paste per conversation.
3. Paste **one section-type brief**. claude.ai produces 6 `text/html` artifacts.
4. Download each, saving as `<type>-<NN>.html` — e.g. `hero-07.html` … `hero-12.html`.
5. Drop all the files in one folder and hand them to Claude Code — they get seeded into the `sections` table + R2 via `sections:seed`.

If a variant is wrong: `redo variant NN with [change]`. If the reply runs long: `continue with the next variant`.

---

## Shared output constraints (paste ONCE per conversation)

```
SHARED OUTPUT CONSTRAINTS for an OpenLen SECTION variant:
- Each variant = a SEPARATE artifact, type text/html, a single self-contained <!doctype html> file.
- It is a SECTION, not a full page. <body> contains EXACTLY ONE root element — <section> for most types (<header> for navbar, <footer> for footer). Never more than one top-level element in <body>.
- <head> carries: Tailwind CDN <script src="https://cdn.tailwindcss.com"></script> (for standalone preview; it is dropped automatically at ingest, the host page provides Tailwind) + Google Fonts <link> (preconnect + css2) for the chosen families.
- ALL custom CSS in ONE <style> in <head>, using normal class selectors (.btn, .card, .badge) + EXACTLY ONE :root{} block holding the design tokens. Do NOT hand-scope; do NOT use [data-sec]; the pipeline scopes it automatically.
- Design tokens live in :root and EVERYTHING is painted with var(...) so the page can re-theme the section after insert. Required token names: --accent, --accent-rgb (SPACE-separated triplet, e.g. 91 80 232), --accent-ink (text color on accent), --surface, --surface-2, --ink, --ink-soft (muted text), --border, --radius, --font-display, --font-body (and --font-mono if used). Paint brand color/borders/radius/fonts with these vars — NOT raw hex (raw hex only for neutral structural shadows or the macOS traffic-light dots).
- Tailwind utility classes for layout/spacing/typography are fine and encouraged (host provides Tailwind). Keep COLOR/BORDER/RADIUS/FONT in the :root tokens, not in arbitrary [#hex] Tailwind values.
- Mobile-responsive from 360px. Lift-on-hover on buttons (translateY, 80-150ms ease). Wrap any animation in @media (prefers-reduced-motion:reduce){...}.
- Icons/logos/illustrations = inline SVG, Lucide-style stroke with currentColor. Image placeholders = a <div> with a gradient built from var(--accent) (e.g. linear-gradient(... color-mix(in srgb, var(--accent) 8%, var(--surface)) ...)). NO external image URLs (no Unsplash).
- Real, specific copy. NO Lorem ipsum, NO generic phrases ("Streamline your workflow", "Built for teams"). Non-round metrics (12,408 not 12K; $0.0064 not $0.01). Believable fictional brand + people names. Use the half-tone headline trick (second clause in var(--ink-soft)) sparingly.
- NO data-slot-path= attribute anywhere. NO React / Babel / JSX / window globals. Vanilla JS only if the variant truly needs it (one small <script> at the END of the section's root element).
- One mode per variant (dark / light / cream) — VARY the mode across the 6 variants of the type.
- The section must look complete and polished STANDALONE (it will be inserted on its own). Full-bleed friendly: center content in a max-width container (~1180px).
- Label the artifacts "Variant 07: <Name>", "Variant 08: <Name>", … "Variant 12: <Name>".
```

After claude.ai confirms it understands, send one of the briefs below.

---

## 1. Navbar — `navbar` (variants 07–12)

New variants: `7` Dark Terminal — Monospace Code Feel _(dark)_ · `8` Cream Premium — Serif + Luxury _(cream)_ · `9` Dark Stacked — Vertical Icon Navigation _(dark)_ · `10` Light Healthcare — Trust + Accessibility _(light)_ · `11` Dark Creator — Social + Pill Buttons _(dark)_ · `12` Cream Minimalist — Underline Navigation _(cream)_

```
## Prompt — Navbar (6 sections)

Brief: Produce 6 distinct Navbar sections spanning devtools, fintech, healthcare, creator economy, and luxury verticals, at the level of production-ready premium SaaS.

SHARED (all 6): Each variant is a single <header> element containing <nav>, implemented as a standalone <!doctype html> artifact using :root design tokens (--accent, --accent-rgb, --accent-ink, --surface, --surface-2, --ink, --ink-soft, --border, --radius, --font-display, --font-body). The nav is sticky-positioned, responsive from 360px, with lift-on-hover buttons (translateY -1px, 80-150ms ease). Mobile menu toggles from 768px breakpoint. All colors, borders, radius, and fonts come from token variables. Real, specific copy—no Lorem ipsum. Inline SVG icons (Lucide stroke style). One mode per variant (dark / light / cream).

VARIANT 07: Dark Terminal — mode dark, accent #10b981.
- Layout: Monospace-style brand on left, retro terminal aesthetic with code-like nav labels. Smaller nav-height, minimal padding. Flex layout with brand and nav cluster left, CTA right.
- Content: For a software development platform (e.g. "Codeshift"). Nav items: "IDE", "CLI", "Integrations", "Workflows". Brand uses Monaco or IBM Plex Mono. Real copy: "Build type-safe pipelines for 847K+ developers." CTA: "Try free". Industry: DevTools.

VARIANT 08: Cream Premium — mode cream, accent #8b5a3c.
- Layout: Serif typography (Georgia or similar), centered logo/brand with generous spacing. Nav links spaced wider, custom underline on hover (smooth expand from left-to-right, Serif body). No backdrop blur. High-contrast luxury aesthetic.
- Content: For a luxury fintech brand (e.g. "Aureus"). Nav: "Private Banking", "Investments", "Wealth", "Legal". Real metrics: "$2.47B AUM", "1,348 clients". CTA: "Schedule private call". Industry: Fintech/Wealth.

VARIANT 09: Dark Stacked — mode dark, accent #06b6d4.
- Layout: Logo/brand left, icon-only buttons on right (vertical stack on mobile). Compact nav-height (~56px). Icons for Common actions: Help, Settings, Sign in, CTA. Hover state: subtle background pulse. No text labels for icons (tooltip-ready).
- Content: For a real-time collaboration tool (e.g. "Flux"). Stack icon meanings: Help (question), Notifications (bell with "23" badge), Profile (avatar), Start free (arrow). Real copy in hover title attributes. Industry: Collaboration/Productivity.

VARIANT 10: Light Healthcare — mode light, accent #0ea5e9.
- Layout: Logo left, nav center with high contrast (darker font-weight), trust badges inline on right (e.g. "SOC 2", "HIPAA", "ISO 27001" in small rounded pills). Expanded letter-spacing on nav. No backdrop blur.
- Content: For a health data platform (e.g. "MediVault"). Nav: "Platform", "Compliance", "Integrations", "Pricing". Trust pills real: "SOC 2 Type II", "HIPAA Certified", "27K+ hospitals". CTA: "Request demo". Industry: Healthcare/Compliance.

VARIANT 11: Dark Creator — mode dark, accent #ec4899.
- Layout: Brand with inline live-count badge (e.g. "1.2K creators online"), multi-button CTA cluster (Sign up, Join live, Explore). Pill-styled buttons with varied backgrounds (primary, secondary, tertiary). Rounded animations on nav hover.
- Content: For a creator platform (e.g. "Spectrum"). Nav: "Trending", "Communities", "Studio", "Monetize". Real count (dynamic-looking): "12,847 live creators". Button states: solid primary (bright), outlined secondary, ghost tertiary. Industry: Creator/Community.

VARIANT 12: Cream Minimalist — mode cream, accent #f59e0b.
- Layout: Centered nav links with custom gradient underline (left-to-right expand on hover using ::after pseudo). Large gap between nav items. Logo smaller on right (reverse from typical). Negative space emphasis. No background change on hover, only underline.
- Content: For a design/creative studio (e.g. "Atelier"). Nav: "Work", "About", "Studio", "Contact". Real copy: "Bespoke design for 340+ brands". CTA: subtle, minimal styling. Industry: Design/Agency.
```

---

## 2. Hero — `hero` (variants 07–12)

New variants: `7` Dark Terminal _(dark)_ · `8` Cream Card Stack _(cream)_ · `9` Dark 3-Col Metrics _(dark)_ · `10` Light Testimonial Split _(light)_ · `11` Cream Side Graphic _(cream)_ · `12` Dark Gradient Overlay _(dark)_

```
## Prompt — Hero (6 new sections, 07–12)

Brief: Produce 6 distinct new Hero sections complementing the existing 6, with deliberate mode variation (dark/cream/light), industry diversity (devtools, fintech, creator, wellness, ecommerce, agency), and distinct layout archetypes to expand the library's range.

SHARED (all 6): Each is a single <section> <root> with Tailwind CDN + Google Fonts, one <style> block holding :root{} design tokens (--accent, --accent-rgb, --accent-ink, --surface, --surface-2, --ink, --ink-soft, --border, --radius, --font-display, --font-body, --font-mono). All color/border/radius/font via var() — raw hex only for structural neutrals. Real specific copy (non-round metrics: 23,847 not 24K; $0.0087 not $0.01). Lucide-style inline SVG. No external images. Mobile-responsive 360px+. Lift-on-hover buttons (translateY, 100-150ms ease, wrapped in @media prefers-reduced-motion:reduce). No React/JSX/window globals. One mode per variant (dark/light/cream).

VARIANT 07: Dark Terminal — mode dark, accent #10b981 (emerald).
- Layout: Asymmetric left–right. Left: monospaced code snippet in a terminal block. Right: headline, 2-line supporting copy, and 3 inline metrics (uptime%, latency ms, daily volume).
- Content: DevTools observability platform (Trace, Zenith, etc.). Copy about "no vendor lock-in, query raw logs in milliseconds". Metrics: 99.97% uptime, 14ms p95, 8.3M logs/day. Real team names (eng@acme, platform@zenith).

VARIANT 08: Cream Card Stack — mode cream, accent #ec4899 (pink).
- Layout: Centered copy with 3 staggered floating cards below (overlapping, shadow depth). Cards show: feature icon + label (e.g., "AI-first", "Real-time", "Scalable").
- Content: SaaS for creators (Openlens Insights, Beacon, etc.). Headline: "Analytics built for creators who ship fast." Copy: "Track viewer engagement, sketch patterns, iterate in hours not weeks." 4-5 benefit cards with Lucide icons.

VARIANT 09: Dark 3-Col Metrics — mode dark, accent #06b6d4 (cyan).
- Layout: Centered headline, supporting text, then 3 equal-width metric cards in a grid below (icon label value).
- Content: Fintech infrastructure. Company: Vault, Nexus, Ledger. Headline: "Scale fintech without scale headaches." Metrics: 1.2B txn/month, $0.0087 per txn, 99.99% uptime. Real regulatory/security callouts.

VARIANT 10: Light Testimonial Split — mode light, accent #8b5cf6 (violet).
- Layout: Split 2-col: left is a testimonial block (large quote, avatar + name/title), right is headline + feature bullets + dual CTA.
- Content: SaaS for agencies (project mgmt, design handoff tool). Real testimonial copy about "finally shipped 40% faster", attributed believable role. Right: 4 feature bullets, start free + request demo.

VARIANT 11: Cream Side Graphic — mode cream, accent #f59e0b (amber).
- Layout: Asymmetric left–right. Left: headline, 2-line copy, single CTA, metrics row. Right: geometric illustration (inline SVG: gradient circle + bars + accent shape, 280x280px).
- Content: Wellness/SaaS. Brand: Flow, Harmony, Vitals. Copy about "wellness synced with your team's rhythm." Metrics: 47k+ users, 8.7 avg rating, $22 ARR per user.

VARIANT 12: Dark Gradient Overlay — mode dark, accent #ef4444 (red).
- Layout: Full-bleed. Accent gradient diagonal from top-left. Centered text + CTA. Below: 2-col comparison table or feature cards in a semi-transparent dark overlay block.
- Content: Ecommerce/supply-chain. Brand: Logix, Pathfind. Headline: "Inventory that never guesses." Copy about real-time stock syncing, predictive low-stock alerts. Small comparison or feature grid.
```

---

## 3. Logo Cloud — `logos` (variants 07–12)

New variants: `7` Dark Minimal Bar _(dark)_ · `8` Cream Editorial Stack _(cream)_ · `9` Dark Full-Bleed Overlay _(dark)_ · `10` Light Testimony Grid _(light)_ · `11` Cream Asymmetric _(cream)_ · `12` Dark Minimal Dots _(dark)_

```
## Prompt — Logo Cloud (6 sections)

Brief: Produce 6 distinct Logo cloud sections for SaaS/agency/fintech/ecommerce/wellness contexts, spanning dark/light/cream modes, at the caliber of Linear/Stripe/Notion/Figma landing pages.

SHARED (all 6): Each variant is a single <section> root element with :root token set (--accent, --accent-rgb, --accent-ink, --surface, --surface-2, --ink, --ink-soft, --border, --radius, --font-display, --font-body, --font-mono). Tokens power all color, spacing, borders, radius, and fonts — NO raw hex except structural shadows. Logos are inline Lucide-style SVG with currentColor stroke. Mobile-responsive 360px+. Hover lift on interactive elements. Brand-realistic copy, non-round metrics. One mode per variant. Fully self-contained <!doctype html>, Tailwind CDN + Google Fonts preconnect in <head>, all CSS in ONE <style> with :root{} block.

VARIANT 07: Dark Minimal Bar — mode dark, accent #10b981 (emerald devtools platform).
- Layout: Single-line horizontal scrollable navbar-style bar, logo+text pairs evenly spaced, minimal bottom border divider.
- Content: "Powering the edge" label. Logos: Northwind, Vellum, Quanta, Meridian, Hexlane, Lumen, Castor, Halcyon. Hover: subtle glow, slight scale lift. Use: Infrastructure/devtools context (AWS/Vercel/Netlify tier).

VARIANT 08: Cream Editorial Stack — mode cream, accent #f59e0b (amber fintech dashboard).
- Layout: Two-column grid of 4 rows (8 logos total). Left column: icon+text pairs. Right column: same. Small editorial label ("Trusted by founders") on far left, spanning rows. Copy pairs: each logo has a 1-line sub-label (e.g., "Metrics Platform", "API Layer").
- Content: Fintech context—use company names like Meridian Fintech, Lumen Analytics, Vellum Dashboard. Right-align the text pairs. Subtle divider lines between rows.

VARIANT 09: Dark Full-Bleed Overlay — mode dark, accent #06b6d4 (cyan SaaS).
- Layout: Large gradient background (dark navy to accent blue). Centered container with 6 logos arranged in 2x3 grid, floating above. Small "Joined the network" floating badge (accent circle + text) in top-right quadrant.
- Content: Use tech company names: QuantaAI, Hexlane Edge, LumenCloud, Meridian Routes. Big stat line: "2,187 active deployments". Glow effect on logos (subtle shadow from accent color). No borders, pure overlay feel.

VARIANT 10: Light Testimony Grid — mode light, accent #8b5cf6 (purple creator platform).
- Layout: 3 rows × 4 columns (12 logos). Top of section: centered quote ("We cut deployment time by 73%." — fictional CEO name). Below grid: small attribution with company/title. Each logo cell has a 2-line micro-caption below (use case snippet).
- Content: Creator/agency context. Logos: Northwind, Vellum, Quanta, Meridian, Hexlane, Lumen, Castor, Halcyon, Pendle, Sable + 2 more. Captions like "Team Collab", "Video Export", "Asset Mgmt". Slightly larger cells with breathing room.

VARIANT 11: Cream Asymmetric — mode cream, accent #ec4899 (pink wellness/creator).
- Layout: Asymmetric: large featured logo (120px) on left with wordmark below. Right sidebar: vertical list of 6 smaller logos (40px each), minimal spacing, alternating text alignment. Stat below featured logo ("Trusted by 8,200+ creators").
- Content: Wellness/creator context. Featured logo: "Halcyon" with tagline. Sidebar includes: Northwind, Vellum, Quanta, Meridian, Hexlane, Lumen. Use real wellness brand names in copy. Soft background gradient on left column only.

VARIANT 12: Dark Minimal Dots — mode dark, accent #f43f5e (rose ecommerce).
- Layout: 6 logos arranged in a halo circle (60° apart) around a central stat bubble. Stat bubble: large number (e.g., "$48.7M") + label ("GMV this year"). Hover any logo: slight rotate inward, glow amplifies.
- Content: Ecommerce context. Use brands like Northwind Commerce, Vellum Shop, QuantaCart, MeridianPay, HexlaneMarkets, LumenShop. Central stat: "$48.7M GMV this year · 19.2% QoQ growth". Subtle animation on load (fade in staggered).
```

---

## 4. Features — `features` (variants 07–12)

New variants: `7` Stacked Narrative _(dark)_ · `8` Icon + Detail Rows _(cream)_ · `9` Visual-First Pairs _(light)_ · `10` Timeline Progression _(dark)_ · `11` Pillars Grid _(cream)_ · `12` Comparison + Toggle _(dark)_

```
## Prompt — Features (6 sections)

Brief: Produce 6 NEW, distinct Features sections showcasing diverse industries & layouts—fintech, wellness/creator, ecommerce, agency, no-code, enterprise contexts. Each is a single <section> using :root tokens, responsive 360px+, real copy, no Lorem ipsum.

SHARED: All single <section> root element, <head> with Tailwind CDN + Google Fonts (preconnect), ONE <style> with :root{} token block (--accent, --accent-rgb, --accent-ink, --surface, --surface-2, --ink, --ink-soft, --border, --radius, --font-display, --font-body). Paint with var() only. Tailwind layout/spacing OK. Icons inline SVG (currentColor). Image placeholders gradient from --accent. NO external URLs, NO data-slot-path=, NO React. Lift-on-hover buttons (translateY, 80-150ms ease), @media prefers-reduced-motion. Mode varies per variant (dark / light / cream). Real metrics (3,427 not 3K; $47.28 not $50). Believable brand/people names, specific copy. Responsive grid collapse. Fully polished standalone.

VARIANT 07: Stacked Narrative — mode dark, accent #10a956 (emerald).
- Layout: Vertical column of alternating text-block + full-bleed accent-bg blocks, clean contrast shifts.
- Content: Fintech wealth-management use case. "Your portfolio deserves a second opinion" with real asset classes, allocation %s, robo-advisor tone. Use fictional brand like "Vault", names like "Priya Desai". Metrics: 247 billion AUM tracked, 12% average outperformance, $12.4M safeguarded daily.

VARIANT 08: Icon + Detail Rows — mode cream, accent #8b5cf6 (violet).
- Layout: Vertical list of dense rows, each with a large left-aligned icon (50px), right side has title + description + detail metric, spacing between rows. Scannable, minimal borders.
- Content: Wellness/creator platform. "Every creator's voice counts" with wellness coaching, meditation library, community. Fictional brand "Breathe", names like "Maya Chen", "James Wilson". Metrics: 47K daily active meditators, 1.2M journaling streaks, 4.8-star community rating.

VARIANT 09: Visual-First Pairs — mode light, accent #d97706 (amber).
- Layout: 2–3 left/right alternating pairs (copy on left, visual mock on right; then visual left, copy right). Asymmetric widths, generous whitespace.
- Content: Ecommerce returns automation. "Returns that feel like wins" with faster refunds, eco-friendly recycling, customer sentiment. Brand "ReFlow", names "Alex Morgan", "Sophie Leung". Metrics: $2.3B reverse logistics, 89% on-time refunds, 340K trees replanted.

VARIANT 10: Timeline Progression — mode dark, accent #06b6d4 (cyan).
- Layout: Vertical timeline with circle nodes, connecting lines, milestone cards offset left-right alternating along spine.
- Content: No-code automation agency. "From chaos to clarity in 6 weeks" showing onboarding, design, automation, training phases. Brand "Flux", names "Rajesh Patel", "Emma Wilson". Metrics: 156 workflows deployed, 23 hours saved per client weekly, 93% client retention.

VARIANT 11: Pillars Grid — mode cream, accent #ea580c (orange).
- Layout: 2-3 column grid of tall narrow pillar cards (portrait orientation), large icon at top, title + description below, minimal borders, strong vertical emphasis.
- Content: Enterprise HR platform. "People thrive when the tools fade" with hiring, development, engagement, analytics pillars. Brand "Flourish", names "Derek Thompson", "Lisa Park". Metrics: 15 million employees onboarded, 7% engagement lift, 53K enterprises.

VARIANT 12: Comparison + Toggle — mode dark, accent #ec4899 (pink).
- Layout: Split-screen with toggle (radio/button) to switch between "Legacy" vs "New" (or "Before/After"). Side-by-side metrics comparison, animated transition.
- Content: B2B SaaS migration story. "The cost of doing nothing" vs "The power of moving forward" showing uptime, security, cost, speed deltas. Brand "Nexus", names "Olivia Grant", "Marcus Bell". Metrics: 99.99% uptime, 60% cost reduction, 4x faster deployments, 10K+ customers migrated.
```

---

## 5. Stats — `stats` (variants 07–12)

New variants: `7` Creator Minimalist _(light)_ · `8` Fintech Timeline _(dark)_ · `9` Wellness Compact _(cream)_ · `10` Enterprise Compare _(dark)_ · `11` Marketplace Radial _(light)_ · `12` Devtools Terminal _(cream)_

```
## Prompt — Stats (6 new variants, 07–12)

Brief: Produce 6 distinct Stats sections for premium product contexts (creator platform, fintech, wellness app, enterprise SaaS, marketplace, devtools), diverging from the existing 01–06 layouts. Each is a self-contained <section> using :root design tokens.

SHARED (all 6): Each artifact is a standalone <!doctype html> file with a single <section> root. Tailwind CDN in <head>, Google Fonts (preconnect + css2), all custom CSS in one <style> block with :root{} tokens. All color/border/radius/font painted via var(...) — no raw hex except neutral shadows. Required tokens: --accent, --accent-rgb (space-separated triplet), --accent-ink, --surface, --surface-2, --ink, --ink-soft, --border, --radius, --font-display, --font-body. Mobile-responsive from 360px. Button hover: translateY -2–3px over 80–150ms ease. Real, specific copy (no Lorem ipsum, no round metrics, believable fictional brands/people). One mode per variant (dark/light/cream). No data-slot-path, no React/JSX, vanilla JS only if truly needed (one small <script> at end of root element). SVG icons inline, Lucide-style with currentColor. Image placeholders: <div> with gradient using var(--accent). Standalone polish: looks complete alone, full-bleed friendly, ~1180px max-width container.

VARIANT 07: Creator Minimalist — mode light, accent #c4a747.
- Layout: Vertical stacked single-column, each stat as a labeled icon + number + caption, abundant vertical breathing, mobile-first then desktop scaling.
- Content: Patreon/Ko-fi creator platform. Metrics: "342,158 active creators", "48.3M total supporters reached", "$12.7B distributed this year", "1,247 new tier launches". Use humanist brand voice ("creators getting paid for what they love"). Smaller metrics for caption (% growth, time period).

VARIANT 08: Fintech Timeline — mode dark, accent #10b981.
- Layout: Vertical timeline axis (left), bars/connectors extending right, each metric as a bar-height-coded value with label overlay on hover, no grid.
- Content: Fintech settlement platform. Metrics: "Daily transactions" (38.4M, tallest bar), "Settlement rate" (99.97%, second), "Avg time to clear" (14ms, short bar), "Cost per txn" ($0.0002, tiny bar). Trend indicator on each: ↑, ↓, or →. Fictional brand: "Clearpath" or "SettleFlow".

VARIANT 09: Wellness Compact — mode cream, accent #ec4899.
- Layout: 2-column fixed grid of 4 tiles (2×2), each tile: icon (SVG) + metric (large bold) + descriptor (small muted). Tile background is surface, subtle border. Compact, unified visual rhythm.
- Content: Wellness app (meditation/fitness aggregator). Metrics: "1.3M daily active mindfulness sessions", "342 new classes added", "$89M saved in healthcare spend (annual)", "98.2% user retention". Fictional brand: "Serenity" or "VibeFlow". Use wellness language ("collective wellness", "daily practice").

VARIANT 10: Enterprise Compare — mode dark, accent #3b82f6.
- Layout: Left column fixed width (label area), right columns minimal spacing, each row = one metric + bar accent fill indicating % or status. No grid, table-like feel but not <table>. Optional: add a toggle button that swaps data sets (e.g., "This Quarter" vs "Last Year") via inline CSS :checked state.
- Content: SaaS platform performance report. Metrics: "API uptime" (99.98%), "Query latency p50" (32ms), "Data processed" (8.2TB/day), "Cost per compute hour" ($0.042), "User seats provisioned" (4,127). Fictional brand: "DataStrike" or "ComputeHub". Use B2B enterprise tone.

VARIANT 11: Marketplace Radial — mode light, accent #f59e0b.
- Layout: 4–6 rounded stat tiles arranged radially or honeycomb-ish around a center point, each tile same size, CSS Grid or absolute positioning to radiate. On mobile, fall back to vertical stack. Circular/organic feel.
- Content: Ecommerce marketplace (Shopify-like). Metrics: "1.24M seller storefronts", "483M customer reviews this month", "$34.7B GMV YTD", "42 countries live". Smaller captions with % change. Fictional brand: "Flourish" or "TradeHub". Warm, merchant-focused copy.

VARIANT 12: Devtools Terminal — mode cream, accent #6366f1.
- Layout: Minimal table-style (no <table>), left column = key name (monospace, muted), right = value (monospace, bold). Rows separated by borders, minimal padding. Inspired by `top` or `ps` command output; no rounded corners or shadows.
- Content: CI/CD platform or monitoring tool. Metrics: "builds/day: 18,427", "avg_build_time: 3m 14s", "success_rate: 98.7%", "flake_rate: 0.8%", "cache_hit_ratio: 78.3%". Fictional brand: "BuildVault" or "PipelineX". Use terse, technical naming (snake_case, short labels).
```

---

## 6. How it works — `how-it-works` (variants 07–12)

New variants: `7` Radial Cycle _(dark)_ · `8` Split-Screen Narrative _(cream)_ · `9` Checklist Progression _(light)_ · `10` Card Carousel (Horizontal Scroll) _(dark)_ · `11` Numbered Blocks with Sidebars _(cream)_ · `12` Accordion-Tree Steps _(light)_

```
## Prompt — How it works (6 new variants: 07-12)

Brief: Produce 6 distinct How it works sections for modern SaaS/fintech/creator platforms, at the level of Linear/Vercel/Stripe/Resend. Each should feel complete and polished as a standalone section component.

SHARED (all 6): Each variant is a single <section> root in a self-contained HTML file with Tailwind CDN and Google Fonts. Use the :root token contract (--accent, --accent-rgb, --accent-ink, --surface, --surface-2, --ink, --ink-soft, --border, --radius, --font-display, --font-body). Paint everything with var() tokens — no hardcoded hex except neutral structural shadows. One mode per variant (dark / cream / light). Mobile-responsive from 360px. Lift-on-hover buttons (translateY, 120ms ease). Inline SVG only (Lucide-style). Real, specific copy (no Lorem; non-round metrics). No data-slot-path or React globals. Section must be production-ready and complete standalone.

VARIANT 07: Radial Cycle — mode dark, accent #10B981 (emerald).
- Layout: Central hub step with outer 3 steps arranged radially; connection lines form a cycle metaphor; click/tap reveals step detail overlay.
- Content: Fintech on-boarding flow (sign up → fund account → trade → monitor). Brand: FinFlow. Person: Aisha Chen (trader). Metrics: 15,200 accounts funded daily, $2.3M median first trade, 99.8% uptime.

VARIANT 08: Split-Screen Narrative — mode cream, accent #F59E0B (amber).
- Layout: Left column (40%) = step cards numbered 1–4, right column (60%) = living narrative prose + pull quotes + icons that animate on scroll.
- Content: Wellness app (onboarding wellness app for therapists). Brand: MindThread. Person: Dr. Marcus Lee. Metrics: 847 therapists, 6.2s median setup, 94% session completion.

VARIANT 09: Checklist Progression — mode light, accent #8B5CF6 (violet).
- Layout: Minimal left-aligned numbered checkmarks (like a GitHub issue list); no cards, just text. Clean, hierarchical, text-forward. Desktop: optional right-aligned icons or metrics on same line.
- Content: Project management automation (Zapier-like). Brand: AutoSync. Person: Priya Desai (startup founder). Metrics: 2,841 workflow templates, 12ms latency, 99.95% reliability.

VARIANT 10: Card Carousel (Horizontal Scroll) — mode dark, accent #EC4899 (pink).
- Layout: Desktop = full-width horizontal scrollable card strip (snaps to steps); mobile = vertical stack. Each card includes icon, title, subtitle, and a metric.
- Content: Creator monetization (streaming platform). Brand: CreatorVault. Person: Jordan (content creator). Metrics: 34,821 creators live, $1.2B paid out YTD, 2.1s average stream start.

VARIANT 11: Numbered Blocks with Sidebars — mode cream, accent #06B6D4 (cyan).
- Layout: 4-row structure; each row: left sidebar (icon + metric), center copy block (title + description), right accent bar (color block or subtle visual). Staggered alignment on desktop.
- Content: E-commerce fulfillment (print-on-demand). Brand: PrintFlow. Person: Sam Rodriguez (shop owner). Metrics: 7,432 SKUs live, 1.3-day ship time, $847K in orders processed.

VARIANT 12: Accordion-Tree Steps — mode light, accent #EF4444 (red).
- Layout: Main steps (1–4) are expandable headings; each expands to reveal 2–3 sub-steps (A, B, C) in a tree. Active step highlights; smooth height transitions.
- Content: Software deployment (CI/CD pipeline). Brand: DeployHub. Person: Zoe Kim (DevOps engineer). Metrics: 3,641 deploys/day, 18s median deploy, 99.99% success rate.
```

---

## 7. Testimonials — `testimonials` (variants 07–12)

New variants: `7` Dark Gradient Spotlight _(dark)_ · `8` Cream Modular Stack _(cream)_ · `9` Dark Minimal Brutalist _(dark)_ · `10` Light Editorial Timeline _(light)_ · `11` Dark Card Cluster Grid _(dark)_ · `12` Cream Comparison Pairs _(cream)_

```
## Prompt — Testimonials (6 variants)

Brief: Produce 6 distinct Testimonials sections for enterprise software, fintech, and creator tools, at the level of Linear/Stripe/Zapier. Each variant must be a single self-contained <section> artifact (<!doctype html>), mobile-responsive from 360px, with Tailwind utilities for layout and a single :root{} block holding all design tokens (--accent, --accent-rgb, --accent-ink, --surface, --surface-2, --ink, --ink-soft, --border, --radius, --font-display, --font-body). Real, specific copy—no Lorem ipsum. Vary the mode (dark/light/cream) across the 6. Icon and avatar SVGs use currentColor (Lucide-style stroke). No external images; placeholders are gradients built from var(--accent).

VARIANT 07: Dark Gradient Spotlight — mode dark, accent #2dd4bf (teal).
- Layout: Full-bleed dark background, oversized off-center avatar initials (120px+), large quote positioned over gradient overlay, minimal role/company text, single metric or outcome callout.
- Content: Fintech story—e.g., "Streamlined reconciliation from 8 hours to 12 minutes. We recoup the license fee on client onboarding alone." (Rashid Al-Maktoum, CFO · Crescent Capital, $14.8B AUM). Use teal accent for emphasis.

VARIANT 08: Cream Modular Stack — mode cream, accent #8b5cf6 (purple).
- Layout: Vertical stacked cards (100% width on mobile), each with optional image-left placeholder gradient, left-aligned small avatar + name/role, alternating image position (alt 1 has image left, alt 2 has image right). 3–4 cards. Generous spacing.
- Content: Creator/SaaS story—e.g., cohort of independent creators (Aisha Williams, Audio Producer · Lagos), freelance platforms (Marco Benedetti, Designer · Milan), startup founder (Zara Patel, Founder · Kaleidoscope Labs). Metrics about time saved or earnings growth.

VARIANT 09: Dark Minimal Brutalist — mode dark, accent #fbbf24 (amber).
- Layout: Single hero quote in massive, tight-tracked display font, small circular avatar (60px), one-liner role, no company name, large accent border frame around entire quote, centered, whitespace-dominant. Pair with one full-bleed testimonial per page load.
- Content: Wellness/health tech story—e.g., "My patients' adherence jumped from 34% to 71%. I stopped feeling like a nag and started feeling like a coach." (Dr. Elena Suarez, Family Medicine · San Juan, 2,800 active patients).

VARIANT 10: Light Editorial Timeline — mode light, accent #06b6d4 (cyan).
- Layout: Vertical left-right alternating quote cards on a central spine line (connecting line). Quote-cards positioned offset left and right, each with avatar, name, role, small date or metric badge (e.g., "Q3 2024"). 4–5 testimonials. Timeline aesthetic.
- Content: DevOps/Infrastructure story—e.g., CTO testimonials from Series B startups (Yuki Shimada, CTO · Tokyo), enterprise ops (Dmitri Volkov, VP Infrastructure · Moscow), CI/CD platform adoption. Metrics about deployment frequency or MTTR.

VARIANT 11: Dark Card Cluster Grid — mode dark, accent #ec4899 (pink).
- Layout: Irregular 2–3 column masonry grid, mixed card sizes (some double-height, some narrow), offset drop shadows in accent color, dense text with inline quote marks (not blockquote), compact 12–16px cards. 6–8 tight testimonials. Busy, curated density.
- Content: Analytics/data platform story—e.g., fractional CFOs, product managers, data engineers (Priya Mehta, Analytics Lead · Bangalore), real quotes about funnel clarity and dashboards. Very specific metrics embedded in quotes.

VARIANT 12: Cream Comparison Pairs — mode cream, accent #f87171 (red).
- Layout: Two-column pairs of related testimonials (e.g., "Before/After" or "Switched from X" angle), matched card sizes, small accent label above each pair (e.g., "Comparison"), centered max-width container. 2–3 pairs. Parity visual rhythm.
- Content: Migration/platform-comparison story—e.g., engineering teams migrating from Heroku to new provider, support teams choosing new ticketing system. Quote snippet from old experience vs. new outcome. (Ahmed Nasser, DevOps · Dubai; Sophia Martinez, Support Lead · São Paulo).
```

---

## 8. Pricing — `pricing` (variants 07–12)

New variants: `7` Dark Pro — Minimal Cards _(dark)_ · `8` Cream Tiered Comparison _(cream)_ · `9` Dark Enterprise Staircase _(dark)_ · `10` Light FAQ-Driven _(light)_ · `11` Cream Membership Rings _(cream)_ · `12` Dark Sales-Focused _(dark)_

```
## Prompt — Pricing (6 sections, variants 07–12)

Brief: Create 6 diverse Pricing sections for varied SaaS verticals (fintech, wellness, ecommerce, creator platform, dev infra, enterprise B2B). Each is a self-contained <section> using :root tokens. Modes must vary (dark/light/cream); none should duplicate existing 01–06 layouts.

SHARED: Single <section> root element with HTML/Tailwind. All custom CSS in one <style> with :root{} design tokens (--accent, --accent-rgb, --accent-ink, --surface, --surface-2, --ink, --ink-soft, --border, --radius, --font-display, --font-body). Paint everything with var(...) for re-theming. Mobile-responsive 360px+. Buttons lift on hover (-2px, 100ms). No data-sec=, no React, no external images; use inline SVG + gradient divs. Real copy, specific metrics (non-round numbers), fictional brands/people. Tailwind utilities + token CSS only. 30px+ padding. Full-bleed friendly (~1180px max-width).

VARIANT 07 — Dark Pro · Minimal Cards — Dark mode, accent #3D7FFF (electric blue), accent-rgb 61 127 255.
- Layout: 3-card stack, each card has bold left accent border (4px solid var(--accent)), dark gradient background, minimal visual noise. Cards slightly scale on hover.
- Content: FinTech platform (cross-border payments). Three tiers: "Starter" ($29/mo, 50 transactions/day), "Growth" ($129/mo, 500/day — highlighted with accent border glow), "Enterprise" (Custom, unlimited). Copy: "Pay globally, settle locally. Reconcile in 47 seconds."

VARIANT 08 — Cream Tiered Comparison — Cream mode (#FFFBF5 background), accent #C85A30 (warm terra-cotta), accent-rgb 200 90 48.
- Layout: Horizontal 3-tier reveal with chevron icons. Each tier is a card with rounded corners, collapsed by default, expands on click to show nested features. Top tier highlighted with subtle warm gradient.
- Content: Wellness & habit tracking app. Tiers: "Casual" ($12/mo, track 3 habits), "Consistent" ($34/mo, unlimited habits + community — expanded default), "Coach" ($89/mo, 1:1 check-ins). Copy: "Build habits that stick. 67% of users hit their goals in month one."

VARIANT 09 — Dark Enterprise Staircase — Dark mode, accent #12D4E0 (cyan), accent-rgb 18 212 224.
- Layout: Staggered ascending card tower. Each tier card rises vertically; "Start" at bottom-left, "Growth" center, "Scale" top-right. Cards connected by subtle diagonal lines. Accent bar on left of each card.
- Content: DevOps observability platform. Tiers: "Start" ($49/mo, 10 services), "Growth" ($199/mo, 100 services), "Scale" ($799/mo, unlimited + PagerDuty sync). Copy: "See everything. Alert fast. Resolve 73% quicker."

VARIANT 10 — Light FAQ-Driven — Light mode, accent #8B4EE8 (purple), accent-rgb 139 78 232.
- Layout: Top section has 3 flat pill buttons (Solo / Team / Org), each pill is clickable to show/hide related FAQ section below in a 2-col grid. No tall card stacks; compact Q&A pairs inline.
- Content: Collaborative design SaaS (Figma-like). Tiers: Solo ($15/mo, 1 project), Team ($49/mo, unlimited projects — default expanded), Org ($199/mo, SSO + audit logs). FAQs per tier: "Can I export?" "Offline mode?" "Annual discounts?" Copy: "Design together. Version control. 14.2M files collaborated on last month."

VARIANT 11 — Cream Membership Rings — Cream mode, accent #E84855 (coral red), accent-rgb 232 72 85.
- Layout: Concentric circles (or stacked hexagons) representing tier levels. Center = entry tier (Casual), middle ring = Pro, outer = Premium. Icons radiate outward. Responsive: stacks vertically on mobile.
- Content: Creator monetization platform. Tiers: "Casual" ($0/mo, share with 10 fans), "Creator" ($29/mo, unlimited fans + analytics), "Studio" ($99/mo, team collab + branded space). Copy: "Turn followers into income. 24K creators earned $1M+."

VARIANT 12 — Dark Sales-Focused — Dark mode, accent #00D97E (vibrant green), accent-rgb 0 217 126.
- Layout: Split hero: left side has bold 2–3 line copywriting + stats callout (e.g. "Trusted by 8,400+ teams"), right side 2-card tier showcase (Pro highlighted with glow, Enterprise below). CTA below each card.
- Content: Enterprise SaaS security/compliance platform (GitGuardian-style secrets scanning). Tiers: "Pro" ($199/mo, 5 repos, Slack alerts), "Enterprise" (Custom, unlimited repos + dedicated SOC). Metrics: "Caught 892,147 leaked secrets last month" (top-left callout). Copy: "Detect before they're exposed. Real-time GitHub scanning. 4-minute setup."
```

---

## 9. Comparison — `comparison` (variants 07–12)

New variants: `7` Stark Fintech Duality _(dark)_ · `8` Creator Playground _(cream)_ · `9` DevTools Diagonal _(dark)_ · `10` Wellness Win Waterfall _(light)_ · `11` Premium Glassmorphic _(dark)_ · `12` Social Proof Checklist _(cream)_

```
## Prompt — Comparison (6 sections)

Brief: Produce 6 distinct, layout-diverse Comparison sections for premium brands (fintech, wellness, creator, devtools, ecommerce, agency contexts), at the level of Stripe/Linear/Figma/Notion.

SHARED (all 6): Each is a single <section> with :root tokens, no external images (inline SVG + gradient placeholders only), mobile-responsive 360px+, real specific copy (non-round metrics, credible fictional brands/people), button lift-on-hover (80-150ms), varied modes to show token retheming.

VARIANT 07: Stark Fintech Duality — mode dark, accent #7c3aed.
- Layout: Brutal two-column comparison. Left = "The old way" in muted tones; right = "Helix way" in accent. Minimal borders, max type contrast.
- Content: Stripe/Plaid/Legacy banking context. Fintech specific: settlement latency (320 ms vs 12 ms), ACH reconciliation time (6 hrs vs 14 min), monthly webhook failures (847 vs 2), cost per transaction ($0.0018 vs $0.00034). Fictional brand "PayMeld".

VARIANT 08: Creator Playground — mode cream, accent #ec4899.
- Layout: Staggered overlapping card grid (3-4 cards, intentionally offset/angled). Asymmetric composition. One card appears to "float" over others.
- Content: Creator economy / ecommerce context. Metrics: time to launch shop (2 wks vs 3 days), payment methods supported (8 vs 26), monthly payout delays (variable vs guaranteed next-day), revenue split (30% fee vs 5.9%). Fictional brand "ShopFlow" or influencer name "Riley.shop".

VARIANT 09: DevTools Diagonal — mode dark, accent #06b6d4.
- Layout: Diagonal split (60/40): top-left "Legacy stack", bottom-right "Helix". Floating metric badges. One floating accent line/wave. Center overlap zone.
- Content: DevTools / CI-CD context. Pipeline build time (18 min vs 1.4 min), test flakiness rate (12.8% vs 0.3%), deployment rollback count/mo (4 vs 0.1), cost per build second ($0.000084 vs $0.000018). Fictional brand "FastCI" or team name.

VARIANT 10: Wellness Win Waterfall — mode light, accent #10b981.
- Layout: Vertical waterfall: sequential wins stack downward. Each row = icon (left) + metric card (center) + descriptor (right). Staggered reveal aesthetic.
- Content: Wellness / fitness SaaS context. Membership retention (68% vs 87%), churn reason "no results" (41% vs 3%), customer support tickets/user/mo (2.1 vs 0.4), annual LTV per user ($180 vs $654). Fictional brand or gym name "FitFlow Pro".

VARIANT 11: Premium Glassmorphic — mode dark, accent #f59e0b.
- Layout: Two frosted-glass cards on dark background, gradient borders (accent color), floating metric pills above. Subtle blur / backdrop-filter effect. Overlap / layered feel.
- Content: Premium fintech / investment platform context. Real-time quote latency (850 ms vs 22 ms), portfolio rebalance execution (batch 4x/day vs continuous), tax-loss harvest accuracy (94.2% vs 100%), advisory cost (0.75% AUM vs $0/trade). Fictional brand "CapitalAI" or "VelocityPM".

VARIANT 12: Social Proof Checklist — mode cream, accent #8b5cf6.
- Layout: Vertical feature checklist (✓ items + strikethrough items). Below each feature, a 1-2 sentence testimonial in soft text + small avatar. Avatar row at bottom.
- Content: Ecommerce / SAAS platform context. Features: "Inventory synced in real time" (vs "manual daily uploads"), "Fulfillment in <2 hrs" (vs "3–5 days"), "$0 setup fee" (vs "$2,400"), "99.99% uptime guarantee" (vs "best effort"). Use 3-4 real-looking fictional customer names + role titles. E.g. "Maya Chen, Head of Ops @ RitualBox" says "Cut our fulfillment overhead in half."
```

---

## 10. Integrations — `integrations` (variants 07–12)

New variants: `7` Minimal Brutalist _(dark)_ · `8` Scattered Masonry _(cream)_ · `9` Feature Carousel _(dark)_ · `10` Directory Table _(cream)_ · `11` Bold Icon Grid _(dark)_ · `12` Social Proof Cards _(cream)_

```
## Prompt — Integrations (6 NEW sections, 07-12)

Brief: Produce 6 distinct Integrations sections for premium SaaS/landing context (devtools, fintech, wellness, creator platform, ecommerce ops, agency), at the level of Linear/Vercel/Stripe/Resend.

SHARED (all 6):
Each is a self-contained <section> artifact using :root design tokens (--accent, --accent-rgb, --accent-ink, --surface, --surface-2, --ink, --ink-soft, --border, --radius, --font-display, --font-body). Single root element, Tailwind + Google Fonts in <head>, ONE <style> block with :root{} and .class selectors (no [data-sec], no React). Mobile-responsive 360px+. Lift buttons on hover (translateY, 80-150ms ease). Inline SVG icons (Lucide-style stroke + currentColor). Real, non-round metrics. Specific fictional brands + people. No external images. No Lorem ipsum. One mode per variant—vary dark/light/cream across all 6.

VARIANT 07: Minimal Brutalist — mode dark, accent #a78bfa (purple).
- Layout: Single-column left-aligned list, max-width 700px, each integration as a row with icon (small, 32x32) on left, name + category tag + 2-line description right. Generous padding between rows. Hover: soft underline + slight icon scale. Zero fancy transitions.
- Content: Devtools focus. Use real names: Slack, GitHub, Linear, Notion, Vercel, Firebase, Supabase, Datadog, PagerDuty, Figma. Brief, functional copy ("Route alerts through your team. Bi-directional sync. Live in 4min."). Show 8 integrations.

VARIANT 08: Scattered Masonry — mode cream, accent #d97706 (amber).
- Layout: 3-4 card tiles in loose, staggered masonry grid (use negative margins or transform: translateY on alternating cards to offset rows). Each card 220px, icon 48x48 centered, title, 1-line description. Soft box-shadow. Hover: slight scale + deeper shadow. Full-bleed container with padding.
- Content: Wellness/creator focus. Use real brands: Stripe, PayPal, Typeform, Zapier, Calendly, Loom, Airtable, Mailchimp. Copy emphasizes ease ("One click, live in seconds"). Show 10 integrations.

VARIANT 09: Feature Carousel — mode dark, accent #ec4899 (pink).
- Layout: Large centered card (max-width 600px), displays ONE integration at a time: huge icon (96x96), bold name, category badge, 3-line description, 3 feature bullets. Below: prev/next buttons (chevron icons, left/right) + dot progress indicator (e.g. "3 / 12"). Smooth fade transition between cards.
- Content: Fintech APIs. Use real names: Plaid, Stripe, Square, Wise, Polygon, Alchemy, MoonPay, Fiserv. Each card copy highlights integrations like "Plaid: Connect 12,000+ financial institutions. Covers 45 countries. Verifies identity in real time." / "Square: ACH, Card, PayPal, Apple Pay. Settle next-business-day. 2.6% + $0.30 base rate." / etc. Show all 12 in carousel.

VARIANT 10: Directory Table — mode cream, accent #06b6d4 (cyan).
- Layout: Responsive table (on mobile: stack as cards; on tablet+: full columns). Columns: Integration Name (with icon) | Category | Status (badge: "Connected" / "Available") | Install Count (right-aligned). Sortable headers (icon hint). Rows with hover highlight (subtle bg). Footer with total count.
- Content: Ecommerce ops. Use real names: Shopify, WooCommerce, BigCommerce, Avalara, Klevu, SearchSpring, Klaviyo, Zendesk, Gorgias. Real numbers: (14,208 installs), (8,412 installs), etc. Status varies (3-4 show "Connected", rest "Available"). Copy in hover tooltip (optional).

VARIANT 11: Bold Icon Grid — mode dark, accent #10b981 (emerald).
- Layout: 2-column grid on mobile, 3-column on tablet, 4-column on desktop. Each tile 200px+, oversized icon (64x64), bold name (18px), category label small (12px), inline "Connect" button (small, secondary style). Tile hover: lift + shadow. Dense, typographic presentation.
- Content: Agency/workflow focus. Use real names: HubSpot, Salesforce, Asana, Monday.com, Jira, Confluence, Miro, Figma, Loom, Typeform, Zapier, Segment. Emphasis on "connect in one click" / "zero setup" / "live instantly".

VARIANT 12: Social Proof Cards — mode cream, accent #f59e0b (amber).
- Layout: 3-column grid (responsive: 1 col mobile, 2 col tablet). Each card 280px: integration name + icon at top, 2-3 line testimonial quote in italics ("We cut data sync time by 80%", "Finally, our CRM stays in sync without scripts"), attribution (team name + size, e.g. "Acme Design · 47 people"), tiny company logo placeholder (circular gradient 48x48). Card hover: lift + border change. Full-bleed section with soft background.
- Content: Trust-focused narrative. Use real names: Zapier, Make, n8n, Unito, Workato, Boomi, Dell Boomi, RapidRun, Parabole, Flowmapp. Each card: one fictional company quote ("Sarah Chen, Zenith Studios · 32 people": "Finally, our CRM stays in sync without engineering tickets.") / ("Marcus Rodriguez, LightSpeed Agency · 156 people": "Cut our data reconciliation from 8hrs/week to zero.") / etc.
```

---

## 11. Gallery — `gallery` (variants 07–12)

New variants: `7` Dev Release Timeline _(dark)_ · `8` Fintech Transaction Showcase _(light)_ · `9` Wellness Coach Testimonials _(cream)_ · `10` Creator Portfolio Clips _(dark)_ · `11` Ecommerce Collection Grid _(light)_ · `12` Agency Case Studies _(cream)_

```
## Prompt — Gallery (6 variants, 07–12)

Brief: Produce 6 distinct Gallery sections at production quality for diverse use cases—from devtools to fintech to creator platforms. Each is a single <section> with :root token contract, varied modes (dark/light/cream), and specific, believable copy. Industries range widely so the library can flex across contexts.

SHARED (all 6): Each is a SECTION (single root element <section>) with embedded <style> carrying :root{} tokens (--accent, --accent-rgb, --accent-ink, --surface, --surface-2, --ink, --ink-soft, --border, --radius, --font-display, --font-body). All colors painted with var(...) so host can re-theme. Tailwind CDN in <head>, Google Fonts preconnect + css2 for chosen families. Mobile-responsive from 360px. Lift-on-hover buttons (translateY, 80–150ms ease). No raw hex except neutrals/shadows. No external images (gradients + inline SVG only, Lucide stroke style). Real, specific copy—no Lorem ipsum, non-round metrics, believable names. NO data-slot-path, NO React/JSX, vanilla JS only if essential (one <script> at END of root). Standalone polish.

---

VARIANT 07: Dev Release Timeline — mode dark, accent #06b6d4.
- Layout: Vertical timeline with milestone markers; cards stagger left/right for visual rhythm, numbered steps on connector spine.
- Content: SaaS DevOps tool (like Vercel). Show 5 major releases: "0.8.2 — Edge Functions" (6,841 deployments last week), "0.9.0 — Analytics Beta" (2,347 users opted in), "1.0.0 — Production Ready" (launched May 2026), "1.1.0 — Observability Suite" (next quarter), "1.2.0 — Roadmap." Each card: date, version, one-liner, single metric. Use slate/cyan accents. Copy tone: technical but celebratory.

VARIANT 08: Fintech Transaction Showcase — mode light, accent #10b981.
- Layout: Overlapping card deck with CSS 3D depth (slight z-stagger), each card reveals on hover; numeric callouts (transaction amounts, gains) float over cards. Parallax tilt on mouse move.
- Content: Wealth-management app. Show 6 "highlight transactions" from a fictional brokerage (TrueCap): "AAPL call bought +$18.2k realized" (Jan 2026), "ETF rebalance -$832 fees" (auto), "TSLA covered call +$2.107k premium" (Mar 2026), etc. Each card: icon (SVG buy/sell arrow), amount, instrument, date, gain/loss. Metrics: 97.3% fill rate, $2.104B AUM. Copy: precise, financial.

VARIANT 09: Wellness Coach Testimonials — mode cream, accent #ec4899.
- Layout: Avatar gallery (face images as gradient circles) paired with quote cards, 2-column on desktop (1 on mobile), humanized spacing, soft shadows. Each row: avatar left, quote-card right, staggered.
- Content: Health coaching platform (FitMind). 4 testimonials: real-sounding names (Priya Desai, Marcus Chen, Elena Rodriguez, Jasper Kim), specific progress (e.g., "Dropped 11.2 lbs in 12 weeks, resting HR down to 58"), 5-star badges, coach name (e.g., "Coach Sara"). Tone: warm, personal, conversational.

VARIANT 10: Creator Portfolio Clips — mode dark, accent #f59e0b.
- Layout: Tight 2-column grid of tall cards (6/8 ratio), each has a gradient placeholder with a centered play-button icon (SVG circle + triangle). On hover, icon morphs to double-arrow (external link hint). Soft box-shadow, 12px radius.
- Content: Video creator/editor portfolio (stock clips). 6 projects: "Aerial Tokyo Neon" (3:47, 4K), "Underwater Kelp Forest" (1:52, 8K slow-mo), "Urban Parkour Montage" (5:34, 1080p 60fps), "Desert Dusk Timelapse" (0:48, 8K), "Warehouse Dance Crew" (4:12, 4K), "Northern Lights Loop" (2:16, 4K stock). Hover shows duration and resolution. Copy: crisp, technical spec.

VARIANT 11: Ecommerce Collection Grid — mode light, accent #8b5cf6.
- Layout: 4-column responsive grid (2 on tablet, 1 mobile), product cards with stock indicator (small badge "In Stock · 12 left"), star rating (4.8/5 + count "286 reviews"), price in large font, small tag "Best Seller" or "New."
- Content: Fashion/lifestyle ecommerce (fictional brand Luxio). 8 products: "Merino Crew Neck Sweater" ($87.50, "New"), "Canvas Weekender Tote" ($164, "Best Seller"), "Linen Unisex Overshirt" ($142, "In Stock · 4 left"), "Japanese Selvedge Denim" ($198, "In Stock · 18 left"), etc. Real prices, stock counts, ratings. Hover lifts card + deepens shadow.

VARIANT 12: Agency Case Studies — mode cream, accent #6366f1.
- Layout: Wide rows, each row a horizontal card (image/gradient left, text + logo right, 60/40 split), 1–2 rows visible. On mobile, stacks to single column (image full-width then text). Client logo at top of text section. Swipeable on small screens (can arrow or drag).
- Content: Creative agency (fictional Chromatic Studio). 3 case studies: "Brandmark • Fashion Collective Rebrand" (6-month project, 18M impressions first quarter), "NeonCorp • SaaS Product Launch" (3 integrated campaigns, 47% CTR), "Artisan Goods • DTC Growth" (email + socials, 312% ROAS). Each: project name, scope, one key metric, color accent. Copy: strategic, results-focused.
```

---

## 12. FAQ Section Variants 07-12 — `faq` (variants 07–12)

New variants: `7` Dark Terminal _(dark)_ · `8` Cream Wellness _(cream)_ · `9` Dark Finance _(dark)_ · `10` Light Agency _(light)_ · `11` Cream Minimal _(cream)_ · `12` Dark Product _(dark)_

```
## Prompt — FAQ (6 new sections)

Brief: Produce 6 distinct FAQ sections for diverse industries (devtools, wellness, fintech, agency, creator, product) at premium SaaS standard. Each is a self-contained <section>, uses :root design tokens, varies mode (dark/light/cream) and layout archetype, includes real-world copy with specific metrics and fictional brand names.

SHARED (all 6): Single <section data-sec="faq-0N"> root element. <head> carries Tailwind CDN (stripped at ingest) + Google Fonts preconnect/css2. All styling in one <style> with :root{} token block holding --accent, --accent-rgb, --accent-ink, --surface, --surface-2, --ink, --ink-soft, --border, --radius, --font-display, --font-body. Paint everything via var(...); raw hex only for structural shadows. Mobile-responsive 360px+, lift-on-hover buttons (translateY -1.5px, 80-150ms). Icons/SVG inline with currentColor. Image placeholders as gradients from var(--accent). Real copy, no Lorem; non-round metrics; believable names. ONE mode per variant. Full-bleed-friendly max-width 1180px container.

VARIANT 07: Dark Terminal — mode dark, accent #10b981 (emerald).
- Layout: Narrow (<max-w-3xl>) monospace-accented accordion. Questions in font-mono with [bracket]-style prefix. Borders styled like terminal frames (1px solid var(--border)). Answer text small, tight line-height. Subtle bg-only open state (no card elevation).
- Content: Developer tools context. Use brand "CodeStream" (real-time collab IDE). Copy about API rate limits, webhook retries, client library versions, streaming performance: "Why do retries count toward rate limits?" "Can we use streaming for large payloads?" Metrics: 2M reqs/min, 144-hour replay window, <12ms p99 latency. Include engineer names (Kara Chen, Dmitri Volkov).

VARIANT 08: Cream Wellness — mode cream, accent #d97706 (amber).
- Layout: 2-column grid on md+. Soft rounded cards (border-radius: 24px) with light border. Hand-drawn SVG dividers between Q and A (not rules—actual squiggles/curves inline). No shadows; color alone distinguishes cards. Hover: subtle scale (1.02) only.
- Content: Wellness app context. Brand "Flourish" (habit tracking + therapy). Copy warm and reassuring. Questions: "Is my meditation history encrypted?" "Can I share progress with my partner?" "What happens to my data if I pause?" Real specifics: 47-day average engagement, 180-day free archive, end-to-end encryption at rest. Names: Layla Martinez, Dr. James Whitmore.

VARIANT 09: Dark Finance — mode dark, accent #06b6d4 (cyan).
- Layout: 2-column on lg+. Left sticky (lg:sticky lg:top-12) progress/timeline column: 4 vertical milestones (Security, Compliance, Integration, Support) with checkmarks and % complete badges. Right: accordion. Each accordion item has a numeric KPI badge (e.g., "99.99%", "$0.0012/tx"). Open accordion items highlight matching milestone on left.
- Content: Fintech: "PayVault" (B2B payment processing). Enterprise-speak but human. Questions on SLA, PCI-DSS, webhook delivery, settlement: "What's your PCI-DSS compliance level?" "How fast do settlements clear?" Metrics: 99.99% uptime, <200ms latency, 47 compliance certifications. Names: Sarah Chen (VP Security), Michael Rodriguez.

VARIANT 10: Light Agency — mode light, accent #f97316 (orange).
- Layout: Horizontal carousel. Show 1 group of 3-4 FAQs at a time on mobile, 4 on lg+. Dot pagination below (filled/unfilled circles). Next/prev arrows (or swipe gesture detection). Each slide: eyebrow + title + 3 cards (no accordion, all visible). Smooth scroll-snap or CSS transform transition.
- Content: Agency/ecommerce: "Momentum Studio" (design + e-commerce platform). Copy spans Design Services, Platform Features, Client Success. Real brands mentioned: Shopify, Webflow integrations. Questions: "Do you offer unlimited revisions?" "What's your retainer discount?" "Can you scale to 10K products?" Metrics: 340+ live shops, 2.1B/month in GMV facilitated, 48h turnaround. Names: Marcus Thompson, Nina Patel.

VARIANT 11: Cream Minimal — mode cream, accent #1f2937 (slate).
- Layout: Fully asymmetric. No grid. Large serif headline (Georgia or Crimson). Questions as hanging-indent paragraphs: question text starts flush-left, answer is indented 2rem and set in small sans. Each QA pair separated by single blank line (no rules). Minimal eyebrow. Max-width 65ch.
- Content: Creator platform: "Prism" (creator memberships + paywall). Copy sophisticated but conversational. About: "How do I price my tier?" "Can members download all posts?" "When do I get paid?" Metrics: 89K active creators, $47M/year paid out, 34% average member retention. Names: Alex Okonkwo, Elena Vasquez.

VARIANT 12: Dark Product — mode dark, accent #22d3ee (cyan-light).
- Layout: Two-column grid (1 col on md-). Left: category icon badge (12 categories) + question. Right: short answer + context tag. No accordion—all open. Icon badges use inline SVG (circle with filled icon: lock, zap, users, etc). Hover entire row: bg shifts (bg-surface-2), border glows slightly var(--accent).
- Content: Modern SaaS: "Flux" (real-time data platform). Technical but accessible. Categories: Integration, Security, Performance, Pricing. Questions on connectors, data freshness, pricing tiers: "Which databases do you support?" "How fresh is the real-time data?" "Is there a free tier?" Metrics: 240+ connectors, <50ms update latency, 12,000+ orgs. Names: Priya Desai, Jordan Smith.
```

---

## 13. About — `about` (variants 07–12)

New variants: `7` Team Gallery _(dark)_ · `8` Horizontal Timeline _(cream)_ · `9` Stacked Narrative _(dark)_ · `10` Right-Aligned Visual Split _(light)_ · `11` Editorial Serif Manifesto _(cream)_ · `12` Expandable Sections _(dark)_

```
## Prompt — About (6 new variants, 07–12)

Brief: Produce 6 distinct, production-quality About sections for premium SaaS/fintech/creator platforms (Stripe, Linear, Loom, Figma, etc.). Each is a single <section> with :root design tokens, full mobile responsiveness, and real, specific copy — no Lorem ipsum.

SHARED (all 6): Single <section> root element. Head includes Tailwind CDN + Google Fonts preconnect/css2. All color/border/radius/font painted with :root tokens (--accent, --accent-rgb, --accent-ink, --surface, --surface-2, --ink, --ink-soft, --border, --radius, --font-display, --font-body). Layout max-width ~1180px. Mobile responsive from 360px. Button hover: translateY lift + ease 80–150ms. No raw hex except neutral shadows. No images, no Lorem ipsum, no generic phrases. Real metrics (e.g., 2,847 not 2.8K; $0.0047). Believable fictional brands + names. No data-slot-path, no React/JSX, vanilla JS only if essential. Each variant is a distinct artifact, mode per variant, one root element in <body>.

VARIANT 07: Team Gallery — mode dark, accent #6366F1.
- Layout: 2-column or 3-column grid of team member cards (photo placeholder gradient, name, role title, one-line bio).
- Content: Fintech SaaS team (Meridian, a payments API company). Include CEO, CTO, design lead, customer success manager. Each card has role and a personality-driven bio line. Use card hover lift. Show full team of ~12 people (scrollable or 2 sections if needed).

VARIANT 08: Horizontal Timeline — mode cream, accent #D97706.
- Layout: Horizontal card carousel or stacked row of milestone moments. Each card is a year + major event (founding, seed, Series A, IPO prep, etc.). Minimal icons or badges per card. Swipe/scroll-friendly on mobile.
- Content: Creator-focused SaaS (Lumina, an AI animation tool). Milestones: 2021 founded, 2022 $1.2M seed, 2023 10K creators, 2024 enterprise deals, 2025 Series B close ($18M). Tone: celebratory, forward-looking.

VARIANT 09: Stacked Narrative — mode dark, accent #EC4899.
- Layout: Three full-width stacked sections: (1) hero stat + context (e.g., "4.8B transactions secured"), (2) company story paragraph block, (3) team size + 3 callout values.
- Content: B2B cybersecurity (Aegis, a zero-trust platform). Hero: "4.8B transactions secured in 180 days." Story: Founding team burned out on fragmented auth. Now 41 people across 4 regions. Three values: "Security is invisible," "No magic, only math," "Your enemies drive us."

VARIANT 10: Right-Aligned Visual Split — mode light, accent #0EA5E9.
- Layout: Left half = copy block (heading + 2 paragraphs). Right half = gradient visual (similar to Variant 01, but mirrored/right-aligned). Asymmetric grid.
- Content: eCommerce/logistics (Dispatch, an order optimization engine). Left copy: founding story, team size, customer wins. Right visual: gradient overlay with icon or subtle grid pattern. Include one stat callout inline in copy.

VARIANT 11: Editorial Serif Manifesto — mode cream, accent #8B5CF6.
- Layout: Long-form text (serif display font + body serif). Minimal visual decoration. Centered, max-width prose. No image, no grid, no cards — pure editorial.
- Content: Design/education tool (Figcraft, teaching AI-assisted design). Multi-paragraph manifesto on why design should be accessible. Names co-founders. Tone: reflective, thoughtful. Use em/strong sparingly. One small divider line mid-section.

VARIANT 12: Expandable Sections — mode dark, accent #10B981.
- Layout: Accordion-style: 4 collapsible sections (Founding story / Our values / The team / What's next). Each section expands to reveal content. Only one open at a time (optional). Icons or chevrons signal state.
- Content: HR/fintech/SaaS hybrid (Compass, payroll + benefits for startups). Each section: "Founding story" (how co-founders met), "Our values" (2–3 bullet points), "The team" (team count, hiring plan), "What's next" (2026 roadmap). Use bullet points or nested text in expanded sections.
```

---

## 14. Team — `team` (variants 07–12)

New variants: `7` Leadership Timeline _(dark)_ · `8` Contributor Spotlight _(light)_ · `9` Split-Screen Culture _(cream)_ · `10` Roles & Expertise _(dark)_ · `11` Open Positions + Team _(light)_ · `12` Journey & Impact _(cream)_

```
\`\`\`
## Prompt — Team (6 sections)

Brief: Produce 6 distinct Team section variants for premium SaaS/fintech/agency/creator contexts at the level of Linear/Vercel/Stripe/Retool. A single <section> with :root tokens, varied modes, real copy, believable metrics.

SHARED (all 6): Each variant is a standalone text/html artifact with one <section> root. Tailwind CDN in <head> for preview (dropped at ingest). ALL custom CSS in one <style> block with :root{} holding design tokens: --accent, --accent-rgb, --accent-ink, --surface, --surface-2, --ink, --ink-soft, --border, --radius, --font-display, --font-body. Paint all brand color/borders/fonts with var(...). Responsive from 360px. Lift-on-hover buttons (translateY, 80-150ms). No external images, no Lorem ipsum, real copy + specific metrics (18,420 not 18K). Mobile-friendly.

VARIANT 07: Leadership Timeline — mode dark, accent #06b6d4 (cyan).
- Layout: Vertical timeline with person cards rotating left/right alternation; connects with dashed line; hover scales card and reveals minimal bio stripe below name.
- Content: FinTech startup (Kapital, 12-person team); Marcus Okafor (Founder), Sophia Chen (VP Eng, shipped 3 microservices), Liam Grant (Head of Risk, 7 years crypto derivatives), Elena Popescu (Design Lead, ex-Stripe design systems); real accomplishments and locations (Singapore/NYC/Berlin/São Paulo).

VARIANT 08: Contributor Spotlight — mode light, accent #f97316 (orange).
- Layout: Hero left (large initials + gradient, 55% width on desktop); bio card overlays initials; stacked role cards stack right of hero.
- Content: Creative agency (Bloom Studio, 24 people); feature "Kai Nakamura, Creative Director" with a real anecdote; role stack shows "Art Director (4y)", "Motion (8y)", "Mentors 3"; non-round metrics (1,247 projects shipped, $8.2M ARR).

VARIANT 09: Split-Screen Culture — mode cream, accent #8b5cf6 (purple).
- Layout: Left side: "Our values" as 3-4 text blocks (Bias for Action, Async-first, Margin for Craft); right side: 3x2 mini profile grid (circular avatars + name + one-line descriptor).
- Content: B2B wellness platform (Plume); team is product-focused; values tie to hiring + culture; people: Anita Mukherjee (People Lead), Jun Park (Founding Eng), others in support/growth/data roles.

VARIANT 10: Roles & Expertise — mode dark, accent #ec4899 (pink).
- Layout: Three role pillars displayed as cards (e.g., "Infrastructure", "Product", "Design"); each card lists 2-3 people + expertise badges (Rust, React, Figma, PostgreSQL, etc.) below their names.
- Content: DevTools company (Forge CLI); team is 18 people spread across specialties; show non-round headcounts (6 infrastructure people vs 5 product, etc.); emphasize skill depth (12 yrs avg tenure in infra).

VARIANT 11: Open Positions + Team — mode light, accent #06b6d4.
- Layout: Top section: "6 open roles" as 3 role cards (Founding Backend, Product Manager, DevRel) with apply CTA; bottom: 4-column grid of current team + filled team members (no hiring cards mixed in).
- Content: Series B data analytics startup (Prism); hiring for growth; team photos with roles; real open reqs (Founding Backend: Postgres/Kubernetes, $200k-280k; Product Manager: B2B SaaS, SF).

VARIANT 12: Journey & Impact — mode cream, accent #6366f1 (indigo).
- Layout: Three "story cards" in a row: each has a small profile photo (or initials), name, title, and one key metric below (e.g., "Jamie: 412k lines of code reviewed", "Zara: $4.1M revenue influenced", "Naveen: 27 migrations led"). Soft connector lines between cards.
- Content: Fintech scaling company (Momentum); celebrate individual impact; bios are achievement-focused; real metrics from startup context (customer retention improvements, security audits, onboarding velocity).
\`\`\`
```

---

## 15. Contact — `contact` (variants 07–12)

New variants: `7` Dark Mission _(dark)_ · `8` Warm Team _(cream)_ · `9` Dark Minimal _(dark)_ · `10` Light Booking _(light)_ · `11` Cream FAQ _(cream)_ · `12` Dark Tabs _(dark)_

```
## Prompt — Contact (6 sections)

Brief: Produce 6 distinct Contact sections for varied industries (fintech, wellness, creator, agency, ecommerce, devtools), dark/light/cream modes, at the level of Stripe/Vercel/Linear/Slack.

SHARED (all 6): Single <section> root element with :root design tokens (--accent, --accent-rgb, --accent-ink, --surface, --surface-2, --ink, --ink-soft, --border, --radius, --font-display, --font-body). All colors/borders/radius/fonts use var(...). Responsive 360px+. Lift-on-hover buttons (translateY, 80-150ms). Real copy (no Lorem; specific metrics like $2,847/mo or 18,924 accounts, believable names). Inline SVG for icons. Image placeholders use accent-based gradients. One mode per variant. Standalone, self-contained, polished. Tailwind utilities for layout; :root tokens for brand/design.

VARIANT 07: Dark Mission — mode dark, accent #00d9ff.
- Layout: Dark navy/slate background. Left sidebar (40% width) holds mission statement + values, vertical divider. Right side (60%) has form (Name, Email, Topic dropdown, Message). Lift form up with subtle shadow.
- Content: Fintech bank. Mission statement: "Banking for the next trillion. We're obsessed with settlement speed and customer trust." Three values: "8.4ms avg settlement" | "99.97% uptime" | "Zero-knowledge proof integration". Form for partnerships/integrations. Real brand: OmniBank, contact person: Dr. Raj Mehta.

VARIANT 08: Warm Team — mode cream, accent #d4691e.
- Layout: Warm cream background (#faf5f0). Left side organic/staggered text (headline, subhead, contact copy) with off-center placement. Right side: 2x2 grid of circular team photos (placeholder gradients, overlapping slightly). Full-bleed on mobile, grid + stagger on tablet+.
- Content: Wellness/coaching brand. Headline: "Your growth coach is 3 minutes away." Copy: "We match you with a certified wellness architect based on your goals — not templates." Team: Dr. Elena Vasquez, Hiroshi Tanaka, Sophie Mercier, Marcus Webb. Form: Name, Email, Health focus dropdown (Nutrition / Sleep / Performance), a message. Metric: "2.1k successful transformations this quarter".

VARIANT 09: Dark Minimal — mode dark, accent #fbbf24.
- Layout: Centered, max-width 520px. Huge serif headline (Playfair or similar, 48px): "Let's build something beautiful together." Below: single-line email input (yellow pill button inline or below). Below input: three trust badges in a row: "Est. 2019" | "7,418 happy creators" | "Built by designers, for designers." Dark charcoal background, yellow accent.
- Content: Creator/design tool brand. Headline suggests artistry. Email placeholder: "your_email@studio.com". Button: "Get early access" or "Request invite". Specific copy: "1,247 design teams are creating 40% faster".

VARIANT 10: Light Booking — mode light, accent #7c3aed.
- Layout: Light surface with subtle border. Left two-thirds: standard contact form (Name, Email, Company, Project scope textarea). Right one-third: mini calendar widget showing next 14 days, small "Pick a slot" heading. Calendar cells clickable/highlighted. On mobile, calendar stacks below form.
- Content: SaaS implementation services. Headline: "Get hands-on help from our experts." Form fields suggest project planning. Calendar copy: "Calendars auto-sync with our team. We'll confirm within 2 hours." Metric: "Average project duration: 8.3 weeks. 94% on-time delivery."

VARIANT 11: Cream FAQ — mode cream, accent #ec4899.
- Layout: Cream background. Two-column grid. Left: accordion FAQ (5 items open/close: "How do you price?", "What's the onboarding timeline?", etc.). Right: contact form (Name, Email, Phone, Message, checkbox for "I have a custom budget"). Form slightly raised with subtle shadow.
- Content: Ecommerce platform. FAQ answers are specific (e.g., "We charge per transaction, no monthly minimum. Our median partner saves $12k monthly."). Form: "Ready to launch?" Hero metric: "Powering 18,924 e-commerce brands, $47B in GMV processed this year."

VARIANT 12: Dark Tabs — mode dark, accent #06b6d4.
- Layout: Dark background. Heading + three tab buttons (Sales | Support | Partnerships), styled as outlined pills. Below: content panel that switches based on tab. Sales tab shows: "Let's talk numbers" form. Support tab shows: "Describe your issue" form + FAQ links. Partnerships tab shows: "Co-market together" form + partner logos grid. Light on mobile (stack tabs vertically or as segmented control).
- Content: Devtools platform. Sales: company size, budget, use case. Support: issue category dropdown, attachment note, ticket ID example. Partnerships: co-marketing budget, expected reach, timeline. Real metric: "1,200+ enterprise partners". Accent cyan.
```

---

## 16. CTA section variants 07-12 — `cta` (variants 07–12)

New variants: `7` Wellness Stacked Testimonial _(light)_ · `8` Feature Cards Grid _(dark)_ · `9` Creator Split Showcase _(cream)_ · `10` Fintech Pricing Table Toggle _(dark)_ · `11` Product Screenshot Badge _(light)_ · `12` Developer Code Snippet Dark _(dark)_

```
## Prompt — CTA (6 new variants, 07–12)

Brief: Produce 6 distinct CTA sections for premium SaaS/fintech/creator platforms. Each is a self-contained <section> with :root tokens, varied modes (light/dark/cream), real copy, concrete industries. Target: Linear/Stripe/Figma/Notion/Paddle/Loom aesthetic.

SHARED (all 6): Single <section> root element in <body>. <head> carries Tailwind CDN + Google Fonts (preconnect + css2). All custom CSS in <style> with :root{} holding design tokens: --accent, --accent-rgb (space-separated), --accent-ink, --surface, --surface-2, --ink, --ink-soft, --border, --radius, --font-display, --font-body (+ --font-mono if used). Use var(...) for all color/border/radius/font (no raw hex except shadows). Tailwind utilities OK. Mobile-responsive 360px+. Buttons lift on hover (translateY, 80–150ms ease). SVG icons inline, Lucide-style. Image placeholders are gradients built from var(--accent), NOT external URLs. Real, specific copy (no lorem, no generic phrases; use non-round metrics like 8,742 or $0.0185). Believable fictional brands/names. Minimal code (vanilla JS only if needed). One mode per variant. Full-bleed friendly (max-width ~1180px container). Label as "Variant 07: <Name>", etc.

VARIANT 07: Wellness Stacked Testimonial — mode light, accent #06B6D4 (teal).
- Layout: Vertical stack; gradient background (teal→white); floating testimonial card overlay with quote + avatar + attribution.
- Content: Meditation/wellness app. Headline: "Join 287K who meditated today." Subheadline: "Your mind deserves 10 minutes." Quote from "Maya Chen, Headspace coach" about anxiety relief. Two-step signup: email + "Free 7-day" button. Real metric: "Avg. streak: 14.2 days." Background gradient: color-mix teal 18% → white.

VARIANT 08: Feature Cards Grid — mode dark, accent #10B981 (emerald).
- Layout: 3-column card grid (stacks on mobile); each card has icon (SVG stroke), heading, description, light border. Intro section above grid.
- Content: eCommerce fulfillment platform. Headline: "Ship smarter, not harder." Cards: "Real-time sync across channels (12K events/sec)" + "Split inventory across warehouses (instant)" + "Automate returns workflows (saves 18hr/week)." Footer CTA: "Start free" button. Dark surface with emerald accents.

VARIANT 09: Creator Split Showcase — mode cream, accent #F97316 (orange).
- Layout: Full-width split; left side: large geometric illustration-as-gradient (orange + peachy), right side: copy + buttons; magazine-style hierarchy.
- Content: Creator monetization platform. Headline: "Turn followers into revenue." Subheadline: "Gumroad-style course hosting + affiliate network + sponsorship toolkit." Callout: "Creators on Orbit earn avg. $3,420/mo." CTA: "Build your course" + secondary link. Orange accent on speech bubble or badge.

VARIANT 10: Fintech Pricing Table Toggle — mode dark, accent #EC4899 (pink).
- Layout: Pricing table with "Bill Annually / Bill Monthly" toggle above; 3–4 tiers; highlight one tier (green or accent shadow). Feature checklist rows, pricing cell right-aligned.
- Content: Payment processor for freelancers. Tiers: Starter ($29/mo, 0 fees first month), Pro ($89/mo, 1.2% processing), Elite (custom, concierge). Features: "Instant payouts", "1099 automation", "Multi-currency", "AI invoice OCR". Real metric: "Processed $18.3B last year." Toggle label styled inline.

VARIANT 11: Product Screenshot Badge — mode light, accent #3B82F6 (blue).
- Layout: Large image placeholder (gradient-filled, 16:9 ratio), floating badge pinned top-right corner (e.g., "⭐ 4.9 on Capterra"), left-aligned copy below/beside, single CTA button + secondary link.
- Content: Project management SaaS. Headline: "See what your team is working on, instantly." Copy: "Real-time timeline + dependency graphs + Slack sync. 7,294 teams collaborate here." Badge text: "Trusted by teams at Figma, Notion, Zapier." Button: "See it live" (link to demo). Blue accent on badge background.

VARIANT 12: Developer Code Snippet Dark — mode dark, accent #A78BFA (purple).
- Layout: Left-aligned copy section + right-aligned monospace code block (dark box, faint scrollbar), minimal layout, lots of whitespace. Code snippet shows API call or SDK usage in JavaScript/Python.
- Content: API platform / backend service. Headline: "Ship in minutes, not sprints." Copy: "One SDK. All your infrastructure." Code: Example curl request (POST to /api/deploy, response shows deployment ID + live URL). Metric: "Avg. deploy: 38 seconds." Button: "Read API docs" (secondary outline). Purple glow on code block hover.
```

---

## 17. Footer — `footer` (variants 07–12)

New variants: `7` Airy Editorial _(light)_ · `8` Structured Corporate _(cream)_ · `9` Illustrated Commerce _(dark)_ · `10` Asymmetric Split _(light)_ · `11` Data-Driven Fintech _(cream)_ · `12` Bold Playful Typo _(dark)_

```
## Prompt — Footer (6 sections)

Brief: Produce 6 distinct Footer sections for varied SaaS/ecommerce/fintech contexts, at the level of Linear/Vercel/Stripe/Resend.

SHARED (all 6): Each variant is a SINGLE <footer> element using :root design tokens. All 6 variants must use Tailwind CDN + Google Fonts <link>, custom CSS in <style> with ONE :root{} token block (--accent, --accent-rgb, --accent-ink, --surface, --surface-2, --ink, --ink-soft, --border, --radius, --font-display, --font-body). Real copy only (no Lorem ipsum, specific metrics like "18,402 servers" or "$0.0127"), fictional brand names and people. Mobile-responsive from 360px, lift-on-hover buttons. Inline SVG icons (Lucide stroke style), gradient placeholders for images (no external URLs). One mode per variant (dark/light/cream). No React/JSX, vanilla JS only if essential.

VARIANT 07: Airy Editorial — mode light, accent #0066cc.
- Layout: Single-column narrative. Large brand statement at top (title + 2-3 sentence story). Centered horizontal divider. Minimal nav: 5 links in a horizontal row. Tight footer: copyright + three legal links right-aligned.
- Content: Brand "Aria" (audio/voice platform). Copy: "Podcast infrastructure for 23,410 creators worldwide. Record, edit, distribute, monetize. Built for humans, powered by AI." Nav: Product, Platform, Resources, Community, Enterprise. Use real creator metrics (download counts, average listener growth).

VARIANT 08: Structured Corporate — mode cream (#f9f7f2), accent #c93c1d.
- Layout: Three equal columns. Left column: brand icon + tagline. Center column: four nav sections in a 2x2 grid. Right column: company info block + legal summary. Dividers between columns.
- Content: Brand "Nexus Capital" (fintech). Copy: "Private credit platform serving $847B AUM across 1,200 institutional investors." Nav structure: Products (Origination, Secondaries, Analytics), Resources (Learning, API Docs, Compliance). Use banking/investment terminology (portfolio, underwriting, due diligence).

VARIANT 09: Illustrated Commerce — mode dark, accent #f97316.
- Layout: Full-width background card container. Topmost: 3-card grid (product feature cards with gradient icon placeholders: "Analytics", "Integrations", "Support"). Below: brand bar. Bottom: two-column link grid. Footer legal bar.
- Content: Brand "Sellify" (ecommerce). Cards highlight: "18,402 active merchants", "1.2M transactions/day", "38 payment gateways". Copy down low: "All-in-one commerce. Sell, ship, succeed." Nav: Selling Tools, Growth, Help.

VARIANT 10: Asymmetric Split — mode light, accent #7c3aed.
- Layout: Two-column asymmetric. Left: large gradient placeholder (color-mix using accent). Right: stacked sections (brand heading, "Ready to grow?" call-to-action with button, 2-column footer nav, copyright bottom). Responsive stacks on mobile.
- Content: Brand "Twine" (creator economy platform). Headline: "Join 9,847 creators growing their audience." CTA copy: "Start for free. No credit card required." Nav: Creator Toolkit, Education, Brand Partners. Use creator/audience growth metrics.

VARIANT 11: Data-Driven Fintech — mode cream (#fffbf0), accent #059669.
- Layout: Top row: three stat boxes (metric + label, e.g., "$2.47T AUM", "4,200+ Funds"). Below: tight two-column grid of links (Product, Resources on left; Company, Legal on right). Minimal copyright footer.
- Content: Brand "Vault" (asset management). Stats: "4,200+ hedge funds", "$2.47T assets managed", "99.98% uptime". Copy: "Institutional-grade infrastructure." Use financial metrics, no hyphens in numbers (2470000000 USD not $2.47B in text).

VARIANT 12: Bold Playful Typo — mode dark, accent #ec4899.
- Layout: Vertical stack. Top: giant brand name (Variant-style heading treatment, 48px+). Left-aligned nav columns below (Product, Company, Resources, etc. in 4 columns). Decorative accent-colored horizontal stripe bar above footer copyright. Bottom: simple legal/copyright.
- Content: Brand "Pulse" (health-tech platform). Playful copy: "Health metrics that actually make sense. Track daily. Thrive weekly." Nav emphasizes agency: Your Dashboard, Community Hub, Learn & Grow, Open Source. Use health/wellness metrics (activity streaks, team challenges).
```

---

