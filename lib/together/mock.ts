import { randomUUID } from "node:crypto";
import type {
  ImageCallRequest,
  TextCallRequest,
} from "./client";
import { priceImageCall, priceTextCall } from "./models";

// ─────────────────────────────────────────────────────────────────────────────
// Mock dispatcher.
//
// Every pipeline step passes a `mockKey` (classify / plan / copy / html /
// refine) plus the original brief text inside one of the messages. The mock
// uses light brief parsing to vary the output so downstream UI work has
// something believable to render, not Lorem Ipsum.
//
// Token counts are rough (chars / 4) but feed real pricing math so cost
// tracking exercises end-to-end. Latency is small and deterministic per kind.
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
    case "copy":
      content = JSON.stringify(copyMock(sig));
      break;
    case "html":
      content = htmlMock(sig);
      break;
    case "refine":
      content = refineMock(sig);
      break;
    case "image_prompts":
      content = JSON.stringify(imagePromptsMock(sig));
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
  // "Landing page for FlowDeck, a Kanban tool for designers"
  // productName: first PascalCase or quoted token after "for"
  const productMatch =
    brief.match(/\bfor\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)?)/) ||
    brief.match(/"([^"]+)"/) ||
    brief.match(/\b([A-Z][a-z]+[A-Z][a-zA-Z]+)\b/); // CamelCase like FlowDeck
  const productName = (productMatch?.[1] || "Acme").trim();

  // audience: prefer an explicit known audience word (designers, developers,
  // founders, …). Fall back to "for X" pattern — case-sensitive lowercase so
  // we don't accidentally capture a PascalCase product name like FlowDeck.
  const audienceMatch =
    brief.match(/\b(designers|developers|founders|marketers|teams|agencies|students|creators)\b/i) ||
    brief.match(/for\s+([a-z][a-z\s]+?)(?:[,.\n]|$)/);
  const audience = audienceMatch ? audienceMatch[1].trim().toLowerCase() : "small teams";

  // industry heuristic
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

  // tone heuristic
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

function planMock(sig: BriefSignal) {
  const sectionSet =
    sig.complexity === "simple"
      ? (["hero", "features", "cta", "footer"] as const)
      : sig.complexity === "rich"
        ? ([
            "hero",
            "features",
            "social_proof",
            "testimonials",
            "pricing",
            "faq",
            "cta",
            "footer",
          ] as const)
        : (["hero", "features", "social_proof", "pricing", "cta", "footer"] as const);

  const sections = sectionSet.map((kind, i) => ({
    id: `sec-${i}-${kind}`,
    kind,
    purpose: purposeFor(kind, sig),
    copyDirection: directionFor(kind, sig),
  }));

  return {
    sections,
    style: {
      palette:
        sig.tone === "bold"
          ? "vibrant"
          : sig.tone === "minimal"
            ? "mono"
            : sig.tone === "playful"
              ? "dual-accent"
              : "dual-accent",
      typography:
        sig.tone === "technical"
          ? "mono"
          : sig.tone === "minimal"
            ? "modern-sans"
            : sig.tone === "playful"
              ? "geometric"
              : "modern-sans",
      density: sig.complexity === "rich" ? "balanced" : "airy",
      mood: `${sig.tone} ${sig.industry} for ${sig.audience}`,
    },
    copyDirection: `Speak directly to ${sig.audience} in a ${sig.tone} register. Lead with a concrete benefit over a feature list.`,
    imagePrompts: imagePromptsMock(sig),
  };
}

function imagePromptsMock(sig: BriefSignal) {
  return [
    {
      id: "img-hero",
      purpose: "hero",
      prompt: `Hero illustration for ${sig.productName}, a ${sig.industry} product aimed at ${sig.audience}. Soft gradient background, ${sig.tone} mood, hint of UI surface in the foreground, no text.`,
      aspectRatio: "16:9",
    },
    {
      id: "img-feature-1",
      purpose: "feature_icon",
      prompt: `Minimal geometric icon representing speed, in the ${sig.tone} palette of ${sig.productName}.`,
      aspectRatio: "1:1",
    },
    {
      id: "img-feature-2",
      purpose: "feature_icon",
      prompt: `Minimal geometric icon representing collaboration, in the ${sig.tone} palette of ${sig.productName}.`,
      aspectRatio: "1:1",
    },
    {
      id: "img-feature-3",
      purpose: "feature_icon",
      prompt: `Minimal geometric icon representing focus, in the ${sig.tone} palette of ${sig.productName}.`,
      aspectRatio: "1:1",
    },
  ];
}

function purposeFor(kind: string, sig: BriefSignal) {
  switch (kind) {
    case "hero":
      return `Anchor headline that lands the core promise of ${sig.productName} in under 8 words.`;
    case "features":
      return "Three concrete capabilities that differentiate this product from competitors.";
    case "social_proof":
      return "Logos / metrics / quote — reduce risk for first-time visitors.";
    case "testimonials":
      return "Two short quotes from real-feeling users in the target audience.";
    case "pricing":
      return "Two or three tiers — anchor on the middle tier as the recommended option.";
    case "faq":
      return "Address the top 4 objections that block conversion.";
    case "cta":
      return "Final push: one big primary action + a soft secondary.";
    case "footer":
      return "Standard site footer — links, legal, brand mark.";
    default:
      return "Generic section.";
  }
}

function directionFor(kind: string, sig: BriefSignal) {
  if (kind === "hero")
    return `One bold sentence, ${sig.tone} register. Specific noun > abstract benefit.`;
  if (kind === "features") return "Title 3-5 words, body 1-2 sentences each.";
  if (kind === "cta") return "Action verb, no marketing fluff.";
  return `${sig.tone} register, concise.`;
}

function copyMock(sig: BriefSignal) {
  const product = sig.productName;
  const aud = sig.audience;
  const sectionTexts = [
    {
      sectionId: "sec-0-hero",
      headline: `${product} — the Kanban that thinks like you do.`,
      subheadline: `Built for ${aud} who are tired of generic project tools.`,
      ctas: [
        { label: "Start free", href: "#signup" },
        { label: "See it in action", href: "#demo" },
      ],
      items: [],
    },
    {
      sectionId: "sec-1-features",
      headline: "Three things you'll feel in the first five minutes",
      items: [
        {
          title: "Boards that move with your thinking",
          description: "Drag cards across columns with momentum-aware physics. No more janky reorder bugs.",
        },
        {
          title: "Comments that read like Notion",
          description: "Threaded, formatted, searchable. Quote a previous comment by drag-selecting it.",
        },
        {
          title: "Keyboard-first by default",
          description: "Every action has a shortcut. Press ? to see them all without leaving the keyboard.",
        },
      ],
      ctas: [],
    },
    {
      sectionId: "sec-2-social_proof",
      headline: "Trusted by teams who care about craft",
      items: [
        { title: "Linear", description: "Used internally" },
        { title: "Figma Labs", description: "Beta partner" },
        { title: "Vercel", description: "Customer since 2025" },
      ],
      ctas: [],
    },
    {
      sectionId: "sec-3-pricing",
      headline: "Pricing that scales with your team, not your patience",
      items: [
        {
          title: "Free",
          description: "Up to 3 boards. Forever.",
          meta: { price: "$0" },
        },
        {
          title: "Team",
          description: "Unlimited boards, SSO, version history.",
          meta: { price: "$8 / seat / mo", recommended: "true" },
        },
        {
          title: "Studio",
          description: "Custom integrations, dedicated success, audit log.",
          meta: { price: "Talk to us" },
        },
      ],
      ctas: [],
    },
    {
      sectionId: "sec-4-cta",
      headline: "Stop wrestling with your tools. Start shipping.",
      subheadline: `Try ${product} free. No credit card. Five minutes to your first board.`,
      ctas: [{ label: "Start free", href: "#signup" }],
      items: [],
    },
    {
      sectionId: "sec-5-footer",
      headline: product,
      body: "Made with care. Open source where it matters.",
      ctas: [
        { label: "GitHub", href: "https://github.com" },
        { label: "Twitter", href: "https://twitter.com" },
      ],
      items: [],
    },
  ];
  return { sectionTexts };
}

function htmlMock(sig: BriefSignal): string {
  const palette = sig.tone === "bold" ? "#FF4D2E" : sig.tone === "minimal" ? "#0A0A0A" : "#5B5BD6";
  // The mock returns a single self-contained document. In real mode the html
  // step returns just a `<main>` fragment + a separate css string; we wrap it
  // here for parity, and `assemble.ts` knows how to extract both halves.
  const product = sig.productName;
  const css = `
:root { --brand: ${palette}; --fg: #0A0A0A; --bg: #FAFAFA; --muted: #6E6E73; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--bg); color: var(--fg); font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; line-height: 1.5; }
.container { max-width: 1100px; margin: 0 auto; padding: 0 1.5rem; }
.hero { padding: 8rem 0 6rem; text-align: center; }
.hero h1 { font-size: clamp(2.5rem, 6vw, 5rem); letter-spacing: -0.03em; font-weight: 700; max-width: 18ch; margin: 0 auto 1.5rem; }
.hero p { font-size: 1.25rem; color: var(--muted); max-width: 42ch; margin: 0 auto 2.5rem; }
.btn { display: inline-block; padding: 0.85rem 1.5rem; border-radius: 999px; font-weight: 600; text-decoration: none; transition: transform 120ms; }
.btn:hover { transform: translateY(-1px); }
.btn-primary { background: var(--brand); color: white; }
.btn-secondary { background: transparent; color: var(--fg); border: 1px solid #E5E5E7; margin-left: 0.5rem; }
.features { padding: 6rem 0; }
.features h2 { font-size: 2.5rem; text-align: center; margin-bottom: 3rem; letter-spacing: -0.02em; }
.feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 2rem; }
.feature { padding: 2rem; background: white; border-radius: 1rem; border: 1px solid #F0F0F2; }
.feature h3 { font-size: 1.25rem; margin-bottom: 0.75rem; }
.feature p { color: var(--muted); }
.cta { padding: 8rem 0; text-align: center; background: var(--fg); color: white; }
.cta h2 { font-size: 3rem; max-width: 20ch; margin: 0 auto 1.5rem; letter-spacing: -0.03em; }
.cta .btn-primary { background: var(--brand); }
footer { padding: 3rem 0; color: var(--muted); text-align: center; font-size: 0.9rem; }
img.hero-img { width: 100%; max-width: 900px; margin: 3rem auto 0; display: block; border-radius: 1rem; box-shadow: 0 30px 60px -20px rgba(0,0,0,0.15); }
  `.trim();

  const html = `
<main>
  <section class="hero">
    <div class="container">
      <h1>${product} — the Kanban that thinks like you do.</h1>
      <p>Built for ${sig.audience} who are tired of generic project tools.</p>
      <a class="btn btn-primary" href="#signup">Start free</a>
      <a class="btn btn-secondary" href="#demo">See it in action</a>
      <img class="hero-img" src="{{HERO_IMAGE}}" alt="${product} interface preview" />
    </div>
  </section>
  <section class="features">
    <div class="container">
      <h2>Three things you'll feel in the first five minutes</h2>
      <div class="feature-grid">
        <article class="feature"><h3>Boards that move with your thinking</h3><p>Drag cards across columns with momentum-aware physics. No more janky reorder bugs.</p></article>
        <article class="feature"><h3>Comments that read like Notion</h3><p>Threaded, formatted, searchable. Quote a previous comment by drag-selecting it.</p></article>
        <article class="feature"><h3>Keyboard-first by default</h3><p>Every action has a shortcut. Press ? to see them all without leaving the keyboard.</p></article>
      </div>
    </div>
  </section>
  <section class="cta">
    <div class="container">
      <h2>Stop wrestling with your tools. Start shipping.</h2>
      <a class="btn btn-primary" href="#signup">Start free</a>
    </div>
  </section>
  <footer><div class="container">${product} · Made with care.</div></footer>
</main>
  `.trim();

  return JSON.stringify({ html, css });
}

function refineMock(sig: BriefSignal): string {
  return JSON.stringify({
    patches: [
      {
        target: "hero h1",
        before: "Kanban that thinks like you do",
        after: `Kanban for ${sig.audience} who think in flows, not lists`,
        rationale: "Sharpens the audience anchor in the hero headline.",
      },
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function extractBrief(req: TextCallRequest): string {
  const userMsg = req.messages.find((m) => m.role === "user");
  return userMsg?.content ?? "";
}

function inferKey(req: TextCallRequest): string {
  const sys = (req.messages.find((m) => m.role === "system")?.content ?? "").toLowerCase();
  if (sys.includes("classify")) return "classify";
  if (sys.includes("plan")) return "plan";
  if (sys.includes("copy")) return "copy";
  if (sys.includes("html")) return "html";
  if (sys.includes("refine")) return "refine";
  if (sys.includes("image")) return "image_prompts";
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
