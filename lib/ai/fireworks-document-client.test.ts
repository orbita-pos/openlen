import { describe, expect, it, vi } from "vitest";

import { createPageGenerationBudget, type PageBudget } from "../generation/page-generation-budget";
import type { FireworksDocumentRequest } from "./fireworks-contracts";
import { createFireworksDocumentClient, type FireworksDocumentClientOptions } from "./fireworks-document-client";

const DOCUMENT = "<!doctype html><html><head><title>Mundo Pincel</title></head><body><h1>Colorea</h1></body></html>";

const REQUEST: FireworksDocumentRequest = {
  messages: [
    { role: "system", content: "You design complete landing pages." },
    { role: "user", content: "una pagina infantil de coloreo" },
  ],
  maxOutputTokens: 4_096,
  requestId: "creative-document-1",
};

const USAGE = {
  prompt_tokens: 900,
  completion_tokens: 2_400,
  total_tokens: 3_300,
  prompt_tokens_details: { cached_tokens: 100 },
  completion_tokens_details: { reasoning_tokens: 300 },
};

function budget(): PageBudget {
  return createPageGenerationBudget({
    rateCardVersion: "fable-production/2026-08-12",
    mxnPerUsd: 20,
    targetMicromxn: 5_000_000,
    capMicromxn: 10_000_000,
  });
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function client(options: Omit<FireworksDocumentClientOptions, "budget"> & { budget?: PageBudget } = {}) {
  const { budget: pageBudget = budget(), ...rest } = options;
  return {
    client: createFireworksDocumentClient({ apiKey: "key", budget: pageBudget, ...rest }),
    budget: pageBudget,
  };
}

function fetchReturning(value: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => response(value, status));
}

describe("Fireworks document client", () => {
  it("returns the assistant document from a plain envelope", async () => {
    const setup = client({
      fetchImpl: fetchReturning({
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: DOCUMENT } }],
        usage: USAGE,
      }),
    });

    const result = await setup.client.write(REQUEST);

    expect(result).toMatchObject({
      ok: true,
      text: DOCUMENT,
      truncated: false,
      usageKnown: true,
      usage: { inputTokens: 900, cachedTokens: 100, outputTokens: 2_400, thinkingTokens: 300 },
    });
    expect(setup.budget.snapshot().reservedMicromxn).toBe(0);
  });

  // The previous architecture died on exact-shape matching against a
  // third-party envelope. Unknown sibling keys are normal provider drift.
  it("tolerates unknown provider keys at every level", async () => {
    const setup = client({
      fetchImpl: fetchReturning({
        id: "cmpl-x",
        object: "chat.completion",
        served_by: "fireworks",
        choices: [{
          index: 0,
          finish_reason: "stop",
          logprobs: null,
          seed: 42,
          message: { role: "assistant", content: DOCUMENT, reasoning_content: "private", refusal: null },
        }],
        usage: USAGE,
      }),
    });

    await expect(setup.client.write(REQUEST)).resolves.toMatchObject({ ok: true, text: DOCUMENT });
  });

  it("skips empty choices and reads the first usable one", async () => {
    const setup = client({
      fetchImpl: fetchReturning({
        choices: [
          { index: 0, finish_reason: "stop", message: { role: "assistant", content: "   " } },
          { index: 1, finish_reason: "stop", message: { role: "assistant", content: DOCUMENT } },
        ],
        usage: USAGE,
      }),
    });

    await expect(setup.client.write(REQUEST)).resolves.toMatchObject({ ok: true, text: DOCUMENT });
  });

  it("accepts content delivered as text parts", async () => {
    const setup = client({
      fetchImpl: fetchReturning({
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: [{ type: "text", text: "<!doctype html>" }, { type: "text", text: "<html></html>" }] },
        }],
        usage: USAGE,
      }),
    });

    await expect(setup.client.write(REQUEST)).resolves.toMatchObject({ ok: true, text: "<!doctype html><html></html>" });
  });

  it("accepts the legacy completions text field", async () => {
    const setup = client({
      fetchImpl: fetchReturning({ choices: [{ finish_reason: "stop", text: DOCUMENT }], usage: USAGE }),
    });

    await expect(setup.client.write(REQUEST)).resolves.toMatchObject({ ok: true, text: DOCUMENT });
  });

  it("reports truncation instead of discarding a capped document", async () => {
    const setup = client({
      fetchImpl: fetchReturning({
        choices: [{ finish_reason: "length", message: { role: "assistant", content: "<!doctype html><html><body>" } }],
        usage: USAGE,
      }),
    });

    await expect(setup.client.write(REQUEST)).resolves.toMatchObject({ ok: true, truncated: true });
  });

  it("accepts an unfamiliar finish reason", async () => {
    const setup = client({
      fetchImpl: fetchReturning({
        choices: [{ finish_reason: "eos", message: { role: "assistant", content: DOCUMENT } }],
        usage: USAGE,
      }),
    });

    await expect(setup.client.write(REQUEST)).resolves.toMatchObject({ ok: true, text: DOCUMENT, truncated: false });
  });

  it("delivers the document and books zero cost when usage is absent", async () => {
    const setup = client({
      fetchImpl: fetchReturning({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: DOCUMENT } }] }),
    });

    const result = await setup.client.write(REQUEST);

    expect(result).toMatchObject({ ok: true, text: DOCUMENT, usageKnown: false });
    const snapshot = setup.budget.snapshot();
    expect(snapshot.reservedMicromxn).toBe(0);
    expect(snapshot.actualMicromxn).toBe(0);
  });

  // A failed call must not put money that was never spent into the page cost.
  it("does not charge the reservation when the provider fails", async () => {
    const setup = client({ fetchImpl: fetchReturning({ error: { message: "upstream" } }, 500) });

    const result = await setup.client.write(REQUEST);

    expect(result).toMatchObject({ ok: false, code: "http", httpStatus: 500 });
    const snapshot = setup.budget.snapshot();
    expect(snapshot.actualMicromxn).toBe(0);
    expect(snapshot.reservedMicromxn).toBe(0);
    expect(snapshot.modelUsage).toEqual([
      { modelId: "accounts/fireworks/models/deepseek-v4-flash-0731", inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0, costMicromxn: 0 },
    ]);
  });

  it("reports an empty completion without retrying", async () => {
    const fetchImpl = fetchReturning({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "" } }], usage: USAGE });
    const setup = client({ fetchImpl });

    await expect(setup.client.write(REQUEST)).resolves.toMatchObject({ ok: false, code: "empty" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never retries a transport failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error("socket hang up"); });
    const setup = client({ fetchImpl });

    await expect(setup.client.write(REQUEST)).resolves.toMatchObject({ ok: false, code: "provider" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(setup.budget.snapshot().reservedMicromxn).toBe(0);
  });

  it("reports a timeout without leaking a lease", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const setup = client({ fetchImpl, timeoutMs: 5 });

    await expect(setup.client.write(REQUEST)).resolves.toMatchObject({ ok: false, code: "timeout" });
    expect(setup.budget.snapshot().reservedMicromxn).toBe(0);
  });

  it("sends a creative plain-text payload with no response_format and no tools", async () => {
    const fetchImpl = fetchReturning({
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: DOCUMENT } }],
      usage: USAGE,
    });
    await client({ fetchImpl }).client.write(REQUEST);

    const payload = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      model: "accounts/fireworks/models/deepseek-v4-flash-0731",
      messages: REQUEST.messages,
      max_tokens: 4_096,
      reasoning_effort: "none",
      temperature: 0.7,
      user: "creative-document-1",
    });
    expect(payload.response_format).toBeUndefined();
    expect(payload.tools).toBeUndefined();
    expect(payload.tool_choice).toBeUndefined();
  });

  it("fails closed without an API key and without touching the network", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const setup = client({ apiKey: "", env: {}, fetchImpl });

    await expect(setup.client.write(REQUEST)).resolves.toMatchObject({ ok: false, code: "missing_key" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops before the call when the page budget cannot cover it", async () => {
    const pageBudget = budget();
    // Leaves ~4k micromxn of the 10 MXN cap — far less than one document call.
    const held = pageBudget.reserve({
      kind: "model",
      modelId: "accounts/fireworks/models/deepseek-v4-flash-0731",
      maxInputTokens: 1,
      maxOutputTokens: 1_785_000,
    });
    expect(held.ok).toBe(true);
    const fetchImpl = vi.fn<typeof fetch>();
    const setup = client({ budget: pageBudget, fetchImpl });

    await expect(setup.client.write(REQUEST)).resolves.toMatchObject({ ok: false, code: "budget_exceeded" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps the prompt out of every failure result", async () => {
    const setup = client({ fetchImpl: fetchReturning({ error: "boom" }, 503) });

    const result = await setup.client.write(REQUEST);

    expect(JSON.stringify(result)).not.toContain("coloreo");
    expect(JSON.stringify(result)).not.toContain("boom");
  });
});
