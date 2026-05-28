// LIVE integration test for the vision critic — real puppeteer render + real
// Gemini Flash multimodal call. Gated on GEMINI_API_KEY (skipped without it,
// like crates/ai-gateway/__test__/live.test.mjs) and REQUIRES the rebuilt
// @openlen/ai-gateway .node (structured-output support).
//
// Run via: npx tsx --test lib/ai/vision-critique.live.test.ts
//
// These assertions exercise the critic's discriminative power: an
// intentionally broken page must trigger a regen; a polished page must not.
// The absolute pass/fail on the GOOD page is model-dependent — if it flakes,
// the discriminative invariant (good scores strictly higher than bad) is the
// load-bearing check.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { critiqueGeneratedPage } from "./vision-critique";

const HAS_KEY = !!process.env.GEMINI_API_KEY;
const CRITIC_MODEL = "gemini-3.5-flash";

// Intentionally broken: an empty hero + five empty divs. No copy, no layout.
const BAD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>x</title></head>
<body style="margin:0">
<section style="height:240px;background:#fff"><h1></h1></section>
<div></div><div></div><div></div><div></div><div></div>
</body></html>`;

// A genuinely polished, complete landing page (hero + features + pricing +
// footer, real copy, gradient mockup, Tailwind + Inter).
const GOOD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Orbit — Async standups for remote teams</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>:root{--accent:#6366f1}body{font-family:Inter,system-ui,sans-serif}</style>
</head>
<body class="bg-white text-slate-900 antialiased">
<header class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
  <span class="font-semibold tracking-tight">Orbit</span>
  <nav class="hidden sm:flex gap-8 text-sm text-slate-600"><a href="#features">Features</a><a href="#pricing">Pricing</a></nav>
  <a href="#" class="text-sm font-medium px-4 py-2 rounded-lg text-white" style="background:var(--accent)">Get started</a>
</header>
<section class="max-w-6xl mx-auto px-6 pt-20 pb-24 grid md:grid-cols-2 gap-12 items-center">
  <div>
    <h1 class="text-5xl font-bold tracking-tight leading-[1.05]">Standups that don't<br>steal your morning.</h1>
    <p class="mt-6 text-lg text-slate-600 max-w-md">Orbit collects async updates from your team and posts a tidy digest to Slack — no meeting required.</p>
    <div class="mt-8 flex gap-3"><a href="#" class="px-5 py-3 rounded-lg text-white font-medium" style="background:var(--accent)">Start free</a><a href="#" class="px-5 py-3 rounded-lg border border-slate-200 font-medium">Book a demo</a></div>
  </div>
  <div class="aspect-[4/3] rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-500 shadow-2xl"></div>
</section>
<section id="features" class="max-w-6xl mx-auto px-6 py-20 grid sm:grid-cols-3 gap-8">
  <div><div class="h-10 w-10 rounded-lg bg-indigo-100"></div><h3 class="mt-4 font-semibold">Async by default</h3><p class="mt-2 text-sm text-slate-600">Reply on your schedule. Orbit nudges, never interrupts.</p></div>
  <div><div class="h-10 w-10 rounded-lg bg-indigo-100"></div><h3 class="mt-4 font-semibold">Slack digests</h3><p class="mt-2 text-sm text-slate-600">A clean summary in your team channel every morning.</p></div>
  <div><div class="h-10 w-10 rounded-lg bg-indigo-100"></div><h3 class="mt-4 font-semibold">Blocker alerts</h3><p class="mt-2 text-sm text-slate-600">Flag what's stuck so leads can jump in fast.</p></div>
</section>
<section id="pricing" class="max-w-6xl mx-auto px-6 py-20 text-center">
  <h2 class="text-3xl font-bold tracking-tight">Simple pricing</h2>
  <div class="mt-10 inline-block text-left p-8 rounded-2xl border border-slate-200 shadow-sm">
    <div class="text-4xl font-bold">$8<span class="text-base font-normal text-slate-500">/user/mo</span></div>
    <ul class="mt-6 space-y-2 text-sm text-slate-600"><li>Unlimited standups</li><li>Slack + email digests</li><li>14-day free trial</li></ul>
    <a href="#" class="mt-8 block text-center px-5 py-3 rounded-lg text-white font-medium" style="background:var(--accent)">Start free</a>
  </div>
</section>
<footer class="border-t border-slate-100 py-10 text-center text-sm text-slate-500">© 2026 Orbit. All rights reserved.</footer>
</body></html>`;

test(
  "live: intentionally broken page triggers a regen",
  { skip: HAS_KEY ? false : "GEMINI_API_KEY not set" },
  async () => {
    const verdict = await critiqueGeneratedPage({
      brief: "A landing page for Orbit, an async standup tool for remote teams.",
      html: BAD_HTML,
      model: CRITIC_MODEL,
    });
    // eslint-disable-next-line no-console
    console.log("[live] BAD verdict:", JSON.stringify(verdict));
    assert.equal(verdict.fallback, false, "critic must actually run (got fallback — check rebuilt .node + network)");
    assert.equal(verdict.shouldRegenerate, true, "a broken page must regenerate");
    assert.ok(
      verdict.regenerationFeedback.length > 0,
      "regenerationFeedback must be non-empty when regenerating",
    );
  },
);

test(
  "live: polished page does not regenerate (and scores higher than broken)",
  { skip: HAS_KEY ? false : "GEMINI_API_KEY not set" },
  async () => {
    const good = await critiqueGeneratedPage({
      brief: "A landing page for Orbit, an async standup tool for remote teams.",
      html: GOOD_HTML,
      model: CRITIC_MODEL,
    });
    const bad = await critiqueGeneratedPage({
      brief: "A landing page for Orbit, an async standup tool for remote teams.",
      html: BAD_HTML,
      model: CRITIC_MODEL,
    });
    // eslint-disable-next-line no-console
    console.log("[live] GOOD verdict:", JSON.stringify(good));
    assert.equal(good.fallback, false, "critic must actually run");
    // Discriminative invariant — robust regardless of absolute calibration.
    assert.ok(
      good.visualQuality > bad.visualQuality,
      `good (${good.visualQuality}) must score higher than bad (${bad.visualQuality})`,
    );
    // Spec target — model-dependent; the discriminative check above is the
    // load-bearing assertion.
    assert.equal(good.shouldRegenerate, false, "a polished page should not regenerate");
  },
);
