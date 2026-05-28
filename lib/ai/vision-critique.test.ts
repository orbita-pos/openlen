// Unit tests for lib/ai/vision-critique.ts — fully mocked (no puppeteer, no
// network). The provider + render are injected via the `internals` hook so
// these exercise the critic's control flow and JSON handling in isolation.
//
// Run via: npx tsx --test lib/ai/vision-critique.test.ts
//
// The live, multimodal integration test (real Gemini + real render) lives in
// vision-critique.live.test.ts and is gated on GEMINI_API_KEY.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  critiqueGeneratedPage,
  parseVerdict,
  structuralSummary,
  DEFAULT_TIMEOUT_MS,
  type CritiqueProviderLike,
} from "./vision-critique";
import type { InlineImage, StreamEvent, StreamRequest } from "../ai-gateway";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FAKE_IMAGE: InlineImage = { mimeType: "image/jpeg", dataBase64: "QUJD" };
const fakeRender = async (): Promise<InlineImage | null> => FAKE_IMAGE;

function scriptedProvider(
  events: StreamEvent[],
  capture?: (r: StreamRequest) => void,
): CritiqueProviderLike {
  return {
    stream(request, _opts) {
      capture?.(request);
      return (async function* (): AsyncIterableIterator<StreamEvent> {
        for (const ev of events) yield ev;
      })();
    },
  };
}

/** Provider that emits nothing and only ends once its signal is aborted —
 *  simulates a stalled Gemini call so the deadline can fire. */
function hangingProvider(): CritiqueProviderLike {
  return {
    stream(_request, opts) {
      return (async function* (): AsyncIterableIterator<StreamEvent> {
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) return resolve();
          opts.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
      })();
    },
  };
}

function verdictJson(
  overrides: Partial<{
    visualQuality: number;
    briefAdherence: number;
    issues: string[];
    shouldRegenerate: boolean;
    regenerationFeedback: string;
  }> = {},
): string {
  return JSON.stringify({
    visualQuality: 8,
    briefAdherence: 9,
    issues: [],
    shouldRegenerate: false,
    regenerationFeedback: "",
    ...overrides,
  });
}

const baseParams = {
  brief: "A landing page for my B2B SaaS analytics platform",
  html: "<section><h1>Hero</h1></section>",
  model: "gemini-3.5-flash",
  apiKey: "TEST-KEY",
};

// ─── critiqueGeneratedPage ────────────────────────────────────────────────────

test("parses a clean JSON verdict correctly", async () => {
  const json = verdictJson({ visualQuality: 8, briefAdherence: 9 });
  let captured: StreamRequest | undefined;
  const provider = scriptedProvider(
    [
      { type: "start", id: "x" },
      // Split across two deltas to prove accumulation.
      { type: "text_delta", text: json.slice(0, 12) },
      { type: "text_delta", text: json.slice(12) },
      { type: "usage", inputTokens: 100, outputTokens: 20 },
      { type: "done", stopReason: { kind: "end_turn" } },
    ],
    (r) => {
      captured = r;
    },
  );

  const verdict = await critiqueGeneratedPage(baseParams, {
    provider,
    render: fakeRender,
  });

  assert.equal(verdict.fallback, false);
  assert.equal(verdict.visualQuality, 8);
  assert.equal(verdict.briefAdherence, 9);
  assert.equal(verdict.shouldRegenerate, false);
  assert.equal(verdict.issues.length, 0);

  // The request must carry native structured-output controls + the screenshot.
  assert.equal(captured?.responseMimeType, "application/json");
  assert.ok(captured?.responseSchema, "responseSchema must be attached");
  assert.equal(captured?.images?.length, 1, "screenshot attached as one image");
  assert.equal(captured?.model, "gemini-3.5-flash");
});

test("handles malformed JSON gracefully (returns no-critique fallback)", async () => {
  const provider = scriptedProvider([
    { type: "text_delta", text: "Honestly the page looks great — no JSON here." },
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);

  const verdict = await critiqueGeneratedPage(baseParams, {
    provider,
    render: fakeRender,
  });

  assert.equal(verdict.fallback, true);
  assert.equal(verdict.shouldRegenerate, false, "fallback never triggers regen");
});

test("default critic deadline is 18s (smoke: Pulsegrid timed out at 12016ms under 12s)", () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 18_000);
});

test("times out and falls back when the critic call stalls", async () => {
  const provider = hangingProvider();
  const t0 = performance.now();

  const verdict = await critiqueGeneratedPage(baseParams, {
    provider,
    render: fakeRender,
    timeoutMs: 60,
  });
  const elapsed = performance.now() - t0;

  assert.equal(verdict.fallback, true);
  assert.equal(verdict.shouldRegenerate, false);
  assert.ok(elapsed < 2000, `expected a fast timeout, got ${elapsed}ms`);
});

test("render failure falls back (no blind regen without a screenshot)", async () => {
  const provider = scriptedProvider([
    { type: "done", stopReason: { kind: "end_turn" } },
  ]);
  const verdict = await critiqueGeneratedPage(baseParams, {
    provider,
    render: async () => null,
  });
  assert.equal(verdict.fallback, true);
  assert.equal(verdict.shouldRegenerate, false);
});

test("gemini done{error} falls back", async () => {
  const provider = scriptedProvider([
    {
      type: "done",
      stopReason: { kind: "error", error: "finish_reason: SAFETY" },
    },
  ]);
  const verdict = await critiqueGeneratedPage(baseParams, {
    provider,
    render: fakeRender,
  });
  assert.equal(verdict.fallback, true);
});

test("missing API key falls back without calling the provider", async () => {
  let streamed = false;
  const provider: CritiqueProviderLike = {
    stream() {
      streamed = true;
      return (async function* (): AsyncIterableIterator<StreamEvent> {})();
    },
  };
  const verdict = await critiqueGeneratedPage(
    { ...baseParams, apiKey: "" },
    { provider, render: fakeRender },
  );
  assert.equal(verdict.fallback, true);
  assert.equal(streamed, false, "must not hit the provider with no key");
});

// ─── parseVerdict ──────────────────────────────────────────────────────────────

test("parseVerdict: low score forces regen even when model says false", () => {
  const v = parseVerdict(
    verdictJson({ visualQuality: 5, briefAdherence: 9, shouldRegenerate: false }),
  );
  assert.ok(v);
  assert.equal(v.shouldRegenerate, true, "below-threshold must regenerate");
  assert.equal(v.fallback, false);
});

test("parseVerdict: model flag true regenerates at high scores (critical issue)", () => {
  const v = parseVerdict(
    verdictJson({
      visualQuality: 9,
      briefAdherence: 9,
      issues: ["logo overlaps nav"],
      shouldRegenerate: true,
      regenerationFeedback: "fix the logo overlap",
    }),
  );
  assert.ok(v);
  assert.equal(v.shouldRegenerate, true);
});

test("parseVerdict: clamps out-of-range scores into 1..10", () => {
  const v = parseVerdict(
    verdictJson({ visualQuality: 99, briefAdherence: 0 }),
  );
  assert.ok(v);
  assert.equal(v.visualQuality, 10);
  assert.equal(v.briefAdherence, 1);
});

test("parseVerdict: strips ```json fences", () => {
  const v = parseVerdict("```json\n" + verdictJson({ visualQuality: 8 }) + "\n```");
  assert.ok(v);
  assert.equal(v.visualQuality, 8);
});

test("parseVerdict: parses a full verdict wrapped in ```json fences (Mariana smoke)", () => {
  // Real failure mode: Flash wrapped the whole verdict object in a fenced
  // block with surrounding whitespace/newlines.
  const wrapped =
    "```json\n" + verdictJson({ visualQuality: 8, briefAdherence: 8 }) + "\n```\n";
  const v = parseVerdict(wrapped);
  assert.ok(v);
  assert.equal(v.fallback, false);
  assert.equal(v.visualQuality, 8);
  assert.equal(v.briefAdherence, 8);
});

test("parseVerdict: parses a verdict wrapped in bare ``` fences", () => {
  const wrapped = "```\n" + verdictJson({ visualQuality: 9 }) + "\n```";
  const v = parseVerdict(wrapped);
  assert.ok(v);
  assert.equal(v.visualQuality, 9);
});

test("parseVerdict: salvages JSON embedded in prose", () => {
  const v = parseVerdict("Here is my verdict: " + verdictJson({ visualQuality: 7 }) + " — hope that helps!");
  assert.ok(v);
  assert.equal(v.visualQuality, 7);
});

test("parseVerdict: returns null on non-JSON / empty", () => {
  assert.equal(parseVerdict("nope, not json"), null);
  assert.equal(parseVerdict(""), null);
  assert.equal(parseVerdict("   "), null);
});

test("parseVerdict: returns null when a score is missing", () => {
  assert.equal(
    parseVerdict(JSON.stringify({ briefAdherence: 8, issues: [], shouldRegenerate: false })),
    null,
  );
});

// ─── structuralSummary ────────────────────────────────────────────────────────

test("structuralSummary: extracts text from each section", () => {
  const s = structuralSummary(
    "<section><h1>Hero copy</h1></section><section class='x'>Pricing tiers here</section>",
  );
  assert.match(s, /\[section 1\]/);
  assert.match(s, /Hero copy/);
  assert.match(s, /\[section 2\]/);
  assert.match(s, /Pricing tiers/);
});

test("structuralSummary: handles no sections", () => {
  assert.match(structuralSummary("<div>nothing</div>"), /no <section>/);
});
