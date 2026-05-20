// Source-of-truth metadata for the "Imagenes by OpenLen" set.
//
// 110 entries, paired by index with the PNGs in Downloads/img-chatgpt sorted by
// file mtime (= generation order = prompt order). Prompt #19 (brutalist
// concrete) was skipped during generation, so promptNum runs 1..111 with a gap
// at 19 — 110 images total.
//
// `family` values reference TemplateFamily slugs in lib/templates/families.ts
// so the image picker can filter by the active template's family directly.
//
// To add a batch: append entries below in prompt order, bump the sanity-check
// count, drop the new PNGs into Downloads/img-chatgpt, re-run process.ts.

import type { TemplateFamily } from "../../lib/templates/families";

export type ImageStyle = "3d-abstract" | "claymorph" | "fashion-editorial";

export interface ImageMeta {
  promptNum: number;
  slug: string;
  style: ImageStyle;
  family: TemplateFamily[];
  alt: string;
}

export const IMAGE_META: ImageMeta[] = [
  { promptNum: 1,  slug: "warm-glassy",         style: "3d-abstract",      family: ["saas", "portfolio"],                       alt: "Three floating frosted glass forms in warm peach gradient" },
  { promptNum: 2,  slug: "chrome-ribbon",       style: "3d-abstract",      family: ["agency", "ecommerce", "editorial"],        alt: "Liquid chrome ribbon sculpture in neutral cream studio" },
  { promptNum: 3,  slug: "dark-aurora",         style: "3d-abstract",      family: ["ai-ml", "technical-minimal"],              alt: "Glowing wireframe form in deep aurora indigo-magenta gradient" },
  { promptNum: 4,  slug: "clay-primitives",     style: "3d-abstract",      family: ["saas", "portfolio"],                       alt: "Cluster of pastel clay primitives in warm peach scene" },
  { promptNum: 5,  slug: "crystalline-shards",  style: "3d-abstract",      family: ["ecommerce", "editorial"],                  alt: "Tight cluster of translucent amber and rose crystal shards on dark taupe" },
  { promptNum: 6,  slug: "liquid-mercury",      style: "3d-abstract",      family: ["technical-minimal", "ai-ml"],              alt: "Iridescent mercury pool with suspended droplets on deep charcoal" },
  { promptNum: 7,  slug: "bokeh-aurora",        style: "3d-abstract",      family: ["portfolio", "editorial"],                  alt: "Warm sunset bokeh particles drifting through volumetric haze" },
  { promptNum: 8,  slug: "brushed-tiles",       style: "3d-abstract",      family: ["documentation", "technical-minimal"],      alt: "Isometric grid of brushed aluminum tiles with raking sidelight" },
  { promptNum: 9,  slug: "draped-silk",         style: "3d-abstract",      family: ["ecommerce", "editorial"],                  alt: "Champagne silk fabric draped over unseen form, macro detail" },
  { promptNum: 10, slug: "topo-layers",         style: "3d-abstract",      family: ["fintech", "saas", "ai-ml"],                alt: "Stacked translucent topographic layers in cool teal and navy" },
  { promptNum: 11, slug: "neon-tunnel",         style: "3d-abstract",      family: ["ai-ml", "editorial"],                      alt: "Cinematic volumetric tunnel of light receding into magenta vanishing point" },
  { promptNum: 12, slug: "marble-sculpture",    style: "3d-abstract",      family: ["agency", "portfolio", "editorial"],        alt: "Abstract Carrara marble sculpture in warm gallery sweep" },
  { promptNum: 13, slug: "iridescent-wave",     style: "3d-abstract",      family: ["saas", "ai-ml", "editorial"],              alt: "Frozen iridescent fluid wave arching across deep navy" },
  { promptNum: 14, slug: "cool-glassy",         style: "3d-abstract",      family: ["fintech", "saas"],                         alt: "Floating frosted glass forms in cool ice-blue to slate gradient" },
  { promptNum: 15, slug: "folded-paper",        style: "3d-abstract",      family: ["agency", "portfolio", "editorial"],        alt: "Sculptural origami-like folded paper form in warm ivory" },
  { promptNum: 16, slug: "light-ribbon",        style: "3d-abstract",      family: ["technical-minimal", "saas", "ai-ml"],      alt: "Glowing ribbon of light tracing an S-curve through dark ink-blue fog" },
  { promptNum: 17, slug: "botanical-macro",     style: "3d-abstract",      family: ["health-tech", "ecommerce"],                alt: "Backlit translucent botanical leaves catching golden hour sun" },
  { promptNum: 18, slug: "stacked-stones",      style: "3d-abstract",      family: ["health-tech", "editorial"],                alt: "Stacked smooth river stones in soft warm light, wabi-sabi" },
  // promptNum 19 (brutalist concrete) was skipped during generation
  { promptNum: 20, slug: "cloud-forms",         style: "3d-abstract",      family: ["health-tech", "editorial"],                alt: "Soft volumetric pastel cloud forms drifting in sunrise sky" },
  { promptNum: 21, slug: "water-droplet",       style: "3d-abstract",      family: ["health-tech", "ecommerce"],                alt: "Hyper-real macro of a crystal water droplet on translucent surface" },
  { promptNum: 22, slug: "confetti-burst",      style: "3d-abstract",      family: ["event", "pre-launch"],                     alt: "Frozen mid-air burst of colorful confetti and curling ribbons" },
  { promptNum: 23, slug: "light-beam",          style: "3d-abstract",      family: ["saas", "agency", "editorial"],             alt: "Dramatic warm light beam cutting diagonally through volumetric fog" },
  { promptNum: 24, slug: "sound-wave-bars",     style: "3d-abstract",      family: ["saas", "portfolio", "editorial"],          alt: "3D equalizer landscape of vertical bars in warm magenta-to-yellow gradient" },
  { promptNum: 25, slug: "holographic-plinths", style: "3d-abstract",      family: ["fintech", "technical-minimal", "ai-ml"],   alt: "Floating crystal plinths in cool cyber space with subtle grid" },
  { promptNum: 26, slug: "paper-map",           style: "3d-abstract",      family: ["hospitality", "portfolio", "editorial"],   alt: "Folded warm paper map abstraction with soft topographic creases" },
  { promptNum: 27, slug: "marble-swirl",        style: "3d-abstract",      family: ["ecommerce", "editorial"],                  alt: "Macro of swirling marbled oil pattern in burgundy and champagne" },
  { promptNum: 28, slug: "orbs-velvet",         style: "3d-abstract",      family: ["ecommerce", "editorial"],                  alt: "Cluster of glass orbs resting on deep emerald velvet fabric" },
  { promptNum: 29, slug: "pastel-landscape",    style: "3d-abstract",      family: ["saas", "portfolio", "editorial"],          alt: "Stylized mini 3D landscape with pastel hills, abstract sun, soft clouds" },
  { promptNum: 30, slug: "iridescent-threads",  style: "3d-abstract",      family: ["ecommerce", "editorial", "agency"],        alt: "Macro of woven iridescent threads with oil-slick shimmer on dark warm" },
  { promptNum: 31, slug: "person-at-desk",      style: "claymorph",        family: ["saas", "portfolio"],                       alt: "Stylized claymorph character at floating desk with laptop, lavender skin" },
  { promptNum: 32, slug: "two-collaborating",   style: "claymorph",        family: ["saas", "agency"],                          alt: "Two claymorph characters pointing at floating holographic screen between them" },
  { promptNum: 33, slug: "climbing-platforms",  style: "claymorph",        family: ["saas", "editorial"],                       alt: "Claymorph character climbing diagonal floating pastel platforms toward abstract sun" },
  { promptNum: 34, slug: "meditating",          style: "claymorph",        family: ["health-tech"],                             alt: "Claymorph character meditating cross-legged on cloud-like platform" },
  { promptNum: 35, slug: "group-celebration",   style: "claymorph",        family: ["event", "pre-launch", "saas"],             alt: "Four claymorph characters celebrating with arms raised and frozen confetti" },
  { promptNum: 36, slug: "reading",             style: "claymorph",        family: ["editorial", "saas"],                       alt: "Claymorph character reading book with floating idea icons around them" },
  { promptNum: 37, slug: "stretching",          style: "claymorph",        family: ["health-tech"],                             alt: "Claymorph character in graceful yoga stretch balanced on one leg" },
  { promptNum: 38, slug: "two-chatting",        style: "claymorph",        family: ["saas", "portfolio"],                       alt: "Two claymorph characters facing each other at a small floating round table" },
  { promptNum: 39, slug: "team-lineup",         style: "claymorph",        family: ["agency", "saas", "portfolio"],             alt: "Four diverse claymorph characters standing shoulder-to-shoulder in friendly lineup" },
  { promptNum: 40, slug: "shopping-packages",   style: "claymorph",        family: ["ecommerce", "commerce"],                   alt: "Claymorph character surrounded by 3-4 floating gift boxes and shopping bags" },
  { promptNum: 41, slug: "studio-minimalist",   style: "fashion-editorial", family: ["ecommerce", "editorial"],                 alt: "Editorial portrait of model in minimalist cream linen oversized suit" },
  { promptNum: 42, slug: "golden-hour-wheat",   style: "fashion-editorial", family: ["ecommerce", "editorial"],                 alt: "Golden hour outdoor lifestyle of model walking through wheat field in rust knit sweater" },
  { promptNum: 43, slug: "urban-streetwear",    style: "fashion-editorial", family: ["ecommerce", "editorial"],                 alt: "Urban editorial of model leaning against graffiti wall in cobalt streetwear hoodie" },
  { promptNum: 44, slug: "duo-romantic",        style: "fashion-editorial", family: ["ecommerce", "editorial"],                 alt: "Soft duo editorial of two models close together in cream knit dress and oat shirt" },
  { promptNum: 45, slug: "hand-handbag",        style: "fashion-editorial", family: ["ecommerce", "editorial"],                 alt: "Macro detail of hand emerging from camel coat sleeve holding tan leather handbag" },
  { promptNum: 46, slug: "athletic-stretch",    style: "fashion-editorial", family: ["ecommerce", "health-tech"],               alt: "Editorial athletic stretch of model in sage green sports bra and leggings" },
  { promptNum: 47, slug: "group-three",         style: "fashion-editorial", family: ["ecommerce", "editorial"],                 alt: "Editorial group of three diverse models in cream, mustard and terracotta outfits" },
  { promptNum: 48, slug: "back-chignon",        style: "fashion-editorial", family: ["ecommerce", "editorial"],                 alt: "Dramatic back portrait of model in charcoal silk gown with sleek low chignon" },
  { promptNum: 49, slug: "vintage-70s",         style: "fashion-editorial", family: ["ecommerce", "editorial"],                 alt: "Vintage 70s portrait of model seated in mustard corduroy jacket and rust trousers" },
  { promptNum: 50, slug: "loungewear-sofa",     style: "fashion-editorial", family: ["ecommerce", "editorial"],                 alt: "Cozy lifestyle portrait of model on cream linen sofa with morning window light" },
  { promptNum: 51, slug: "avant-garde",         style: "fashion-editorial", family: ["ecommerce", "editorial"],                 alt: "Sculptural avant-garde editorial of model in ivory architectural dress in empty gallery" },
  // V1 gap-fillers — appended after the source 51; downloaded later so they
  // sort after the original PNGs and pair by index with these entries.
  { promptNum: 52, slug: "brutalist-concrete",  style: "3d-abstract",      family: ["real-estate", "agency"],                   alt: "Monolithic brutalist concrete sculpture with raking architectural light" },
  { promptNum: 53, slug: "building-cluster",    style: "3d-abstract",      family: ["real-estate"],                             alt: "Cluster of simplified 3D architectural building forms like a warm scale model" },
  { promptNum: 54, slug: "sunlit-interior",     style: "3d-abstract",      family: ["real-estate", "hospitality"],              alt: "Serene sunlit minimalist architectural interior with long soft light shapes" },
  { promptNum: 55, slug: "wind-turbines",       style: "3d-abstract",      family: ["climate"],                                 alt: "Stylized 3D wind turbines on rolling terrain under clean daylight" },
  { promptNum: 56, slug: "forest-canopy",       style: "3d-abstract",      family: ["climate", "health-tech"],                  alt: "Layered atmospheric forest canopy with golden god-rays through mist" },
  { promptNum: 57, slug: "carbon-data",         style: "3d-abstract",      family: ["climate", "fintech"],                      alt: "Descending frosted-glass data columns shifting from amber to teal" },
  { promptNum: 58, slug: "restaurant-glow",     style: "3d-abstract",      family: ["hospitality"],                             alt: "Intimate restaurant interior glowing at golden hour with pendant light" },
  { promptNum: 59, slug: "cafe-table",          style: "3d-abstract",      family: ["hospitality"],                             alt: "Soft still-life of a cafe table with ceramic cup in warm morning light" },
  { promptNum: 60, slug: "doc-panels",          style: "3d-abstract",      family: ["documentation", "technical-minimal"],      alt: "Floating translucent documentation panels stacked in gentle depth" },
  { promptNum: 61, slug: "spotlight-orb",       style: "3d-abstract",      family: ["pre-launch", "event"],                     alt: "Luminous orb suspended under a dramatic spotlight beam in dark atmospheric space" },
  // 2026-05-20 batch — 30 more 3D abstracts, no characters; they sort after
  // the earlier PNGs by file mtime (see process.ts).
  { promptNum: 62, slug: "frosted-glass-cards",  style: "3d-abstract",      family: ["saas", "documentation"],              alt: "Frosted-glass rounded cards floating in soft layered depth" },
  { promptNum: 63, slug: "glass-arch-caustics",  style: "3d-abstract",      family: ["saas", "fintech"],                    alt: "Translucent glass arch with warm caustic light on a seamless floor" },
  { promptNum: 64, slug: "layered-tinted-glass", style: "3d-abstract",      family: ["technical-minimal", "documentation"], alt: "Stacked tinted glass sheets forming a gradient of transparencies" },
  { promptNum: 65, slug: "glass-ribbon",         style: "3d-abstract",      family: ["ai-ml", "pre-launch"],                alt: "Translucent glass ribbon flowing in a slow weightless curve" },
  { promptNum: 66, slug: "frosted-dome",         style: "3d-abstract",      family: ["saas", "commerce"],                   alt: "Matte sphere resting under a frosted-glass dome in soft cool light" },
  { promptNum: 67, slug: "liquid-chrome-blob",   style: "3d-abstract",      family: ["ai-ml", "fintech"],                   alt: "Liquid chrome blob mirroring a soft peach and blue gradient sky" },
  { promptNum: 68, slug: "molten-metal-ribbon",  style: "3d-abstract",      family: ["fintech", "agency"],                  alt: "Molten metal ribbon twisting in mid-air in chrome and warm gold" },
  { promptNum: 69, slug: "chrome-pebbles",       style: "3d-abstract",      family: ["agency", "portfolio"],                alt: "Cluster of rounded chrome pebbles mirroring a warm soft-lit room" },
  { promptNum: 70, slug: "liquid-metal-pour",    style: "3d-abstract",      family: ["ai-ml", "fintech"],                   alt: "Stream of liquid silver pouring and curling, frozen in motion" },
  { promptNum: 71, slug: "brushed-gold-loop",    style: "3d-abstract",      family: ["fintech", "hospitality"],             alt: "Continuous brushed-gold loop floating with warm satin highlights" },
  { promptNum: 72, slug: "matte-rounded-blocks", style: "3d-abstract",      family: ["commerce", "portfolio"],              alt: "Soft rounded matte geometric blocks in a warm terracotta still life" },
  { promptNum: 73, slug: "floating-soft-cubes",  style: "3d-abstract",      family: ["saas", "event"],                      alt: "Soft-edged cubes floating at varied heights in airy pastel light" },
  { promptNum: 74, slug: "nested-arches",        style: "3d-abstract",      family: ["editorial", "real-estate"],           alt: "Nested rounded arches receding in depth with warm pooling light" },
  { promptNum: 75, slug: "pebble-totem",         style: "3d-abstract",      family: ["health-tech", "portfolio"],           alt: "Smooth rounded stones balanced into a poised totem in calm light" },
  { promptNum: 76, slug: "inflated-soft-shapes", style: "3d-abstract",      family: ["ecommerce", "commerce"],              alt: "Plump inflated 3D shapes floating like soft balloons in coral tones" },
  { promptNum: 77, slug: "glowing-gradient-orb", style: "3d-abstract",      family: ["ai-ml", "pre-launch"],                alt: "Softly glowing orb with a sunset gradient core on a dark backdrop" },
  { promptNum: 78, slug: "orbit-particles",      style: "3d-abstract",      family: ["ai-ml", "event"],                     alt: "Glowing core ringed by slow-orbiting light particles in warm amber" },
  { promptNum: 79, slug: "aurora-mist",          style: "3d-abstract",      family: ["pre-launch", "event"],                alt: "Volumetric mist forming a slow aurora gradient sweep in dark space" },
  { promptNum: 80, slug: "prism-light",          style: "3d-abstract",      family: ["ai-ml", "technical-minimal"],         alt: "Soft light beam fanning through a frosted prism into pastel spectrum" },
  { promptNum: 81, slug: "dawn-gradient-sphere", style: "3d-abstract",      family: ["climate", "pre-launch"],              alt: "Large matte sphere with a warm dawn gradient and a soft halo of light" },
  { promptNum: 82, slug: "crystal-cluster",      style: "3d-abstract",      family: ["health-tech", "climate"],             alt: "Cluster of softly faceted translucent crystals with a gentle inner glow" },
  { promptNum: 83, slug: "sediment-strata",      style: "3d-abstract",      family: ["climate", "real-estate"],             alt: "Smooth layered mineral strata forming a soft abstract landscape" },
  { promptNum: 84, slug: "leaf-forms",           style: "3d-abstract",      family: ["climate", "health-tech"],             alt: "Translucent leaf-like 3D forms glowing softly in sage and mint" },
  { promptNum: 85, slug: "coral-reef",           style: "3d-abstract",      family: ["health-tech", "hospitality"],         alt: "Soft rounded coral-like organic structures with a warm subsurface glow" },
  { promptNum: 86, slug: "ice-formations",       style: "3d-abstract",      family: ["climate", "technical-minimal"],       alt: "Smooth frosted-ice formations rising like soft glassy peaks" },
  { promptNum: 87, slug: "arch-hall",            style: "3d-abstract",      family: ["real-estate", "hospitality"],         alt: "Calm hall of smooth rounded arches receding in warm cream light" },
  { promptNum: 88, slug: "floating-staircase",   style: "3d-abstract",      family: ["agency", "portfolio"],                alt: "Soft floating stair-like platforms stepping upward through open space" },
  { promptNum: 89, slug: "minimal-courtyard",    style: "3d-abstract",      family: ["real-estate", "hospitality"],         alt: "Tranquil abstract courtyard with a rounded opening and a soft shadow" },
  { promptNum: 90, slug: "suspended-platforms",  style: "3d-abstract",      family: ["technical-minimal", "saas"],          alt: "Soft rounded platforms suspended at varied depths in cool calm light" },
  { promptNum: 91, slug: "soft-monolith",        style: "3d-abstract",      family: ["agency", "editorial"],                alt: "Single smooth rounded monolith grazed by a soft warm beam of light" },
  // 2026-05-20 batch — 20 claymorph characters; appended after the 3D set,
  // they sort after it by file mtime (see process.ts).
  { promptNum: 92,  slug: "presenting-board",   style: "claymorph",        family: ["agency", "saas"],                     alt: "Claymorph character presenting beside a large floating board, one arm raised" },
  { promptNum: 93,  slug: "video-call",         style: "claymorph",        family: ["saas", "agency"],                     alt: "Claymorph character waving at three floating screens with small claymorph faces" },
  { promptNum: 94,  slug: "coding-screens",     style: "claymorph",        family: ["saas", "technical-minimal"],          alt: "Claymorph character coding at a floating desk between two rounded screens" },
  { promptNum: 95,  slug: "bar-chart",          style: "claymorph",        family: ["fintech", "saas"],                    alt: "Claymorph character pointing proudly at a large rising clay bar chart" },
  { promptNum: 96,  slug: "support-headset",    style: "claymorph",        family: ["saas", "hospitality"],                alt: "Claymorph character in a headset ringed by floating speech-bubble shapes" },
  { promptNum: 97,  slug: "lightbulb-idea",     style: "claymorph",        family: ["pre-launch", "portfolio"],            alt: "Claymorph character holding up a large glowing rounded lightbulb" },
  { promptNum: 98,  slug: "handshake-deal",     style: "claymorph",        family: ["fintech", "agency"],                  alt: "Two claymorph characters shaking hands across a small floating platform" },
  { promptNum: 99,  slug: "building-blocks",    style: "claymorph",        family: ["real-estate", "agency"],              alt: "Claymorph character carrying and stacking large soft rounded building blocks" },
  { promptNum: 100, slug: "riding-rocket",      style: "claymorph",        family: ["pre-launch", "ai-ml"],                alt: "Claymorph character riding a chubby clay rocket lifting off with a cloud trail" },
  { promptNum: 101, slug: "watering-plant",     style: "claymorph",        family: ["climate", "health-tech"],             alt: "Claymorph character watering a tall rounded plant with a chubby watering can" },
  { promptNum: 102, slug: "painting-canvas",    style: "claymorph",        family: ["portfolio", "agency"],                alt: "Claymorph character painting on a large floating rounded canvas" },
  { promptNum: 103, slug: "teaching-board",     style: "claymorph",        family: ["documentation", "editorial"],         alt: "Claymorph character pointing at a floating board with simple clay diagrams" },
  { promptNum: 104, slug: "magnifying-search",  style: "claymorph",        family: ["documentation", "technical-minimal"], alt: "Claymorph character holding up a giant soft rounded magnifying glass" },
  { promptNum: 105, slug: "juggling-tasks",     style: "claymorph",        family: ["saas", "agency"],                     alt: "Claymorph character cheerfully juggling several soft rounded icon shapes" },
  { promptNum: 106, slug: "telescope-vision",   style: "claymorph",        family: ["ai-ml", "pre-launch"],                alt: "Claymorph character looking through a chubby clay telescope toward a horizon" },
  { promptNum: 107, slug: "unboxing-package",   style: "claymorph",        family: ["ecommerce", "commerce"],              alt: "Claymorph character happily opening a large rounded package box" },
  { promptNum: 108, slug: "giant-phone",        style: "claymorph",        family: ["ecommerce", "saas"],                  alt: "Claymorph character leaning against a giant soft rounded smartphone" },
  { promptNum: 109, slug: "hammock-rest",       style: "claymorph",        family: ["health-tech", "hospitality"],         alt: "Claymorph character relaxing in a soft rounded hammock between clay supports" },
  { promptNum: 110, slug: "map-explorer",       style: "claymorph",        family: ["hospitality", "real-estate"],         alt: "Claymorph character holding an open rounded map, looking ahead curiously" },
  { promptNum: 111, slug: "glowing-heart",      style: "claymorph",        family: ["health-tech", "event"],               alt: "Claymorph character holding up a large soft glowing rounded heart" },
];

// Sanity: catch a future drift between this list and what process.ts expects.
if (IMAGE_META.length !== 110) {
  throw new Error(`IMAGE_META must have 110 entries (got ${IMAGE_META.length})`);
}
