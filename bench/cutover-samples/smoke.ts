// F3 S4 cutover smoke — generates real samples against Gemini for visual
// inspection. Mirrors what the route handlers do end-to-end (system prompt,
// generateHtmlStream pipeline, born-canonical normalize on end()) but
// without the HTTP / DB / auth layer in the way.
//
// Run with:
//   node --env-file=../../.env.local --import tsx \
//     D:/worktrees/openlen-f3-s4/bench/cutover-samples/smoke.ts
//
// Output:
//   bench/cutover-samples/generate/<slug>-gemini.html      — page-gen samples
//   bench/cutover-samples/ai-design/<slug>-gemini.html     — chat-edit samples
//   bench/cutover-samples/SUMMARY.md                       — run report

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateHtmlStream } from "../../lib/ai-stream/generate";
import { GeminiProvider, type Message } from "../../lib/ai-gateway";
import {
  detectSlotPath,
  tagWithOpIds,
  parseOps,
  applyOps,
  stripOpIds,
} from "../../lib/html-engine";
import { normalizeBornCanonical } from "../../lib/normalize";
import { DESIGN_GUIDANCE } from "../../lib/design-guidance";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = __dirname;
const GENERATE_DIR = resolve(OUT_DIR, "generate");
const AI_DESIGN_DIR = resolve(OUT_DIR, "ai-design");

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY missing — set in .env.local or env");
  process.exit(1);
}

function stripMarkdownFences(s: string): string {
  let out = s.trim();
  out = out.replace(/^```(?:html|xml)?[\t ]*\r?\n?/i, "");
  out = out.replace(/\r?\n?[\t ]*```\s*$/i, "");
  return out.trim();
}

// ─── /api/generate samples ──────────────────────────────────────────────────

const GENERATE_SYSTEM_PROMPT = `You are a senior product designer-engineer hybrid with the eye of Linear, Vercel, Stripe, and Resend. You generate complete, production-grade landing pages from a short brief.

The user gives you a brief — sometimes specific, often vague or generic. Design and build the entire landing page yourself. You have FULL CREATIVE FREEDOM and the user trusts your taste. A vague or generic brief is your cue to apply judgment and taste, NOT to ask questions or fall back on something safe and forgettable.

${DESIGN_GUIDANCE}

OUTPUT EFFICIENCY (critical — long documents truncate against the response cap):
- No HTML comments (<!-- ... -->) anywhere in the output.
- No multi-line whitespace inside elements. Single-line each element when reasonable.
- Reuse Tailwind classes — if a card pattern repeats across siblings, give it one class in <style> and apply it instead of pasting the long class string.
- Collapse redundant CSS rules. No "/* Pricing */"-style section dividers in <style>.
- Inline <svg>: only emit what's needed; skip xmlns when duplicated across many siblings.
- Skip blank lines between sections of the document. Compact.
- Goal: same visual quality, fewer tokens.

NON-NEGOTIABLE CONSTRAINTS:
- Output a COMPLETE, self-contained HTML document: starts with <!doctype html>, ends with </html>.
- Include a descriptive <title> in <head> that names the product.
- Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
- Google Fonts via <link> in <head>. Allowed families: Inter, Geist, Fraunces, Source Serif 4, Crimson Pro, JetBrains Mono.
- All custom CSS inline in a <style> block in <head>. Use CSS custom properties on :root for design tokens (--accent, --accent-r as an RGB triplet, --bg, --surface, --fg, --border, --font-display, --font-body, --radius). Reference them via var() throughout — never hardcode the same color in many places. Also emit a \`:root.dark { … }\` block that redefines --bg, --surface, --fg, --border and --accent with hand-designed dark-theme values (a real dark palette — not a mechanical inversion); every text and heading color MUST resolve from a var() token so the whole page flips cleanly.
- NO React, NO Babel, NO JSX, NO <script type="text/babel">, NO window.X globals, NO import statements anywhere.
- NO data-slot-path= attribute anywhere — that is a reserved editor-mode marker.
- NO login / signup / "my account" / dashboard UI. Public marketing pages only.
- Inline SVG for logos / icons / illustrations. NO external image URLs. For hero / product imagery use a <div> with a tasteful bg-gradient-to-br placeholder.
- Mobile-responsive down to 360px width.

OUTPUT FORMAT — follow exactly:
Emit the complete HTML document directly, starting with <!doctype html> and ending with </html>. No preamble, no design notes, no markdown code fences — the first character of your response is <.`;

const GENERATE_BRIEFS: Array<{ slug: string; brief: string }> = [
  {
    slug: "linear-clone",
    brief: "Linear-style landing page for a developer-focused issue tracker called Beam. Dark canvas, indigo accent, restrained type, single hero, feature grid, pricing.",
  },
  {
    slug: "coffee-shop",
    brief: "Landing page for a single-origin specialty coffee shop in Mexico City called Caracol. Warm cream backdrop, editorial serif headlines, a hero image placeholder, a section about origins, a menu preview, hours + address.",
  },
  {
    slug: "ai-product-with-form",
    brief: "Landing page for an AI-powered customer-support tool called Calliope. Bright optimistic palette, hero with a waitlist email signup form, three feature blocks, social proof testimonials, FAQ accordion, footer.",
  },
];

async function runGenerateSamples(): Promise<Array<{ slug: string; ok: boolean; bytes: number; durationMs: number; note: string }>> {
  await mkdir(GENERATE_DIR, { recursive: true });
  const results: Array<{ slug: string; ok: boolean; bytes: number; durationMs: number; note: string }> = [];

  for (const { slug, brief } of GENERATE_BRIEFS) {
    console.log(`\n[generate/${slug}] brief: ${brief.slice(0, 60)}…`);
    const t0 = Date.now();
    const messages: Message[] = [
      { role: "system", content: GENERATE_SYSTEM_PROMPT },
      { role: "user", content: `BRIEF:\n${brief}` },
    ];

    const { stream, done } = generateHtmlStream({
      apiKey: apiKey!,
      messages,
      model: "gemini-pro",
      userId: "smoke-test",
      htmlOpts: { injectOpIds: false },
      maxOutputTokens: 65_536,
      temperature: 0.8,
      // Skip the live debit during smoke — there is no real user / DB.
    }, {
      debit: async () => { /* no-op */ },
    });

    // Drain stream (mirroring what the route handler does).
    const reader = stream.getReader();
    while (true) {
      const { done: rDone } = await reader.read();
      if (rDone) break;
    }

    const summary = await done;
    const durationMs = Date.now() - t0;

    if (summary.stopKind === "error" || !summary.finalHtml) {
      const note = `error: ${summary.error?.message ?? "unknown"}`;
      console.error(`[generate/${slug}] FAILED — ${note}`);
      results.push({ slug, ok: false, bytes: 0, durationMs, note });
      continue;
    }
    // Strip a possible leading/trailing markdown fence pair — Gemini
    // occasionally wraps the output in ```html...``` despite the system
    // prompt forbidding it. Same fence-strip the route handler does.
    const html = stripMarkdownFences(summary.finalHtml);
    const valid =
      html.length >= 1000 &&
      /^<!doctype/i.test(html) &&
      /<\/html>\s*$/i.test(html) &&
      !detectSlotPath(html);
    if (!valid) {
      const note = `validation failed (len=${html.length}, head=${html.slice(0, 40)})`;
      console.error(`[generate/${slug}] INVALID — ${note}`);
      const path = resolve(GENERATE_DIR, `${slug}-gemini-INVALID.html`);
      await writeFile(path, html, "utf-8");
      results.push({ slug, ok: false, bytes: html.length, durationMs, note });
      continue;
    }

    const path = resolve(GENERATE_DIR, `${slug}-gemini.html`);
    await writeFile(path, html, "utf-8");
    const tokens = summary.usage
      ? `${summary.usage.inputTokens}→${summary.usage.outputTokens}`
      : "?";
    const note = `tokens=${tokens} stopKind=${summary.stopKind}`;
    console.log(
      `[generate/${slug}] OK — ${html.length} bytes in ${(durationMs / 1000).toFixed(1)}s · ${note}`,
    );
    results.push({
      slug,
      ok: true,
      bytes: html.length,
      durationMs,
      note,
    });
  }
  return results;
}

// ─── /api/templates/ai-design samples ───────────────────────────────────────

// Tiny canonical landing page used as the "before" state for chat-edit turns.
// Has enough structure (nav, hero, features, footer) for Mode A + Mode B
// turns to land meaningfully.
const SEED_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Beam — Issue tracker for fast teams</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --accent: #5E6AD2;
      --accent-r: 94 106 210;
      --bg: #FAFAFA;
      --surface: #FFFFFF;
      --fg: #111;
      --border: #E5E5E5;
      --font-body: 'Inter', sans-serif;
      --font-display: 'Inter', sans-serif;
      --radius: 8px;
    }
    body { background: var(--bg); color: var(--fg); font-family: var(--font-body); }
    .cta { background: var(--accent); color: white; padding: 10px 20px; border-radius: var(--radius); }
  </style>
</head>
<body class="antialiased">
  <header class="px-8 py-6 flex items-center justify-between">
    <div class="font-bold text-lg">Beam</div>
    <nav class="flex gap-6 text-sm">
      <a href="#features">Features</a>
      <a href="#pricing">Pricing</a>
      <a href="#about">About</a>
    </nav>
  </header>
  <main>
    <section class="px-8 py-24 text-center">
      <h1 class="text-5xl font-bold mb-4">Track issues at the speed of thought</h1>
      <p class="text-lg text-neutral-600 mb-8 max-w-xl mx-auto">Beam is the issue tracker engineering teams reach for when Linear feels heavy.</p>
      <a href="#start" class="cta">Get started</a>
    </section>
    <section id="features" class="px-8 py-16 grid grid-cols-3 gap-8 max-w-5xl mx-auto">
      <div>
        <h3 class="font-semibold mb-2">Keyboard first</h3>
        <p class="text-sm text-neutral-600">Every action has a shortcut. Built for the keyboard, not the mouse.</p>
      </div>
      <div>
        <h3 class="font-semibold mb-2">Sub-100ms</h3>
        <p class="text-sm text-neutral-600">Local-first sync means your UI never waits for the server.</p>
      </div>
      <div>
        <h3 class="font-semibold mb-2">Honest pricing</h3>
        <p class="text-sm text-neutral-600">One flat price. No seat math. No enterprise rug pull.</p>
      </div>
    </section>
  </main>
  <footer class="px-8 py-12 border-t text-sm text-neutral-500">
    © 2026 Beam Inc.
  </footer>
</body>
</html>`;

const AI_DESIGN_SYSTEM_PROMPT = `You are a senior product designer with the eye of Linear, Vercel, Stripe, and Resend. You design polished, opinionated landing pages.

You are editing a single landing page HTML document for a user. They speak conversationally. Read their request, understand the intent, and rewrite the page to match.

OUTPUT FORMAT — follow exactly:
First, write 1-3 sentences of design reasoning. Plain prose.
Then a blank line.
Then the literal marker on its own line: ---HTML---
Then either an <edits>...</edits> ops block (Mode A, preferred for small changes — address by data-op-id; max 8 ops) OR a complete <!doctype>...</html> rewrite (Mode B, for tonal changes).

The CURRENT DOCUMENT below has \`data-op-id\` attributes injected on every element. Use these IDs in Mode A:
  <edits>
    <edit op="replace" target="a4"><new><h1>Catch agents…</h1></new></edit>
  </edits>

DO NOT include data-op-id in your output (server-injected).
DO NOT wrap any block in markdown code fences.`;

const AI_DESIGN_TURNS: Array<{
  slug: string;
  prompt: string;
  expectMode: "ops" | "rewrite";
}> = [
  {
    slug: "mode-a-headline-cta",
    prompt: "Make the hero headline shorter — 'Issues, solved fast.' — and change the CTA text to 'Start free trial'.",
    expectMode: "ops",
  },
  {
    slug: "mode-b-editorial-rebuild",
    prompt: "Rebuild this whole page in an editorial style: Fraunces serif headlines, cream paper backdrop, hairline borders. Keep the structure but change the entire visual language.",
    expectMode: "rewrite",
  },
  {
    slug: "mode-b-dark-cinematic",
    prompt: "Switch to dark cinematic — deep slate background, indigo accent, generous whitespace, big display headline. Also swap the feature grid to two columns of detailed cards instead of three thin ones.",
    expectMode: "rewrite",
  },
];

async function runAiDesignSamples(): Promise<Array<{ slug: string; ok: boolean; mode: string; bytes: number; durationMs: number; note: string }>> {
  await mkdir(AI_DESIGN_DIR, { recursive: true });
  const results: Array<{ slug: string; ok: boolean; mode: string; bytes: number; durationMs: number; note: string }> = [];

  const { taggedHtml } = tagWithOpIds(SEED_HTML);

  for (const turn of AI_DESIGN_TURNS) {
    console.log(`\n[ai-design/${turn.slug}] prompt: ${turn.prompt.slice(0, 60)}…`);
    const t0 = Date.now();
    const userMsg = `CURRENT DOCUMENT (every element has a server-injected \`data-op-id\` attribute — use those values in Mode A's <edit target="..."> calls):

${taggedHtml}

USER REQUEST:
${turn.prompt}`;
    const messages: Message[] = [
      { role: "system", content: AI_DESIGN_SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ];

    const provider = new GeminiProvider(apiKey!);
    const events = provider.stream(
      {
        model: "gemini-2.5-pro",
        messages,
        maxOutputTokens: 65_536,
        temperature: 0.8,
      },
      {},
    );

    let acc = "";
    let usage: { inputTokens: number; outputTokens: number } | null = null;
    let stopKind: string | null = null;
    try {
      for await (const event of events) {
        if (event.type === "text_delta") acc += event.text;
        else if (event.type === "usage")
          usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
        else if (event.type === "done") {
          stopKind = event.stopReason.kind;
          break;
        }
      }
    } catch (err) {
      const note = `stream error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[ai-design/${turn.slug}] FAILED — ${note}`);
      results.push({ slug: turn.slug, ok: false, mode: "?", bytes: 0, durationMs: Date.now() - t0, note });
      continue;
    }

    // Split on ---HTML--- marker.
    const idx = acc.indexOf("---HTML---");
    if (idx < 0) {
      const note = `no ---HTML--- marker in output (first 200: ${acc.slice(0, 200)})`;
      console.error(`[ai-design/${turn.slug}] INVALID — ${note}`);
      const path = resolve(AI_DESIGN_DIR, `${turn.slug}-gemini-RAW.txt`);
      await writeFile(path, acc, "utf-8");
      results.push({ slug: turn.slug, ok: false, mode: "?", bytes: acc.length, durationMs: Date.now() - t0, note });
      continue;
    }
    const reasoning = acc.slice(0, idx).trim();
    let body = acc.slice(idx + "---HTML---".length).replace(/^\r?\n/, "");
    // Strip markdown fences if any.
    body = body.replace(/^```(?:html|xml)?[\t ]*\r?\n?/i, "").replace(/\r?\n?[\t ]*```\s*$/i, "").trim();

    const isOps = /^\s*<edits[\s>]/i.test(body);
    let finalHtml: string;
    let mode: "ops" | "rewrite";

    if (isOps) {
      mode = "ops";
      const { ops, errors: parseErrors } = parseOps(body);
      if (ops.length === 0) {
        const note = `parse failed: ${parseErrors[0] ?? "no ops"}`;
        console.error(`[ai-design/${turn.slug}] INVALID — ${note}`);
        results.push({ slug: turn.slug, ok: false, mode, bytes: 0, durationMs: Date.now() - t0, note });
        continue;
      }
      const applyResult = applyOps(taggedHtml, ops);
      if (applyResult.html === null) {
        const note = `apply failed: ${applyResult.errors[0]?.reason ?? "unknown"}`;
        console.error(`[ai-design/${turn.slug}] INVALID — ${note}`);
        results.push({ slug: turn.slug, ok: false, mode, bytes: 0, durationMs: Date.now() - t0, note });
        continue;
      }
      finalHtml = normalizeBornCanonical(stripOpIds(applyResult.html));
    } else {
      mode = "rewrite";
      const stripped = stripOpIds(body);
      finalHtml = normalizeBornCanonical(stripped);
    }

    if (detectSlotPath(finalHtml)) {
      const note = "slot-path detected after apply/strip";
      console.error(`[ai-design/${turn.slug}] INVALID — ${note}`);
      results.push({ slug: turn.slug, ok: false, mode, bytes: finalHtml.length, durationMs: Date.now() - t0, note });
      continue;
    }

    const path = resolve(AI_DESIGN_DIR, `${turn.slug}-gemini.html`);
    await writeFile(path, finalHtml, "utf-8");
    const meta = resolve(AI_DESIGN_DIR, `${turn.slug}-gemini.reasoning.txt`);
    await writeFile(meta, reasoning, "utf-8");
    const tokens = usage ? `${usage.inputTokens}→${usage.outputTokens}` : "?";
    const note = `mode=${mode} tokens=${tokens} stopKind=${stopKind}`;
    console.log(
      `[ai-design/${turn.slug}] OK — ${finalHtml.length} bytes in ${((Date.now() - t0) / 1000).toFixed(1)}s · ${note}${turn.expectMode !== mode ? ` (expected ${turn.expectMode})` : ""}`,
    );
    results.push({
      slug: turn.slug,
      ok: true,
      mode,
      bytes: finalHtml.length,
      durationMs: Date.now() - t0,
      note,
    });
  }
  return results;
}

// ─── SUMMARY.md report ──────────────────────────────────────────────────────

function makeSummary(
  generateResults: Awaited<ReturnType<typeof runGenerateSamples>>,
  aiDesignResults: Awaited<ReturnType<typeof runAiDesignSamples>>,
): string {
  const lines: string[] = [];
  lines.push("# F3 S4 cutover — visual quality samples");
  lines.push("");
  lines.push(`Run date: ${new Date().toISOString()}`);
  lines.push(`Provider: Gemini 2.5 Pro via @openlen/ai-gateway`);
  lines.push("");
  lines.push("## /api/generate samples");
  lines.push("");
  lines.push("| Slug | Status | Bytes | Duration | Notes |");
  lines.push("|---|---|---|---|---|");
  for (const r of generateResults) {
    lines.push(
      `| ${r.slug} | ${r.ok ? "✓" : "✗"} | ${r.bytes.toLocaleString()} | ${(r.durationMs / 1000).toFixed(1)}s | ${r.note} |`,
    );
  }
  lines.push("");
  lines.push("## /api/templates/ai-design samples");
  lines.push("");
  lines.push("| Slug | Status | Mode | Bytes | Duration | Notes |");
  lines.push("|---|---|---|---|---|---|");
  for (const r of aiDesignResults) {
    lines.push(
      `| ${r.slug} | ${r.ok ? "✓" : "✗"} | ${r.mode} | ${r.bytes.toLocaleString()} | ${(r.durationMs / 1000).toFixed(1)}s | ${r.note} |`,
    );
  }
  lines.push("");
  lines.push("## Operator follow-up");
  lines.push("");
  lines.push("Open each `*-gemini.html` file in a browser to verify the visual quality matches the pre-cutover Kimi era. Specifically check:");
  lines.push("- Page actually renders end-to-end (no JS errors, no half-rendered hero)");
  lines.push("- Typography hierarchy looks intentional (display vs body, accent color usage)");
  lines.push("- Mobile responsiveness down to 360px");
  lines.push("- Born-canonical markers landed (`<script data-ol-radius>`, etc. — inspect the head)");
  lines.push("");
  lines.push("If any sample looks visually worse than its Kimi-era equivalent, flag in the F3 S4 handoff before merging.");
  return lines.join("\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("F3 S4 cutover smoke — generating real Gemini samples");
  console.log(`Key: ${apiKey!.slice(0, 8)}…${apiKey!.slice(-4)}`);
  const generateResults = await runGenerateSamples();
  const aiDesignResults = await runAiDesignSamples();
  const summary = makeSummary(generateResults, aiDesignResults);
  const summaryPath = resolve(OUT_DIR, "SUMMARY.md");
  await writeFile(summaryPath, summary, "utf-8");
  console.log(`\nSummary written to ${summaryPath}`);
  const allOk =
    generateResults.every((r) => r.ok) && aiDesignResults.every((r) => r.ok);
  if (!allOk) {
    console.error(
      "\nOne or more samples failed — see SUMMARY.md and per-file output",
    );
    process.exit(1);
  }
  console.log("\nAll samples generated cleanly.");
}

main().catch((err) => {
  console.error("smoke script failed:", err);
  process.exit(1);
});
