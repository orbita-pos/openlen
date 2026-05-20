// Source-of-truth metadata for the "Imagenes by OpenLen" set.
//
// 50 entries in the order ChatGPT exported the PNGs (chronological = prompt
// order). Prompt #19 (brutalist concrete) was skipped during generation, so
// the promptNum sequence has a gap there but otherwise runs 1..51.
//
// `family` values reference TemplateFamily slugs in lib/templates/families.ts
// so the image picker can filter by the active template's family directly.
//
// To re-iterate this set later: keep IMAGE_META in source order and re-run
// process.ts after re-dropping the PNGs into Downloads/img-chatgpt.

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
];

// Sanity: catch a future drift between this list and what process.ts expects.
if (IMAGE_META.length !== 60) {
  throw new Error(`IMAGE_META must have 60 entries (got ${IMAGE_META.length})`);
}
