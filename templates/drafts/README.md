# templates/drafts

Draft landing-page templates — generated HTML, not yet registered in the gallery.

These are standalone `<!doctype html>` files. To add one to the DB-backed gallery:

```bash
npm run templates:add -- templates/drafts/<file>.html --id=<slug> --name="..." \
  --family=<slug> --accent=#RRGGBB --mode=<dark|light|cream> --pitch="..." \
  --description="..." --status=published
```

## Local home-service set (2026-05-20)

Five premium marketing pages for local, brick-and-mortar home-service businesses.

| File | Business | Trade | Mode |
|---|---|---|---|
| `01-plumbline.html` | Plumbline | Residential plumbing | light + blue |
| `02-thicket.html` | Thicket | Landscaping & lawn care | warm light + green |
| `03-brightwork.html` | Brightwork | Residential cleaning | light + teal |
| `04-voltline.html` | Voltline | Electrician | dark + amber |
| `05-keystone.html` | Keystone | Home remodeling / GC | cream + slate |

## Nonprofit & cause set (2026-05-20)

Five premium donation/marketing pages for nonprofits and cause organizations.
Shared 13-section skeleton; sticky "Donate" CTA, impact metrics, transparency,
beneficiary stories, donation widget (amount chips + one-time/monthly toggle +
progress bar). Suggested family slug: `nonprofit`.

| File | Org | Cause | Mode | Accent |
|---|---|---|---|---|
| `01-headwaters.html` | Headwaters | River & watershed conservation | light | `#1F6F6A` |
| `02-lantern.html` | Lantern | Childhood literacy | cream | `#D9933A` |
| `03-commontable.html` | Commontable | Food security & community meals | light | `#C44A33` |
| `04-refuge.html` | Refuge | Animal rescue & sanctuary | light | `#6E9166` |
| `05-bulwark.html` | Bulwark | Civil-liberties & legal advocacy | dark | `#E23B3B` |

## Wellness & fitness studio set (2026-05-20)

Five premium marketing pages for brick-and-mortar wellness and fitness studios.
Shared 12-section skeleton + FAQ; weekly schedule rendered as a color-coded grid
(class type, mono times), membership tiers with a "Most popular" anchor, instructor
cards with mono certifications, prominent new-client intro offer, "spots left"
pulse indicator. Suggested family slug: `wellness` (add to `admin-schemas.ts` FAMILY
enum + `families.ts` before registering under it).

| File | Studio | Type | Mode | Accent |
|---|---|---|---|---|
| `01-stillwater.html` | Stillwater | Neighborhood yoga studio | warm cream | `#B5673E` |
| `02-ironside.html` | Ironside | Strength & conditioning gym | dark + steel | `#FF6A2B` |
| `03-poise.html` | Poise | Pilates & barre boutique | light + blush | `#C77B86` |
| `04-crux.html` | Crux | Bouldering & climbing gym | dark + chalk | `#E4C320` |
| `05-solace.html` | Solace | Day spa & thermal bathing | light + eucalyptus | `#4C6B5A` |

## Onchain / Web3 protocol set (2026-05-20)

Five premium marketing pages for crypto-native onchain / web3 protocols (NOT
regulated fintech). Shared 13-section skeleton; heavy Geist Mono — contract-address
pills, onchain stat banners (TVL / volume), audit badges, connect-wallet modal
mockups, network pills, and SDK / Solidity code blocks. Copy stays informational —
mechanism and utility, no token-price hype. Suggested family slug: `onchain` (add to
`admin-schemas.ts` FAMILY enum + `families.ts` before registering under it).

| File | Protocol | Type | Mode | Accent |
|---|---|---|---|---|
| `01-slipstream.html` | Slipstream | Ethereum L2 zk-rollup | dark + blue | `#4F7BFF` |
| `02-keel.html` | Keel | DeFi lending & borrowing | dark + green | `#34D399` |
| `03-plinth.html` | Plinth | Onchain art marketplace | dark editorial + gold | `#D8A848` |
| `04-quorum.html` | Quorum | DAO governance & treasury | dark + indigo | `#7C7CF0` |
| `05-holdfast.html` | Holdfast | Self-custody wallet | dark + amber | `#F0A93C` |

## Connected hardware / devices set (2026-05-20)

Five premium marketing pages for engineered consumer-hardware and connected-device
companies (Apple / Rivian / DJI / Ecobee / Eight Sleep tier) — engineered devices with
specs, firmware and a companion app, NOT DTC consumables (that's the e-commerce family).
Shared 13-section skeleton; industrial-design product shots at a 3D tilt with a radial
glow, mono 2-column hairline spec tables, a "what's in the box" flat-lay, an
exploded-view callout diagram, a companion-app phone/tablet mockup, battery/capacity
gauges, a press/award badge, and a regulatory footer with a mono FCC ID. Inter Display +
Geist Mono throughout. Suggested family slug: `hardware` (add to `admin-schemas.ts`
FAMILY enum + `families.ts` before registering under it).

| File | Product | Type | Mode | Accent |
|---|---|---|---|---|
| `01-roam.html` | Roam | Robotic lawn mower | light + green | `#3C7A3F` |
| `02-lintel.html` | Lintel | Smart-home hub + controller | dark + warm | `#F2755A` |
| `03-loop.html` | Loop | Health + sleep wearable band | dark + violet | `#9B8CFF` |
| `04-sunhouse.html` | Sunhouse | Home solar + battery system | light + warm sun | `#E6952A` |
| `05-skylark.html` | Skylark | Mapping + inspection drone | dark + sky | `#38BDF8` |

## Premium membership creator link-in-bio set (2026-05-24)

Five luxe, intimate link-in-bio pages for premium-membership creators (Substack /
program / membership / masterclass / Patreon-equivalent). Shared 7-section skeleton:
mono eyebrow with member count + pulse-dot, avatar with backlit glow ring,
serif-italic name + handle + 2-line bio, large featured-offer tile (hairline accent
border + inner glow + bullet list with mono check rows + soft-glow CTA), 6-9 link
stack with paid offers first, 3-stat italic microbar, refined line-icon social row,
mono footer with business/agent line. Dark + warm backgrounds (burgundy / aubergine
/ near-black-with-warmth — never cold black). Rose-gold / champagne / muted-pink
accents. Cormorant Garamond italic or Fraunces for display. Adult, poised voice; no
emoji, no exclamation marks. Suggested family slug: `linkbio` (add to
`admin-schemas.ts` FAMILY enum + `families.ts` before registering under it).

| File | Persona | Niche | Mode | Accent |
|---|---|---|---|---|
| `01-maren.html` | maren | Lifestyle / Substack writer | dark + burgundy | `#D89B7C` |
| `02-levk.html` | lev k. | Strength coach / 8-wk program | dark + warm | `#C9A87C` |
| `03-theowren.html` | theo wren | Slow-travel membership | dark + amber | `#D4A658` |
| `04-noorlev.html` | noor lev | Dance + movement intensive | dark + rose | `#C18B92` |
| `05-priyarose.html` | priya rose | 18+ premium content (restrained) | dark + deep-rose | `#B26B7E` |

## Musician link-in-bio set (2026-05-24)

Five link-in-bio pages for musicians and producers — the link a band, DJ, or producer
drops in Instagram bio or Spotify "about". All dark + warm (deep burgundy / navy /
charcoal-with-warmth, never cold pure black). Album-cover energy, music-first. Shared
7-section skeleton: catalog-number eyebrow with pulse-dot, header with inline-SVG mark
(lantern · matterhorn stamp · sunset disc · cassette · AK monogram in score frame) +
handle + 2-line bio, large featured-release tile with custom-SVG album art + mono
tracklist (hairline rules, tabular-nums runtimes, BPM/key column where applicable for
the DJ variant) + streaming badges + pre-order CTA, 6–8 link stack, mono tour/archive
strip (date · city · venue · status — SOLD OUT / TICKETS / FEW LEFT for bands;
catalog-numbered tape archive for the bedroom producer; framed premiere cards for the
composer), social row, mono footer microline with catalog + management contact. Drama
display face (Fraunces · Inter · Cormorant · Crimson Pro) paired with Inter body +
Geist Mono for catalog numbers, BPM and runtime. Family slug: `music` (already in
`families.ts`).

| File | Persona | Genre | Mode | Accent |
|---|---|---|---|---|
| `01-lanternhollow.html` | lantern hollow | Gothic-folk band (4-piece) | dark + burgundy | `#E0A156` |
| `02-matterhorn.html` | matterhorn | Minimal techno DJ + label head | dark + cream | `#F4ECD7` |
| `03-kidmireille.html` | kid mireille | Modern soul / R&B | dark + warm brown | `#D89B7C` |
| `04-tapediary.html` | tape diary | Lo-fi jazz / cassette producer | dark + near-black | `#C9B47A` |
| `05-antonkvass.html` | anton kvass | Contemporary classical composer | dark + ink blue | `#5B7C99` |
