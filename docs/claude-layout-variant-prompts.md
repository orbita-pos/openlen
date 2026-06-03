# Layout-variant batch — claude.ai design briefs (give curation LAYOUT variety)

**Why this batch exists.** Curation picks a template + fills copy; the top-3 ranked pick (`pickWeighted`) surfaces alternatives, but two same-brief generations only *feel* different if the templates have genuinely different **layouts**. The existing 39 briefs in `claude-design-prompts.md` produce 5 variants on the **same** section skeleton (similar layout, different content/color) — so a family's templates look alike structurally. These briefs instead produce 5 variants on **5 distinct LAYOUT ARCHETYPES**, so re-generating "hotel boutique en Tulum" can land on a hero-left, a centered, or a full-bleed design — all polished, no runtime mutation.

This is the professional, reliable path (Tailwind UI / Aceternity / Framer all do variety via many hand-crafted layout variants, not runtime structural edits).

## How to use (same flow as `claude-design-prompts.md`)
1. claude.ai → New chat → Opus 4.7 (or current).
2. Paste the **Shared output constraints** block from `claude-design-prompts.md` (the premium-landing one) — ONCE.
3. Paste the **Layout archetypes** block below — ONCE.
4. Paste **one family brief** below. claude.ai produces **5 layout-diverse artifacts** (Variant A–E).
5. Download each `.html`, hand them here → `npm run templates:add`. They'll auto-pick up real OpenLen photos via the photo-migration (the archetypes leave clear photo slots).

`redo variant C as [change]` regenerates just one. "continue with variant D" if it runs long.

---

## Layout archetypes — paste ONCE (after the shared constraints)

```
LAYOUT ARCHETYPES — this conversation produces FIVE pages, one per archetype (A–E).
Same aesthetic + same content depth across all five; ONLY the LAYOUT/STRUCTURE differs.
Each is a complete, premium landing page (nav → hero → trust → features → secondary
feature → social proof/pricing → FAQ → CTA → footer). Make the differences OBVIOUS — a
designer should see five distinct compositions, not five recolors.

PHOTO SLOTS (important): wherever a page shows a hero/feature/gallery VISUAL, make it a
CLEAR full-bleed cover slot we can drop a real photo into later:
  <svg class="absolute inset-0 w-full h-full" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">…abstract gradient placeholder…</svg>
  (or a <div class="absolute inset-0 … bg-gradient-to-br">). Its parent must be `relative
  overflow-hidden` with a fixed aspect (e.g. aspect-[4/3], or absolute inset-0 in a sized
  hero). If text overlays a visual, add a sibling dark→transparent scrim div for legibility.
  Do NOT bake a literal product drawing into these — keep them abstract placeholders.

THE FIVE ARCHETYPES:
A — SPLIT HERO, visual RIGHT. Hero is a 2-col grid: left = eyebrow + display headline +
    sub + dual CTA + small inline hint; right = a large cover-slot visual (1fr:1.1fr).
    Body: alternating left/right feature rows (text/visual flip each row). Pricing as 3 cards.
B — SPLIT HERO, visual LEFT (mirror of A). Hero visual on the left, copy on the right.
    Body: a BENTO features grid (one large tile + smaller tiles), each tile self-contained.
    Social proof = testimonial wall (3-col quote cards).
C — CENTERED HERO + full-width band. Hero copy centered (badge + headline + sub + single
    primary CTA + secondary text link), then ONE full-width cover-slot visual band below the
    fold. Body: stacked centered sections + a 3-up card grid + a logo marquee.
D — FULL-BLEED HERO. Hero = a full-viewport cover-slot visual with overlaid copy
    (bottom-left or centered) over a dark scrim. Body: overlapping/floating cards that break
    the grid, a gallery-style 2–3 col visual grid (each cell a cover slot), sticky side rail.
E — EDITORIAL / ASYMMETRIC. Magazine feel: oversized offset headline, an asymmetric hero
    (one large cover slot + one small, unequal columns, generous whitespace), numbered
    section markers (01 / 02 …), index-style nav, serif display. Body: long-form alternating
    blocks with wide margins.

Label them "Variant A — <name>" … "Variant E — <name>". Five separate text/html artifacts.
```

---

## Family briefs (one conversation each)

### Batch L1 — Hospitality (boutique hotels · lodges · cafés)
```
Brief: 5 hospitality landing pages (boutique hotel / coastal lodge / specialty café / inn),
one per layout archetype A–E. Mode: warm light/cream (one dark archetype, e.g. D, for an
after-dark bar/lounge). Fonts: a refined serif display (Fraunces / Souvenir feel) + clean
sans body (Inter). Warm, calm, tactile palette (sand, clay, sage, ink). Content: room/menu
names, a "the rooms"/"the menu" section, a location/hours block, real-sounding reviews,
a reservation CTA (link only, no booking form). Cover slots = interiors, rooms, coastline,
plated food. Make A–E feel like five different properties' sites.
```

### Batch L2 — Real estate (listings · brokerages · developments)
```
Brief: 5 real-estate landing pages (luxury brokerage / new development / vacation rentals /
architect-developer), one per archetype A–E. Mode: 2 dark (gold-on-near-black luxury), 2
light, 1 cream. Fonts: high-contrast serif display + grotesk sans. Content: featured
listing(s) with location + price + sqft, an "open residences" grid, a map/region block,
agent/firm credibility, an inquiry CTA (link only). Cover slots = architecture exteriors,
interiors, coastal/desert homes. D (full-bleed) should feel like a single hero property.
```

### Batch L3 — Food & beverage (restaurants · roasters · brands)
```
Brief: 5 food/beverage landing pages (farm-to-table restaurant / coffee roaster / natural
wine bar / packaged-food brand), one per archetype A–E. Mode: warm cream + 1 moody dark
(wine bar). Fonts: characterful serif/display + clean sans. Content: menu/product highlights
with names + prices, sourcing/story section, hours/location, press quotes, order/reserve CTA
(link only). Cover slots = plated dishes, ingredients, the room, product still-life.
```

### Batch L4 — Travel & outdoors (tours · stays · gear-adjacent experiences)
```
Brief: 5 travel/outdoors landing pages (alpine tours / surf retreats / city guides /
overlanding trips), one per archetype A–E. Mode: 2 dark (dramatic landscapes), 3 light/cream.
Fonts: bold grotesk display + sans body. Content: itinerary/trip cards with destinations +
durations + prices, a "where we go" map/region grid, traveler stories, a booking-inquiry CTA
(link only). Cover slots = mountains, coastlines, destinations, lodges. D = immersive
full-bleed landscape hero.
```

### Batch L5 — Fashion & apparel (brands · lookbooks · boutiques)
```
Brief: 5 fashion/apparel landing pages (slow-fashion label / eyewear / footwear / jewelry),
one per archetype A–E. Mode: 3 light/cream editorial, 2 dark (one stark mono). Fonts: a
fashion serif display (tight, high-contrast) + minimal sans. Content: collection/lookbook
sections, product highlights with names + prices, materials/ethos block, press, shop CTA
(link only). Cover slots = editorial fashion, product still-life, textures. E (editorial)
should read like a lookbook.
```

### Batch L6 — Wellness & fitness (studios · coaches · health)
```
Brief: 5 wellness/fitness landing pages (pilates/yoga studio / strength coaching / wellness
clinic / retreat), one per archetype A–E. Mode: 3 soft light/cream, 2 calm dark. Fonts:
humanist serif or soft grotesk display + sans. Content: class/program cards with schedules +
pricing, a "the practice"/method section, instructor credibility, member stories, a
join/book CTA (link only). Cover slots = lifestyle/movement, studio interiors, nature.
```

### Batch L7 — Agency & studio (creative · design · production)
```
Brief: 5 agency/studio landing pages (brand studio / motion shop / product design agency /
architecture practice), one per archetype A–E. Mode: 3 dark (bold), 2 light/cream editorial.
Fonts: strong grotesk or editorial serif display + mono accents. Content: "selected work"
project tiles (named fictional clients + a one-line result), services, process, team, a
"start a project" CTA (link only). Cover slots = project visuals / abstract 3D (these stay
NEUTRAL — broad family, so reusable abstract works best). Make A–E distinct compositions.
```

### Batch L8 — Portfolio (designers · photographers · creators)
```
Brief: 5 portfolio landing pages (brand designer / photographer / illustrator-for-hire /
multidisciplinary creator), one per archetype A–E. Mode: mix (2 dark, 2 light, 1 cream).
Fonts: editorial serif or refined grotesk + mono captions. Content: a work grid/index with
named pieces, an about/bio block, selected clients, a contact CTA (link only). Cover slots =
work thumbnails / creator-mockup style. Keep per-piece labels generic enough that a photo
swap won't mislabel a specific named work.
```

### Batch L9 — Ecommerce & product brands (DTC)
```
Brief: 5 DTC product landing pages (skincare / home goods / coffee gear / accessories), one
per archetype A–E. Mode: 3 light/cream, 2 dark (premium). Fonts: clean grotesk display +
sans. Content: hero product story, a product/collection grid with names + prices, an
ingredients/materials block, reviews with ratings, a shop CTA (link only). Cover slots =
product still-life, lifestyle. Keep product-card visuals as generic "product" slots, not a
specific named SKU drawing, so photo swaps stay correct.
```

### Batch L10 — SaaS & product (broad — neutral visuals)
```
Brief: 5 SaaS/product landing pages (analytics / scheduling / CRM-lite / collaboration), one
per archetype A–E. Mode: 3 dark, 2 light. Fonts: Inter/grotesk display + mono for metrics.
Content: product value prop, a bento feature grid, a dashboard-mockup secondary feature,
pricing (3 tiers, non-Free/Pro/Enterprise names), FAQ, "start free" CTA (link only). Cover
slots = ABSTRACT 3D / gradient only (broad family — reusable neutral visuals, never a
specific product photo). The variety here is layout (A–E) + the abstract hero treatment.
```

---

**Notes**
- After generating, hand the HTMLs here → `templates:add` with the right `--family`/`--mode`. The photo-migration (`templates-export` → agent fit → `photo-validate` → `photo-republish`) fills the cover slots with matched OpenLen photos for the narrow families and neutral abstract for the broad ones.
- Want more families (event, wedding, music, gaming, podcast, nonprofit, education)? Same pattern — copy a brief, swap the aesthetic + content direction, keep "one per archetype A–E".
- These produce ~50 layout-diverse pages (10 families × 5 archetypes); curation's top-3 pick then has genuinely different layouts to choose among per family.
```
