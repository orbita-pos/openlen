import { randomUUID } from "node:crypto";
import { BLOCK_REGISTRY, isBlockId } from "@/lib/blocks/_registry";
import type { BlockId } from "@/lib/blocks/_registry";
import type { ImageCallRequest, TextCallRequest } from "./client";
import { priceImageCall, priceTextCall } from "./models";

// ─────────────────────────────────────────────────────────────────────────────
// Mock dispatcher — slot-filling pipeline edition.
//
// Each text step passes a `mockKey` (classify / plan / fill). Mocks produce
// plausible, real-shape outputs:
//   - classify: returns Intent with parsed brief signal.
//   - plan: returns a realistic blockSequence built from the registry.
//   - fill: returns the block's exampleSlots — guaranteed to validate against
//     the block's own slotsSchema, so the orchestrator's assemble step always
//     gets renderable input under MOCK_MODE=1.
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_PER_CHAR = 0.25;
function estimateTokens(s: string): number {
  return Math.max(1, Math.ceil(s.length * TOKEN_PER_CHAR));
}

type MockTextOutput = {
  content: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  cached: boolean;
};

export async function mockText(req: TextCallRequest): Promise<MockTextOutput> {
  const brief = extractBrief(req);
  const userMessage = extractUserMessage(req);
  const sig = lightSignal(brief);
  const key = req.mockKey ?? inferKey(req);

  let content = "";
  switch (key) {
    case "classify":
      content = JSON.stringify(classifyMock(sig));
      break;
    case "plan":
      content = JSON.stringify(planMock(sig));
      break;
    case "fill":
      content = JSON.stringify(fillMock(userMessage));
      break;
    default:
      content = JSON.stringify({ ok: true, note: `unhandled mockKey=${key}` });
  }

  const inputTokens = req.messages.reduce(
    (acc, m) => acc + estimateTokens(m.content),
    0,
  );
  const outputTokens = estimateTokens(content);
  const costUsd = priceTextCall(req.model, inputTokens, outputTokens);
  // Simulate prompt-cache hits on second+ calls for the same system prompt.
  const cached = sawSystemPrompt(req.messages[0]?.content ?? "");

  // Add a tiny delay so progress events feel real in the SSE stream.
  await sleep(40 + Math.floor(Math.random() * 60));

  return { content, inputTokens, outputTokens, costUsd, cached };
}

type MockImageOutput = {
  url: string;
  costUsd: number;
};

export async function mockImage(
  req: ImageCallRequest,
): Promise<MockImageOutput> {
  // picsum.photos gives stable, signed-seeded URLs that always resolve to a
  // real image of the right aspect ratio. Use a hash of the prompt as seed so
  // re-running with the same prompt yields the same image.
  const { width, height } = aspectToSize(req.aspectRatio ?? "16:9");
  const seed = hashString(req.prompt) % 1000;
  const url = `https://picsum.photos/seed/inari-${seed}/${width}/${height}`;
  await sleep(80 + Math.floor(Math.random() * 120));
  return {
    url,
    costUsd: priceImageCall(req.model),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Light brief parsing — extract enough signal to vary mocks per request.
// ─────────────────────────────────────────────────────────────────────────────

interface BriefSignal {
  productName: string;
  audience: string;
  industry: string;
  tone: "bold" | "friendly" | "professional" | "playful" | "minimal" | "technical";
  complexity: "simple" | "standard" | "rich";
}

function lightSignal(brief: string): BriefSignal {
  const productMatch =
    brief.match(/\bfor\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)?)/) ||
    brief.match(/"([^"]+)"/) ||
    brief.match(/\b([A-Z][a-z]+[A-Z][a-zA-Z]+)\b/);
  const productName = (productMatch?.[1] || "Acme").trim();

  const audienceMatch =
    brief.match(/\b(designers|developers|founders|marketers|teams|agencies|students|creators)\b/i) ||
    brief.match(/for\s+([a-z][a-z\s]+?)(?:[,.\n]|$)/);
  const audience = audienceMatch ? audienceMatch[1].trim().toLowerCase() : "small teams";

  const lower = brief.toLowerCase();
  const industry =
    /kanban|project|task|todo|productivity/.test(lower)
      ? "productivity software"
      : /ecommerce|store|shop|product/.test(lower)
        ? "ecommerce"
        : /ai|ml|model|llm/.test(lower)
          ? "AI tooling"
          : /finance|bank|invest|crypto/.test(lower)
            ? "fintech"
            : /health|medical|fitness|wellness/.test(lower)
              ? "health & wellness"
              : /education|learn|course|tutor/.test(lower)
                ? "edtech"
                : "saas";

  const tone: BriefSignal["tone"] =
    /bold|loud|disrupt|aggressive/.test(lower)
      ? "bold"
      : /minimal|clean|simple|zen/.test(lower)
        ? "minimal"
        : /playful|fun|quirky|whimsical/.test(lower)
          ? "playful"
          : /technical|developer|api|infra/.test(lower)
            ? "technical"
            : /friendly|warm|approachable/.test(lower)
              ? "friendly"
              : "professional";

  const wordCount = brief.split(/\s+/).filter(Boolean).length;
  const complexity: BriefSignal["complexity"] =
    wordCount > 80 ? "rich" : wordCount > 30 ? "standard" : "simple";

  return { productName, audience, industry, tone, complexity };
}

function classifyMock(sig: BriefSignal) {
  return {
    productName: sig.productName,
    industry: sig.industry,
    audience: sig.audience,
    tone: sig.tone,
    complexity: sig.complexity,
    goals: ["drive signups", "communicate value clearly", "showcase product"],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan mock — pick a realistic block sequence keyed by complexity, then by
// industry signal. Every chosen block has the "technical-minimal" aesthetic
// in its `meta.aesthetics`, so the canonical sequence is always valid.
// ─────────────────────────────────────────────────────────────────────────────

interface MockPlan {
  blockSequence: Array<{ blockId: BlockId; purpose: string; emphasis?: string }>;
  aesthetic:
    | "technical-minimal"
    | "refined-editorial"
    | "warm-humanist"
    | "editorial-maximalist"
    | "brutalist-technical";
  palette:
    | "mono-dark"
    | "indigo-dark"
    | "emerald-dark"
    | "warm-dark"
    | "mono-light";
  rationale: string;
  imageNeeds: { hero: boolean; decorative: number };
}

function planMock(sig: BriefSignal): MockPlan {
  // Sequence shape varies by complexity — simple briefs skip pricing/testimonials.
  const sequence: BlockId[] =
    sig.complexity === "simple"
      ? [
          "hero/centered-cta",
          "features/icon-grid-3col",
          "cta/gradient-cta",
          "footer/minimal-row",
        ]
      : sig.complexity === "rich"
        ? [
            "hero/split-image",
            "features/icon-grid-3col",
            "features/alternating-rows",
            "pricing/three-tier-highlight",
            "testimonials/quote-grid-3col",
            "faq/accordion",
            "cta/gradient-cta",
            "footer/four-col-links",
          ]
        : [
            "hero/centered-cta",
            "features/icon-grid-3col",
            "pricing/three-tier-highlight",
            "cta/gradient-cta",
            "footer/four-col-links",
          ];

  const palette: MockPlan["palette"] =
    sig.tone === "bold"
      ? "warm-dark"
      : sig.tone === "minimal"
        ? "mono-light"
        : sig.tone === "technical"
          ? "emerald-dark"
          : sig.industry === "fintech" || sig.industry === "productivity software"
            ? "indigo-dark"
            : "mono-dark";

  const aesthetic: MockPlan["aesthetic"] =
    palette === "mono-light" || palette === "warm-dark"
      ? "refined-editorial"
      : "technical-minimal";

  // Hero image is needed when the chosen hero block has an image slot.
  const heroId = sequence[0];
  const heroNeedsImage =
    heroId === "hero/split-image" || heroId === "hero/centered-cta";

  return {
    blockSequence: sequence.map((blockId, idx) => ({
      blockId,
      purpose: purposeFor(blockId, sig),
      emphasis: idx === 0 ? "Hero must lead with the product's strongest concrete benefit." : undefined,
    })),
    aesthetic,
    palette,
    rationale: `Picked ${sequence.length} blocks matching ${sig.industry} for ${sig.audience} in a ${sig.tone} register; aesthetic chosen for the ${palette} palette's fit.`,
    imageNeeds: { hero: heroNeedsImage, decorative: 0 },
  };
}

function purposeFor(blockId: BlockId, sig: BriefSignal): string {
  if (blockId.startsWith("hero/")) {
    return `Anchor the brand promise for ${sig.productName} in under 12 words.`;
  }
  if (blockId.startsWith("features/")) {
    return "Three to six concrete capabilities that differentiate this product from competitors.";
  }
  if (blockId.startsWith("pricing/")) {
    return "Tiered pricing with one obvious recommended option.";
  }
  if (blockId.startsWith("testimonials/")) {
    return "Quotes from real-feeling users in the target audience.";
  }
  if (blockId.startsWith("faq/")) {
    return "Address the top 3-5 conversion-blocking questions.";
  }
  if (blockId.startsWith("cta/")) {
    return "Final push with one decisive primary action.";
  }
  if (blockId.startsWith("footer/")) {
    return "Standard site footer — links, legal, brand mark.";
  }
  return "Section.";
}

// ─────────────────────────────────────────────────────────────────────────────
// Fill mock — parse the block ID from the user message and return that
// block's exampleSlots. The exampleSlots are guaranteed by Session 3 to
// validate against their own slotsSchema, so the orchestrator's parse step
// always succeeds under MOCK_MODE.
// ─────────────────────────────────────────────────────────────────────────────

function fillMock(userMessage: string): unknown {
  const match = userMessage.match(/Block ID:\s*([\w/-]+)/);
  const blockId = match?.[1];
  if (!blockId || !isBlockId(blockId)) {
    // Defensive: if we can't extract a block id, return an empty object.
    // The orchestrator's safeParse will then trigger its retry path, which
    // ultimately falls back to the registry's exampleSlots anyway.
    return {};
  }
  return BLOCK_REGISTRY[blockId].meta.exampleSlots;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function extractBrief(req: TextCallRequest): string {
  const userMsg = req.messages.find((m) => m.role === "user");
  return userMsg?.content ?? "";
}

function extractUserMessage(req: TextCallRequest): string {
  // The fill step's user message holds the block id we want to mock. The
  // brief, if any, is in the same message under "Context:".
  return req.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
}

function inferKey(req: TextCallRequest): string {
  const sys = (req.messages.find((m) => m.role === "system")?.content ?? "").toLowerCase();
  if (sys.includes("classify the brief")) return "classify";
  if (sys.includes("design the landing-page plan")) return "plan";
  if (sys.includes("fill slot values")) return "fill";
  return "classify";
}

const sysSeen = new Set<string>();
function sawSystemPrompt(sys: string): boolean {
  if (!sys) return false;
  const key = hashString(sys).toString();
  const hit = sysSeen.has(key);
  sysSeen.add(key);
  return hit;
}

function aspectToSize(ar: string): { width: number; height: number } {
  switch (ar) {
    case "1:1":
      return { width: 800, height: 800 };
    case "4:3":
      return { width: 800, height: 600 };
    case "3:4":
      return { width: 600, height: 800 };
    case "9:16":
      return { width: 540, height: 960 };
    case "16:9":
    default:
      return { width: 1280, height: 720 };
  }
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Force `randomUUID` to be considered "used" to keep esbuild happy if the
 *  module is ever tree-shaken with side-effect-free flag. (We re-export it
 *  for callers that want stable generation IDs in mock mode.) */
export const generateMockId = () => randomUUID();
