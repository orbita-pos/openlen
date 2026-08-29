// Quality S3 smoke: generate the canonical 3 briefs (same as S1/S2), run the
// vision critic on each, and report the verdict + whether a regen would fire.
//
//   npm run ai:smoke-vision-critic                  # generator = gemini-flash
//   npm run ai:smoke-vision-critic
//
// Expected outcome: 0 of 3 regen (all should score ≥7 — we're at ~98% post-S2).
// If any DOES regen, the issues are logged for analysis. Requires:
//   - GEMINI_API_KEY in .env.local
//   - the REBUILT @openlen/ai-gateway .node (structured-output support)
//   - puppeteer Chromium installed (the critic renders the page)
//
// This mirrors /api/generate's generation closely but standalone — it injects
// a no-op credit debit and treats the reference template as best-effort, so it
// needs no auth, no credit ledger, and degrades to text-only without a DB.

export {};

import { generateHtmlStream } from "@/lib/ai-stream/generate";
import { critiqueGeneratedPage } from "@/lib/ai/vision-critique";
import { selectReferenceTemplate } from "@/lib/templates/select-reference";
import { fetchImageAsInlineData } from "@/lib/ai/inline-image";
import { DESIGN_GUIDANCE } from "@/lib/design-guidance";
import type { InlineImage, Message } from "@/lib/ai-gateway";

const BRIEFS: { label: string; brief: string }[] = [
  {
    label: "Pulsegrid (SaaS)",
    brief:
      "Pulsegrid — a B2B analytics dashboard that turns product telemetry into churn-risk metrics for SaaS teams.",
  },
  {
    label: "Mariana (portfolio)",
    brief:
      "Portafolio de Mariana Vásquez, fotógrafa de bodas y retrato editorial en Lima. Galería de su trabajo y proceso.",
  },
  {
    label: "Niccolò (restaurant)",
    brief:
      "Trattoria Niccolò — auténtica cocina italiana de Bolonia, pasta fresca y carta de vinos. Reserva tu mesa.",
  },
];

// Faithful (compact) mirror of /api/generate's system prompt — enough to
// produce a complete, polished landing page to critique. The route's full
// prompt lives in app/api/generate/route.ts; this is a smoke tool, not prod.
const SMOKE_SYSTEM_PROMPT = `You are a senior product designer-engineer hybrid with the eye of Linear, Vercel, Stripe, and Resend. You generate complete, production-grade landing pages from a short brief. You have FULL CREATIVE FREEDOM and the user trusts your taste.

${DESIGN_GUIDANCE}

NON-NEGOTIABLE CONSTRAINTS:
- Output a COMPLETE, self-contained HTML document: starts with <!doctype html>, ends with </html>.
- Include a descriptive <title> naming the product.
- Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
- Google Fonts via <link> in <head>. Allowed: Inter, Geist, Fraunces, Source Serif 4, Crimson Pro, JetBrains Mono.
- All custom CSS inline in a <style> block. Use CSS custom properties on :root for design tokens.
- NO React/Babel/JSX/import statements. NO data-slot-path= attribute. NO login/signup/dashboard UI.
- Inline SVG for logos/icons. NO external image URLs — use a <div> with a bg-gradient-to-br placeholder for imagery.
- Mobile-responsive down to 360px.
Emit the complete HTML document directly, starting with <!doctype html>. No preamble, no markdown fences.`;

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function generatePage(
  brief: string,

): Promise<string | null> {
  let images: InlineImage[] | undefined;
  let briefBlock = `BRIEF:\n${brief}`;
  try {
    const ref = await selectReferenceTemplate(brief);
    if (ref) {
      const img = await fetchImageAsInlineData(ref.screenshotUrl);
      if (img) {
        images = [img];
        briefBlock = `<reference family="${ref.family}" id="${ref.id}">
The attached image is a high-quality landing page from our curated set. Match its visual quality, density, spacing discipline, and aesthetic polish. Adapt the layout to fit the brief — do NOT copy sections verbatim.
</reference>

BRIEF:
${brief}`;
        // eslint-disable-next-line no-console
        console.log(`  · reference template: ${ref.id} (family=${ref.family})`);
      }
    }
  } catch {
    // eslint-disable-next-line no-console
    console.log("  · no reference (DB unavailable) — text-only generation");
  }

  const messages: Message[] = [
    { role: "system", content: SMOKE_SYSTEM_PROMPT },
    { role: "user", content: briefBlock },
  ];

  const { stream, done } = generateHtmlStream(
    {
      messages,
      images,
      userId: "smoke",
      htmlOpts: { injectOpIds: false },
      maxOutputTokens: 65_536,
      temperature: 0.8,
    },
    // Standalone smoke — never touch the credit ledger.
    { debit: async () => {} },
  );

  const reader = stream.getReader();
  while (true) {
    const { done: d } = await reader.read();
    if (d) break;
  }
  const summary = await done;
  return summary.finalHtml;
}

async function main(): Promise<void> {
  // Los ojos van por Fireworks: aqui se pedia la clave de Gemini, que este
  // smoke ya no usa para nada.
  if (!process.env.FIREWORKS_API_KEY?.trim()) {
    console.error("FIREWORKS_API_KEY missing from env (.env.local).");
    process.exit(2);
  }

  let regens = 0;
  let worstCriticMs = 0;

  for (const { label, brief } of BRIEFS) {
    // eslint-disable-next-line no-console
    console.log(`\n=== ${label} ===`);
    const html = await generatePage(brief);
    if (!html) {
      // eslint-disable-next-line no-console
      console.error(`  ✗ generation produced no HTML — skipping critique`);
      continue;
    }
    // eslint-disable-next-line no-console
    console.log(`  · generated ${html.length} chars; critiquing…`);

    const t0 = Date.now();
    const verdict = await critiqueGeneratedPage({
      brief,
      html,

    });
    const criticMs = Date.now() - t0;
    worstCriticMs = Math.max(worstCriticMs, criticMs);

    if (verdict.shouldRegenerate) regens += 1;
    // eslint-disable-next-line no-console
    console.log(
      `  → visualQuality=${verdict.visualQuality} briefAdherence=${verdict.briefAdherence} shouldRegenerate=${verdict.shouldRegenerate} fallback=${verdict.fallback} critic=${criticMs}ms`,
    );
    if (verdict.issues.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`  · issues: ${verdict.issues.join(" | ")}`);
    }
    if (verdict.shouldRegenerate) {
      // eslint-disable-next-line no-console
      console.log(`  · regenerationFeedback: ${verdict.regenerationFeedback}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `\n=== summary: ${regens}/${BRIEFS.length} would regen · worst critic latency ${worstCriticMs}ms ===`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
