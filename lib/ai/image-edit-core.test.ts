// Unit tests for lib/ai/image-edit-core.ts — the Gemini image-edit mapping +
// debit-on-success logic, extracted from the ai-edit-image route so it can be
// exercised with a scripted transport and a fake credit debit (no network, no
// DB). Run via vitest (listed in vitest.config.ts).
import { describe, expect, it } from "vitest";
import { AI_IMAGE_EDIT_CREDIT_COST } from "@/lib/credits";
import {
  editImageWithGemini,
  type GeminiImageOutcome,
  type ImageEditDeps,
} from "./image-edit-core";

const INPUT = { imageBase64: "QUJD", mimeType: "image/png", prompt: "remove the logo" };

function makeDeps(outcome: GeminiImageOutcome) {
  const debits: number[] = [];
  const calls: typeof INPUT[] = [];
  const deps: ImageEditDeps = {
    async callGemini(input) {
      calls.push(input);
      return outcome;
    },
    async debit(cost) {
      debits.push(cost);
    },
  };
  return { deps, debits, calls };
}

describe("editImageWithGemini", () => {
  it("maps a Gemini image to the success shape and debits exactly once", async () => {
    const { deps, debits, calls } = makeDeps({
      kind: "image",
      imageBase64: "ZWRpdGVk",
      mimeType: "image/webp",
    });
    const r = await editImageWithGemini(INPUT, deps);
    expect(r).toEqual({
      imageBase64: "ZWRpdGVk",
      mimeType: "image/webp",
      cost: AI_IMAGE_EDIT_CREDIT_COST,
    });
    expect(debits).toEqual([AI_IMAGE_EDIT_CREDIT_COST]);
    // The input is forwarded verbatim to the transport.
    expect(calls).toEqual([INPUT]);
  });

  it("falls back to image/png when the model returns an image with no mimeType", async () => {
    const { deps } = makeDeps({ kind: "image", imageBase64: "ZWRpdGVk", mimeType: "" });
    const r = await editImageWithGemini(INPUT, deps);
    expect("error" in r).toBe(false);
    if (!("error" in r)) expect(r.mimeType).toBe("image/png");
  });

  it("maps a blocked outcome to the route's 422 body and does NOT debit", async () => {
    const { deps, debits } = makeDeps({ kind: "blocked", reason: "SAFETY" });
    const r = await editImageWithGemini(INPUT, deps);
    expect(r).toEqual({
      error: "blocked",
      status: 422,
      body: { error: "blocked", reason: "SAFETY" },
    });
    expect(debits).toEqual([]);
  });

  it("maps a no_image outcome to the route's 422 body and does NOT debit", async () => {
    const { deps, debits } = makeDeps({ kind: "no_image", message: "declined" });
    const r = await editImageWithGemini(INPUT, deps);
    expect(r).toEqual({
      error: "no_image",
      status: 422,
      body: { error: "no_image", message: "declined" },
    });
    expect(debits).toEqual([]);
  });

  it("maps an http_error to the route's 502 ai_error body and does NOT debit", async () => {
    const { deps, debits } = makeDeps({ kind: "http_error", status: 500, detail: "boom" });
    const r = await editImageWithGemini(INPUT, deps);
    expect(r).toEqual({
      error: "ai_error",
      status: 502,
      body: { error: "ai_error", status: 500, detail: "boom" },
    });
    expect(debits).toEqual([]);
  });

  it("maps a network_error to the route's 502 ai_request_failed body and does NOT debit", async () => {
    const { deps, debits } = makeDeps({ kind: "network_error", message: "ECONNRESET" });
    const r = await editImageWithGemini(INPUT, deps);
    expect(r).toEqual({
      error: "ai_request_failed",
      status: 502,
      body: { error: "ai_request_failed", message: "ECONNRESET" },
    });
    expect(debits).toEqual([]);
  });

  it("maps unavailable (no API key) to the route's 503 body and does NOT debit", async () => {
    const { deps, debits } = makeDeps({ kind: "unavailable" });
    const r = await editImageWithGemini(INPUT, deps);
    expect(r).toEqual({
      error: "ai_unavailable",
      status: 503,
      body: { error: "ai_unavailable" },
    });
    expect(debits).toEqual([]);
  });
});
