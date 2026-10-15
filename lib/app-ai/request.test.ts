import { describe, expect, it } from "vitest";

import { appAiError, appAiErrorBody } from "./errors";
import { parseChatRequest } from "./request";

const ok = (body: unknown) => {
  const r = parseChatRequest(JSON.stringify(body));
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r.request;
};
const fail = (body: unknown) => {
  const r = parseChatRequest(typeof body === "string" ? body : JSON.stringify(body));
  if (r.ok) throw new Error("expected a failure");
  return r;
};
const BASE = { model: "openlen-fast", messages: [{ role: "user", content: "hi" }] };

describe("parseChatRequest", () => {
  it("takes the minimal request with OpenAI's defaults", () => {
    expect(ok(BASE)).toEqual({
      model: expect.objectContaining({ id: "openlen-fast" }),
      messages: [{ role: "user", content: "hi" }],
      stream: false,
      includeUsage: false,
      maxTokens: 2_048,
      temperature: 1,
      jsonObject: false,
    });
  });

  it("smart gets its own default max_tokens", () => {
    expect(ok({ ...BASE, model: "openlen-smart" }).maxTokens).toBe(8_192);
  });

  it("developer becomes system, and text parts are joined", () => {
    const r = ok({
      ...BASE,
      messages: [
        { role: "developer", content: "be brief" },
        { role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
        { role: "assistant", content: "ok", name: "bot" },
      ],
    });
    expect(r.messages).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "a\nb" },
      { role: "assistant", content: "ok" },
    ]);
  });

  it("stream, include_usage, max_completion_tokens over max_tokens, temperature", () => {
    const r = ok({ ...BASE, stream: true, stream_options: { include_usage: true }, max_tokens: 10, max_completion_tokens: 20, temperature: 0.2 });
    expect(r).toMatchObject({ stream: true, includeUsage: true, maxTokens: 20, temperature: 0.2 });
  });

  it("json_object and json_schema both ask for a JSON object; text does not", () => {
    expect(ok({ ...BASE, response_format: { type: "json_object" } }).jsonObject).toBe(true);
    expect(ok({ ...BASE, response_format: { type: "json_schema", json_schema: { name: "x", schema: {} } } }).jsonObject).toBe(true);
    expect(ok({ ...BASE, response_format: { type: "text" } }).jsonObject).toBe(false);
  });

  it("ignores user", () => {
    expect(ok({ ...BASE, user: "visitor-1" }).messages).toHaveLength(1);
  });

  it("rejects what is not JSON or not an object", () => {
    expect(fail("{nope")).toMatchObject({ code: "invalid_request" });
    expect(fail([1, 2])).toMatchObject({ code: "invalid_request" });
  });

  it("an unknown model is model_not_found; a missing one is invalid", () => {
    expect(fail({ ...BASE, model: "gpt-4o" })).toMatchObject({ code: "model_not_found", param: "model" });
    expect(fail({ messages: BASE.messages })).toMatchObject({ code: "invalid_request", param: "model" });
  });

  it("names the unsupported parameter", () => {
    for (const k of ["tools", "n", "top_p", "stop", "seed", "logprobs"]) {
      expect(fail({ ...BASE, [k]: 1 })).toMatchObject({ code: "unsupported_parameter", param: k });
    }
    expect(fail({ ...BASE, stream_options: { foo: true } })).toMatchObject({ code: "unsupported_parameter", param: "stream_options.foo" });
  });

  it("only text: an image part, a tool role or a tool_calls field is not supported yet", () => {
    expect(fail({ ...BASE, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "x" } }] }] })).toMatchObject({
      code: "unsupported_parameter",
      param: "messages[0].content",
    });
    expect(fail({ ...BASE, messages: [{ role: "tool", content: "x" }] })).toMatchObject({ code: "unsupported_parameter", param: "messages[0].role" });
    expect(fail({ ...BASE, messages: [{ role: "assistant", content: "x", tool_calls: [] }] })).toMatchObject({
      code: "unsupported_parameter",
      param: "messages[0].tool_calls",
    });
  });

  it("validates the numbers", () => {
    expect(fail({ ...BASE, max_tokens: 0 })).toMatchObject({ code: "invalid_request", param: "max_tokens" });
    expect(fail({ ...BASE, max_tokens: 1.5 })).toMatchObject({ code: "invalid_request", param: "max_tokens" });
    expect(fail({ ...BASE, max_completion_tokens: 16_385 })).toMatchObject({ code: "invalid_request", param: "max_completion_tokens" });
    expect(fail({ ...BASE, temperature: 3 })).toMatchObject({ code: "invalid_request", param: "temperature" });
    expect(fail({ ...BASE, messages: [] })).toMatchObject({ code: "invalid_request", param: "messages" });
    expect(fail({ ...BASE, stream: "yes" })).toMatchObject({ code: "invalid_request", param: "stream" });
  });
});

describe("appAiError", () => {
  it("has OpenAI's shape, its status, no CORS, and Retry-After when asked", async () => {
    const r = appAiError("rate_limit_exceeded", { retryAfterSec: 1.2 });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("2");
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
    expect(await r.json()).toEqual({
      error: { message: "Too many AI requests for this project; try again shortly", type: "rate_limit_error", code: "rate_limit_exceeded", param: null },
    });
    expect(appAiErrorBody("model_not_found", { message: "m", param: "model" })).toEqual({
      error: { message: "m", type: "invalid_request_error", code: "model_not_found", param: "model" },
    });
  });

  it("maps every code to its status", () => {
    const codes = {
      invalid_request: 400, unsupported_parameter: 400, invalid_api_key: 401, insufficient_credits: 402, app_ai_cap_reached: 402,
      project_not_found: 404, model_not_found: 404, unknown_endpoint: 404, rate_limit_exceeded: 429, upstream_error: 502,
      app_ai_disabled: 503, app_ai_busy: 503,
    } as const;
    for (const [code, status] of Object.entries(codes)) expect(appAiError(code as keyof typeof codes).status).toBe(status);
  });
});
