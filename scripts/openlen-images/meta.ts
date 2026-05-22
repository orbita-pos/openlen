// Source-of-truth metadata for the "Imagenes by OpenLen" set.
//
// 230 entries, paired by index with the PNGs in Downloads/img-chatgpt sorted by
// file mtime (= generation order = prompt order). Prompt #19 (brutalist
// concrete) was skipped during generation, so promptNum runs 1..231 with a gap
// at 19 — 230 images total. Entries are stored in mtime order, which usually
// matches promptNum order — except a prompt regenerated late (e.g. #170), which
// is listed in its mtime position within its batch, not by promptNum.
//
// `family` values reference TemplateFamily slugs in lib/templates/families.ts
// so the image picker can filter by the active template's family directly.
//
// To add a batch: append entries below in prompt order, bump the sanity-check
// count, drop the new PNGs into Downloads/img-chatgpt, re-run process.ts.

import type { TemplateFamily } from "../../lib/templates/families";

export type ImageStyle =
  | "3d-abstract"
  | "claymorph"
  | "fashion-editorial"
  | "device-mockup"
  | "product-still-life"
  | "food-editorial"
  | "interior-editorial"
  | "nature-editorial";

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
  // 2026-05-21 batch — 24 device mockups (laptops, phones, tablets, dashboards)
  // in the clean 3D-render style with abstract on-screen UI; they sort after
  // the earlier PNGs by file mtime (see process.ts).
  { promptNum: 112, slug: "laptop-dashboard",     style: "device-mockup",    family: ["saas", "technical-minimal"],               alt: "Floating laptop showing an abstract dashboard UI in cool off-white and coral" },
  { promptNum: 113, slug: "laptop-analytics",     style: "device-mockup",    family: ["fintech", "ai-ml"],                        alt: "Floating laptop showing an abstract analytics view with soft charts and metric cards" },
  { promptNum: 114, slug: "laptop-code-editor",   style: "device-mockup",    family: ["technical-minimal", "documentation"],      alt: "Floating dark laptop showing an abstract code-editor UI in charcoal and mint" },
  { promptNum: 115, slug: "monitor-board",        style: "device-mockup",    family: ["saas", "agency"],                          alt: "Floating desktop monitor showing an abstract kanban board of soft rounded cards" },
  { promptNum: 116, slug: "laptop-glow",          style: "device-mockup",    family: ["pre-launch", "saas"],                      alt: "Half-open laptop with a glowing screen casting soft coral light in a dark scene" },
  { promptNum: 117, slug: "laptop-storefront",    style: "device-mockup",    family: ["ecommerce", "commerce"],                   alt: "Floating laptop showing an abstract online-store grid in warm cream and peach" },
  { promptNum: 118, slug: "phone-app-home",       style: "device-mockup",    family: ["mobile-app", "saas"],                      alt: "Floating smartphone showing an abstract app home screen with a soft icon grid" },
  { promptNum: 119, slug: "phone-finance",        style: "device-mockup",    family: ["fintech", "mobile-app"],                   alt: "Floating smartphone showing an abstract finance UI with a balance card and a chart" },
  { promptNum: 120, slug: "phone-health",         style: "device-mockup",    family: ["health-tech", "wellness"],                 alt: "Floating smartphone showing an abstract health UI with soft activity rings" },
  { promptNum: 121, slug: "phone-chat",           style: "device-mockup",    family: ["saas", "mobile-app"],                      alt: "Floating smartphone showing an abstract messaging UI with soft rounded chat bubbles" },
  { promptNum: 122, slug: "phone-map",            style: "device-mockup",    family: ["real-estate", "local-services"],           alt: "Floating smartphone showing an abstract map UI with soft paths and a location pin" },
  { promptNum: 123, slug: "phone-calendar",       style: "device-mockup",    family: ["hospitality", "event"],                    alt: "Floating smartphone showing an abstract calendar UI with a soft month grid" },
  { promptNum: 124, slug: "tablet-design",        style: "device-mockup",    family: ["portfolio", "agency"],                     alt: "Floating tablet showing an abstract design-canvas UI with shapes and a toolbar" },
  { promptNum: 125, slug: "tablet-reading",       style: "device-mockup",    family: ["editorial", "documentation"],              alt: "Floating tablet showing an abstract article UI with soft text blocks and an image" },
  { promptNum: 126, slug: "laptop-phone-duo",     style: "device-mockup",    family: ["saas", "mobile-app"],                      alt: "Floating laptop and smartphone together showing a matching abstract UI" },
  { promptNum: 127, slug: "phones-fanned",        style: "device-mockup",    family: ["mobile-app", "ecommerce"],                 alt: "Three smartphones floating in a fanned arc, each with a different abstract app view" },
  { promptNum: 128, slug: "devices-podium",       style: "device-mockup",    family: ["commerce", "ecommerce"],                   alt: "Laptop, tablet and phone resting together on a soft rounded podium" },
  { promptNum: 129, slug: "devices-layered",      style: "device-mockup",    family: ["agency", "ai-ml"],                         alt: "Smartphone, tablet and laptop screen floating in a layered exploded stack" },
  { promptNum: 130, slug: "floating-ui-cards",    style: "device-mockup",    family: ["saas", "technical-minimal"],               alt: "Cluster of floating UI panels and rounded cards with soft charts, no device frame" },
  { promptNum: 131, slug: "smartwatch-activity",  style: "device-mockup",    family: ["health-tech", "wellness"],                 alt: "Floating smartwatch showing an abstract activity UI with soft progress rings" },
  { promptNum: 132, slug: "phone-widgets",        style: "device-mockup",    family: ["saas", "pre-launch"],                      alt: "Floating smartphone surrounded by small drifting widget cards and charts" },
  { promptNum: 133, slug: "payment-terminal",     style: "device-mockup",    family: ["fintech", "commerce"],                     alt: "Floating card-payment terminal showing an abstract payment confirmation UI" },
  { promptNum: 134, slug: "phone-notifications",  style: "device-mockup",    family: ["saas", "mobile-app"],                      alt: "Floating smartphone with soft notification cards stacking off the top of the screen" },
  { promptNum: 135, slug: "curved-dashboard",     style: "device-mockup",    family: ["ai-ml", "agency"],                         alt: "Large gently curved display showing an abstract dashboard with soft wide charts" },
  // 2026-05-21 batch — 24 product still-life renders (beauty, food/beverage,
  // tech and lifestyle goods), unbranded with blank labels, clean 3D-render
  // style; they sort after the earlier PNGs by file mtime (see process.ts).
  { promptNum: 136, slug: "serum-bottle",         style: "product-still-life",  family: ["ecommerce", "health-tech"],      alt: "Frosted-glass serum dropper bottle on a soft podium in warm cream and amber" },
  { promptNum: 137, slug: "cream-jar",            style: "product-still-life",  family: ["ecommerce", "wellness"],         alt: "Round cosmetic cream jar on a soft pedestal in blush and warm ivory" },
  { promptNum: 138, slug: "perfume-bottle",       style: "product-still-life",  family: ["ecommerce", "editorial"],        alt: "Sculptural faceted-glass perfume bottle floating above a soft podium" },
  { promptNum: 139, slug: "skincare-set",         style: "product-still-life",  family: ["ecommerce", "commerce"],         alt: "Collection of three unbranded skincare bottles and jars on a soft podium" },
  { promptNum: 140, slug: "cosmetic-tube",        style: "product-still-life",  family: ["ecommerce", "health-tech"],      alt: "Soft cosmetic tube standing on a soft podium in warm cream and coral" },
  { promptNum: 141, slug: "soap-bar",             style: "product-still-life",  family: ["ecommerce", "wellness"],         alt: "Smooth bar of soap on a ceramic dish in warm oat and terracotta tones" },
  { promptNum: 142, slug: "supplement-bottle",    style: "product-still-life",  family: ["wellness", "health-tech"],       alt: "Rounded supplement bottle with a few capsules beside it on a soft podium" },
  { promptNum: 143, slug: "gummy-jar",            style: "product-still-life",  family: ["wellness", "health-tech"],       alt: "Squat jar of soft translucent gummies on a soft podium in peach tones" },
  { promptNum: 144, slug: "coffee-bag",           style: "product-still-life",  family: ["ecommerce", "hospitality"],      alt: "Standing kraft-paper coffee pouch with scattered beans on a soft surface" },
  { promptNum: 145, slug: "beverage-can",         style: "product-still-life",  family: ["ecommerce", "commerce"],         alt: "Slim unbranded beverage can floating above a soft podium with light condensation" },
  { promptNum: 146, slug: "oil-bottle",           style: "product-still-life",  family: ["ecommerce", "hospitality"],      alt: "Tall glass bottle of golden oil on a soft surface in cream and olive tones" },
  { promptNum: 147, slug: "honey-jar",            style: "product-still-life",  family: ["ecommerce", "hospitality"],      alt: "Rounded glass jar of soft golden spread on a soft podium in honey tones" },
  { promptNum: 148, slug: "headphones",           style: "product-still-life",  family: ["ecommerce", "hardware"],         alt: "Pair of unbranded over-ear headphones floating above a soft podium" },
  { promptNum: 149, slug: "earbuds-case",         style: "product-still-life",  family: ["hardware", "ecommerce"],         alt: "Open earbuds charging case with two earbuds on a soft podium" },
  { promptNum: 150, slug: "smart-speaker",        style: "product-still-life",  family: ["hardware", "ecommerce"],         alt: "Rounded fabric-mesh smart speaker on a soft surface in warm sand tones" },
  { promptNum: 151, slug: "power-bank",           style: "product-still-life",  family: ["hardware", "ecommerce"],         alt: "Slim portable charger floating above a soft podium in cool off-white and slate" },
  { promptNum: 152, slug: "desk-lamp",            style: "product-still-life",  family: ["hardware", "agency"],            alt: "Minimalist desk lamp with a soft warm glow on a calm surface" },
  { promptNum: 153, slug: "mechanical-keyboard",  style: "product-still-life",  family: ["hardware", "technical-minimal"], alt: "Compact mechanical keyboard with blank keycaps floating above a soft podium" },
  { promptNum: 154, slug: "scented-candle",       style: "product-still-life",  family: ["ecommerce", "hospitality"],      alt: "Candle in a ceramic vessel with a soft flame on a soft podium in terracotta tones" },
  { promptNum: 155, slug: "water-bottle",         style: "product-still-life",  family: ["ecommerce", "wellness"],         alt: "Reusable water bottle standing on a soft surface in sage and cream tones" },
  { promptNum: 156, slug: "ceramic-mug",          style: "product-still-life",  family: ["ecommerce", "hospitality"],      alt: "Rounded ceramic mug with a wisp of steam on a soft podium in warm oat tones" },
  { promptNum: 157, slug: "sneakers",             style: "product-still-life",  family: ["ecommerce", "commerce"],         alt: "Pair of clean minimalist sneakers floating at an angle above a soft podium" },
  { promptNum: 158, slug: "sunglasses",           style: "product-still-life",  family: ["ecommerce", "editorial"],        alt: "Pair of modern sunglasses floating at an angle above a soft podium in sand tones" },
  { promptNum: 159, slug: "backpack",             style: "product-still-life",  family: ["ecommerce", "commerce"],         alt: "Soft minimalist backpack standing upright on a soft surface in warm tan tones" },
  // 2026-05-21 batch — 24 food-editorial photographs (restaurant, café, drinks,
  // ingredients); photoreal, not 3D render. Listed in mtime order: #170 (artisan
  // bread) was regenerated late, so it sorts last and is listed last to pair.
  { promptNum: 160, slug: "plated-fine-dining",   style: "food-editorial",    family: ["hospitality", "editorial"],  alt: "Editorial photograph of an elegant fine-dining plated dish with delicate garnishes" },
  { promptNum: 161, slug: "pasta-bowl",           style: "food-editorial",    family: ["hospitality"],               alt: "Editorial photograph of a rustic bowl of fresh pasta with cheese and basil" },
  { promptNum: 162, slug: "gourmet-burger",       style: "food-editorial",    family: ["hospitality"],               alt: "Editorial photograph of a tall stacked gourmet burger on a slate board" },
  { promptNum: 163, slug: "grain-bowl",           style: "food-editorial",    family: ["wellness", "hospitality"],   alt: "Editorial photograph of a fresh colorful grain bowl shot from overhead" },
  { promptNum: 164, slug: "ramen-bowl",           style: "food-editorial",    family: ["hospitality"],               alt: "Editorial photograph of a steaming bowl of ramen with a soft egg and toppings" },
  { promptNum: 165, slug: "brunch-plate",         style: "food-editorial",    family: ["hospitality"],               alt: "Editorial photograph of a brunch plate with poached eggs, avocado and toast" },
  { promptNum: 166, slug: "latte-art",            style: "food-editorial",    family: ["hospitality"],               alt: "Editorial overhead photograph of a cappuccino with delicate latte art" },
  { promptNum: 167, slug: "croissants",           style: "food-editorial",    family: ["hospitality"],               alt: "Editorial photograph of a spread of fresh flaky croissants and pastries" },
  { promptNum: 168, slug: "cake-slice",           style: "food-editorial",    family: ["hospitality", "event"],      alt: "Editorial photograph of a single slice of layer cake on a small plate" },
  { promptNum: 169, slug: "pancake-stack",        style: "food-editorial",    family: ["hospitality"],               alt: "Editorial photograph of a tall stack of fluffy pancakes with syrup and berries" },
  { promptNum: 171, slug: "plated-dessert",       style: "food-editorial",    family: ["hospitality", "editorial"],  alt: "Editorial photograph of a fine-dining plated dessert with a quenelle and berries" },
  { promptNum: 172, slug: "craft-cocktail",       style: "food-editorial",    family: ["hospitality", "event"],      alt: "Editorial photograph of a craft cocktail garnished with citrus and herbs" },
  { promptNum: 173, slug: "wine-cheese",          style: "food-editorial",    family: ["hospitality", "editorial"],  alt: "Editorial photograph of a glass of red wine beside a small cheese board" },
  { promptNum: 174, slug: "iced-coffee",          style: "food-editorial",    family: ["hospitality", "ecommerce"],  alt: "Editorial photograph of a glass of iced coffee with a swirl of milk and ice" },
  { promptNum: 175, slug: "smoothie",             style: "food-editorial",    family: ["wellness", "health-tech"],   alt: "Editorial photograph of a vibrant smoothie topped with fresh fruit and seeds" },
  { promptNum: 176, slug: "tea-setup",            style: "food-editorial",    family: ["hospitality", "wellness"],   alt: "Editorial photograph of a calm tea setup with a ceramic pot and a cup of tea" },
  { promptNum: 177, slug: "coffee-pastry",        style: "food-editorial",    family: ["hospitality"],               alt: "Editorial photograph of a cup of coffee and a small pastry on a cafe table" },
  { promptNum: 178, slug: "vegetables-flatlay",   style: "food-editorial",    family: ["wellness", "hospitality"],   alt: "Editorial overhead flat-lay of fresh colorful vegetables" },
  { promptNum: 179, slug: "herbs-spices",         style: "food-editorial",    family: ["hospitality", "ecommerce"],  alt: "Editorial overhead flat-lay of fresh herbs and bowls of colorful spices" },
  { promptNum: 180, slug: "charcuterie-board",    style: "food-editorial",    family: ["hospitality", "event"],      alt: "Editorial photograph of a generous grazing board with meats, cheeses and fruit" },
  { promptNum: 181, slug: "fruit-bowl",           style: "food-editorial",    family: ["wellness", "health-tech"],   alt: "Editorial photograph of a fresh fruit arrangement in a shallow ceramic bowl" },
  { promptNum: 182, slug: "set-table",            style: "food-editorial",    family: ["hospitality", "event"],      alt: "Editorial overhead photograph of a beautifully set dining table" },
  { promptNum: 183, slug: "brunch-table",         style: "food-editorial",    family: ["hospitality"],               alt: "Editorial photograph of a relaxed brunch table spread with pastries and coffee" },
  { promptNum: 170, slug: "artisan-bread",        style: "food-editorial",    family: ["hospitality", "ecommerce"],  alt: "Editorial photograph of rustic artisan bread loaves with a crisp scored crust" },
  // 2026-05-22 batch — 24 interior-editorial photographs (offices, coworking,
  // hospitality, retail, home interiors); photoreal, no people. Generated in
  // prompt order, so mtime order = promptNum order 184..207.
  { promptNum: 184, slug: "open-plan-office",     style: "interior-editorial",    family: ["saas", "agency"],                alt: "Editorial interior photograph of a bright open-plan office with shared desks and large windows" },
  { promptNum: 185, slug: "coworking-space",      style: "interior-editorial",    family: ["saas", "local-services"],        alt: "Editorial interior photograph of a relaxed coworking space with lounge sofas and communal tables" },
  { promptNum: 186, slug: "home-office-desk",     style: "interior-editorial",    family: ["creator", "portfolio"],          alt: "Editorial interior photograph of a tidy home-office desk with a laptop, lamp and books" },
  { promptNum: 187, slug: "hotel-lobby",          style: "interior-editorial",    family: ["hospitality", "travel"],         alt: "Editorial interior photograph of an elegant boutique hotel lobby with a velvet sofa and greenery" },
  { promptNum: 188, slug: "retail-interior",      style: "interior-editorial",    family: ["commerce", "ecommerce"],         alt: "Editorial interior photograph of a minimalist boutique retail space with open shelving" },
  { promptNum: 189, slug: "restaurant-interior",  style: "interior-editorial",    family: ["hospitality", "food-beverage"],  alt: "Editorial interior photograph of an intimate restaurant dining room with set tables and pendant lights" },
  { promptNum: 190, slug: "coffee-shop-interior", style: "interior-editorial",    family: ["hospitality", "local-services"], alt: "Editorial interior photograph of a cozy specialty coffee shop with a wooden counter and plants" },
  { promptNum: 191, slug: "creative-studio",      style: "interior-editorial",    family: ["agency", "creator"],             alt: "Editorial interior photograph of a bright creative studio with a worktable and mood boards" },
  { promptNum: 192, slug: "conference-room",      style: "interior-editorial",    family: ["saas", "fintech"],               alt: "Editorial interior photograph of a modern conference room with a long table and wall screen" },
  { promptNum: 193, slug: "office-lounge",        style: "interior-editorial",    family: ["hospitality", "agency"],         alt: "Editorial interior photograph of a stylish office lounge with modular sofas and floor lamps" },
  { promptNum: 194, slug: "library-reading-room", style: "interior-editorial",    family: ["education", "editorial"],        alt: "Editorial interior photograph of a quiet library reading room with tall bookshelves" },
  { promptNum: 195, slug: "loft-workspace",       style: "interior-editorial",    family: ["agency", "creator"],             alt: "Editorial interior photograph of an industrial loft workspace with exposed brick and a long desk" },
  { promptNum: 196, slug: "reception-desk",       style: "interior-editorial",    family: ["agency", "fintech"],             alt: "Editorial interior photograph of a minimalist office reception with a sculptural front desk" },
  { promptNum: 197, slug: "focus-pod",            style: "interior-editorial",    family: ["saas", "technical-minimal"],     alt: "Editorial interior photograph of a private office focus pod with an upholstered booth" },
  { promptNum: 198, slug: "co-living-room",       style: "interior-editorial",    family: ["real-estate", "hospitality"],    alt: "Editorial interior photograph of a warm co-living common room with a sofa and shared table" },
  { promptNum: 199, slug: "architecture-studio",  style: "interior-editorial",    family: ["portfolio", "agency"],           alt: "Editorial interior photograph of an architecture studio desk with drawings and a scale model" },
  { promptNum: 200, slug: "spa-interior",         style: "interior-editorial",    family: ["wellness", "hospitality"],       alt: "Editorial interior photograph of a serene spa treatment room with a daybed and folded towels" },
  { promptNum: 201, slug: "modern-kitchen",       style: "interior-editorial",    family: ["real-estate", "hospitality"],    alt: "Editorial interior photograph of a modern kitchen with a clean island and open shelving" },
  { promptNum: 202, slug: "living-room",          style: "interior-editorial",    family: ["real-estate", "editorial"],      alt: "Editorial interior photograph of a bright contemporary living room with a low sofa and plant" },
  { promptNum: 203, slug: "hotel-room",           style: "interior-editorial",    family: ["hospitality", "travel"],         alt: "Editorial interior photograph of a calm boutique hotel room with a neatly made bed" },
  { promptNum: 204, slug: "showroom-gallery",     style: "interior-editorial",    family: ["commerce", "editorial"],         alt: "Editorial interior photograph of a minimalist showroom gallery with a sculptural object on a plinth" },
  { promptNum: 205, slug: "rooftop-lounge",       style: "interior-editorial",    family: ["hospitality", "event"],          alt: "Editorial interior photograph of a rooftop terrace lounge with outdoor sofas and string lights" },
  { promptNum: 206, slug: "podcast-studio",       style: "interior-editorial",    family: ["podcast", "music"],              alt: "Editorial interior photograph of a cozy podcast studio with microphones and acoustic panels" },
  { promptNum: 207, slug: "classroom",            style: "interior-editorial",    family: ["education", "local-services"],   alt: "Editorial interior photograph of a bright modern classroom with wooden desks and a board wall" },
  // 2026-05-22 batch — 24 nature-editorial photographs (mountains, coast, forest,
  // desert, water); photoreal landscape, no people. Generated in prompt order,
  // so mtime order = promptNum order 208..231.
  { promptNum: 208, slug: "mountain-range",       style: "nature-editorial",        family: ["travel", "wellness"],            alt: "Editorial landscape photograph of a layered mountain range fading into haze at dawn" },
  { promptNum: 209, slug: "coastal-cliffs",       style: "nature-editorial",        family: ["travel", "hospitality"],         alt: "Editorial landscape photograph of dramatic coastal cliffs meeting the ocean with white surf" },
  { promptNum: 210, slug: "misty-forest",         style: "nature-editorial",        family: ["wellness", "climate"],           alt: "Editorial landscape photograph of a misty evergreen forest with trunks fading into fog" },
  { promptNum: 211, slug: "desert-dunes",         style: "nature-editorial",        family: ["travel", "editorial"],           alt: "Editorial landscape photograph of rolling desert sand dunes with soft curving shadows" },
  { promptNum: 212, slug: "lake-reflection",      style: "nature-editorial",        family: ["wellness", "travel"],            alt: "Editorial landscape photograph of a calm mountain lake mirroring distant peaks" },
  { promptNum: 213, slug: "green-hills",          style: "nature-editorial",        family: ["travel", "climate"],             alt: "Editorial landscape photograph of rolling green hills under a wide cloud-scattered sky" },
  { promptNum: 214, slug: "forest-waterfall",     style: "nature-editorial",        family: ["travel", "wellness"],            alt: "Editorial landscape photograph of a forest waterfall cascading into a clear pool" },
  { promptNum: 215, slug: "aerial-coastline",     style: "nature-editorial",        family: ["travel", "real-estate"],         alt: "Editorial aerial photograph of a curving coastline with turquoise shallows and pale sand" },
  { promptNum: 216, slug: "alpine-peaks",         style: "nature-editorial",        family: ["travel", "event"],               alt: "Editorial landscape photograph of snowy alpine peaks against a clear sky" },
  { promptNum: 217, slug: "tropical-beach",       style: "nature-editorial",        family: ["travel", "hospitality"],         alt: "Editorial landscape photograph of a quiet tropical beach with pale sand and turquoise water" },
  { promptNum: 218, slug: "pine-forest-path",     style: "nature-editorial",        family: ["wellness", "travel"],            alt: "Editorial landscape photograph of a quiet path through a tall pine forest" },
  { promptNum: 219, slug: "golden-field",         style: "nature-editorial",        family: ["climate", "editorial"],          alt: "Editorial landscape photograph of a wide golden grain field glowing at sunset" },
  { promptNum: 220, slug: "mountain-stream",      style: "nature-editorial",        family: ["wellness", "travel"],            alt: "Editorial landscape photograph of a clear rocky mountain stream over smooth stones" },
  { promptNum: 221, slug: "northern-lights",      style: "nature-editorial",        family: ["travel", "editorial"],           alt: "Editorial landscape photograph of the northern lights over a still arctic landscape" },
  { promptNum: 222, slug: "red-rock-canyon",      style: "nature-editorial",        family: ["travel", "editorial"],           alt: "Editorial landscape photograph of a vast red-rock canyon with layered sandstone walls" },
  { promptNum: 223, slug: "lavender-field",       style: "nature-editorial",        family: ["wellness", "event"],             alt: "Editorial landscape photograph of a blooming lavender field in long purple rows" },
  { promptNum: 224, slug: "autumn-forest",        style: "nature-editorial",        family: ["editorial", "travel"],           alt: "Editorial landscape photograph of an autumn forest in warm gold and amber foliage" },
  { promptNum: 225, slug: "river-delta",          style: "nature-editorial",        family: ["climate", "editorial"],          alt: "Editorial aerial photograph of a branching river delta threading through green and earth tones" },
  { promptNum: 226, slug: "waterfall-lagoon",     style: "nature-editorial",        family: ["travel", "hospitality"],         alt: "Editorial landscape photograph of a tropical waterfall falling into an emerald jungle lagoon" },
  { promptNum: 227, slug: "rolling-vineyard",     style: "nature-editorial",        family: ["hospitality", "food-beverage"],  alt: "Editorial landscape photograph of a rolling vineyard with neat rows curving over hills" },
  { promptNum: 228, slug: "foggy-valley",         style: "nature-editorial",        family: ["wellness", "travel"],            alt: "Editorial landscape photograph of a valley overlook above a sea of soft fog" },
  { promptNum: 229, slug: "palm-oasis",           style: "nature-editorial",        family: ["travel", "hospitality"],         alt: "Editorial landscape photograph of a desert palm grove oasis around still water" },
  { promptNum: 230, slug: "glacier-landscape",    style: "nature-editorial",        family: ["climate", "travel"],             alt: "Editorial landscape photograph of a glacier landscape with pale blue ice and a meltwater lagoon" },
  { promptNum: 231, slug: "wildflower-meadow",    style: "nature-editorial",        family: ["wellness", "climate"],           alt: "Editorial landscape photograph of an alpine wildflower meadow with mountains behind" },
];

// Sanity: catch a future drift between this list and what process.ts expects.
if (IMAGE_META.length !== 230) {
  throw new Error(`IMAGE_META must have 230 entries (got ${IMAGE_META.length})`);
}
