import { generatePageCopy, PAGE_COPY_PROMPT_VERSION } from "./generate-page-copy";
import { describe, expect, it, vi } from "vitest";

const VALID_COPY = { business_name: "Mundo Pincel" };

function geminiResponse(
  text: string,
  status = 200,
  usageMetadata: unknown = {
    promptTokenCount: 21,
    candidatesTokenCount: 13,
    cachedContentTokenCount: 0,
    thoughtsTokenCount: 0,
  },
): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
    ...(usageMetadata === null ? {} : { usageMetadata }),
  }), { status, headers: { "content-type": "application/json" } });
}

function pageCopyJson(copy: unknown = VALID_COPY): string {
  return JSON.stringify({ schemaVersion: "page-copy/1.0", copy });
}

describe("generatePageCopy", () => {
  it("sends only a copy-generation request and returns redacted validated copy", async () => {
    let requestBody: unknown;
    let requestUrl = "";
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body));
      return geminiResponse(pageCopyJson());
    });
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(125);

    const result = await generatePageCopy("  Una papeleria creativa para artistas  ", {
      apiKey: "secret-key",
      modelId: "test-model",
      fetchImpl,
      now,
    });

    expect(requestUrl).toContain("/test-model:generateContent");
    expect(requestUrl).not.toContain("secret-key");
    expect(JSON.stringify(requestBody)).not.toMatch(
      /templateIds|CATALOG|family=|screenshot|Lyceum|pitch/i,
    );
    expect(result).toMatchObject({
      ok: true,
      copy: { business_name: "Mundo Pincel" },
      modelId: "test-model",
      promptVersion: "page-copy-prompt/1.0",
      usage: { inputTokens: 21, outputTokens: 13, cachedTokens: 0, thinkingTokens: 0 },
      durationMs: 25,
    });
    expect(PAGE_COPY_PROMPT_VERSION).toBe("page-copy-prompt/1.0");
    expect(JSON.stringify(result)).not.toMatch(/raw|secret-key|private response/i);
  });

  it.each([
    ["blank input", "   ", { apiKey: "x" }, "invalid_input"],
    ["missing key", "A complete brief", { apiKey: "" }, "missing_key"],
  ] as const)("returns %s locally without calling Gemini", async (_label, brief, options, kind) => {
    const fetchImpl = vi.fn();

    const result = await generatePageCopy(brief, { ...options, fetchImpl, now: () => 10 });

    expect(result).toMatchObject({ ok: false, error: { kind } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not start a request when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();

    const result = await generatePageCopy("A complete brief", {
      apiKey: "x",
      signal: controller.signal,
      fetchImpl,
      now: () => 10,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "aborted" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["HTTP failure", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "private response" } }), { status: 429 })), "http"],
    ["network failure", vi.fn().mockRejectedValue(new Error("secret-key private response")), "provider"],
  ] as const)("returns a redacted %s", async (_label, fetchImpl, kind) => {
    const result = await generatePageCopy("A complete brief", {
      apiKey: "secret-key",
      fetchImpl,
      now: () => 10,
    });

    expect(result).toMatchObject({ ok: false, error: { kind } });
    expect(JSON.stringify(result)).not.toMatch(/raw|secret-key|private response/i);
  });

  it.each([
    ["malformed model JSON", geminiResponse("not-json"), "parse"],
    ["invalid provider envelope", new Response(JSON.stringify({ candidates: [{}] }), { status: 200 }), "provider"],
    ["invalid copy schema", geminiResponse(JSON.stringify({ schemaVersion: "page-copy/1.0", copy: VALID_COPY, "private response": true })), "schema"],
  ] as const)("returns %s without leaking model text", async (_label, response, kind) => {
    const result = await generatePageCopy("A complete brief", {
      apiKey: "x",
      fetchImpl: vi.fn().mockResolvedValue(response),
      now: () => 10,
    });

    expect(result).toMatchObject({ ok: false, error: { kind } });
    expect(JSON.stringify(result)).not.toMatch(/raw|private response/i);
  });

  it.each([
    ["negative", { promptTokenCount: -1, candidatesTokenCount: 13 }],
    ["fractional", { promptTokenCount: 21.5, candidatesTokenCount: 13 }],
    ["string", { promptTokenCount: "21", candidatesTokenCount: 13 }],
    ["unsafe cache", { promptTokenCount: 21, candidatesTokenCount: 13, cachedContentTokenCount: Number.MAX_SAFE_INTEGER + 1 }],
  ] as const)("omits %s usage counters instead of synthesizing a cost", async (_label, usageMetadata) => {
    const result = await generatePageCopy("A complete brief", {
      apiKey: "x",
      fetchImpl: vi.fn().mockResolvedValue(geminiResponse(pageCopyJson(), 200, usageMetadata)),
      now: () => 10,
    });

    expect(result).toMatchObject({ ok: true, copy: VALID_COPY });
    expect(result).not.toHaveProperty("usage");
  });

  it("accepts a successful response without provider usage metadata", async () => {
    const result = await generatePageCopy("A complete brief", {
      apiKey: "x",
      fetchImpl: vi.fn().mockResolvedValue(geminiResponse(pageCopyJson(), 200, null)),
      now: () => 10,
    });

    expect(result).toMatchObject({ ok: true, copy: VALID_COPY });
    expect(result).not.toHaveProperty("usage");
  });

  it("times out while Gemini is fetching", async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));

    const result = await generatePageCopy("A complete brief", {
      apiKey: "x",
      fetchImpl,
      timeoutMs: 5,
      now: () => 10,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });

  it("keeps its timeout active while parsing Gemini JSON", async () => {
    const response = {
      ok: true,
      status: 200,
      json: () => new Promise<unknown>(() => undefined),
    } as Response;

    const result = await generatePageCopy("A complete brief", {
      apiKey: "x",
      fetchImpl: vi.fn().mockResolvedValue(response),
      timeoutMs: 5,
      now: () => 10,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });
});
