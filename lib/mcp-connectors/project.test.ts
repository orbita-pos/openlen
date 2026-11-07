import { describe, expect, it } from "vitest";

import { projectCallResult, renderResource } from "./project";

const none = (s: string) => s;
const PNG = { type: "image", mimeType: "image/png", data: "AAAA" };

describe("projectCallResult", () => {
  it("joins text in order and keeps links as text", () => {
    const out = projectCallResult(
      { content: [{ type: "text", text: "one" }, { type: "resource_link", name: "Menu", uri: "menu://today" }, { type: "text", text: "two" }] },
      none,
      true,
    );
    expect(out.response).toEqual({ content: [{ type: "text", text: "one\nMenu (menu://today)\ntwo" }] });
    expect(out.images).toBeUndefined();
  });

  it("an image goes as an image when the model takes images", () => {
    const out = projectCallResult({ content: [{ type: "text", text: "chart:" }, PNG] }, none, true);
    expect(out.images).toEqual([{ mimeType: "image/png", dataBase64: "AAAA" }]);
    expect(out.response).toEqual({ content: [{ type: "text", text: "chart:\n[image 1: image/png, attached]" }] });
  });

  it("an image is described when the model doesn't take images", () => {
    const out = projectCallResult({ content: [PNG] }, none, false);
    expect(out.images).toBeUndefined();
    expect(out.response).toEqual({ content: [{ type: "text", text: "[image: image/png, not shown]" }] });
  });

  it("audio and unknown blocks become a diagnostic", () => {
    const out = projectCallResult({ content: [{ type: "audio", mimeType: "audio/wav", data: "x" }, { type: "weird" }] }, none, true);
    expect(out.response).toEqual({ content: [{ type: "text", text: "[audio content: not shown]\n[weird content: not shown]" }] });
  });

  it("isError text echoing the token is redacted", () => {
    const redact = (s: string) => s.split("tok123").join("[redacted]");
    const out = projectCallResult({ isError: true, content: [{ type: "text", text: "bad token tok123" }] }, redact, true);
    expect(out.response).toEqual({ isError: true, content: [{ type: "text", text: "bad token [redacted]" }] });
  });

  it("a success is not redacted", () => {
    const redact = (s: string) => s.split("tok123").join("[redacted]");
    const out = projectCallResult({ content: [{ type: "text", text: "your key tok123 works" }] }, redact, true);
    expect(out.response).toEqual({ content: [{ type: "text", text: "your key tok123 works" }] });
  });

  it("over 30 KB is cut with a note", () => {
    const out = projectCallResult({ content: [{ type: "text", text: "x".repeat(40_000) }] }, none, true);
    const text = (out.response.content as { text: string }[])[0]!.text;
    expect(text.length).toBeLessThan(31_000);
    expect(text).toMatch(/\[cut: \d+ more bytes\]$/);
  });

  it("structuredContent is kept", () => {
    const out = projectCallResult({ content: [{ type: "text", text: "ok" }], structuredContent: { n: 1 } }, none, true);
    expect(out.response).toEqual({ content: [{ type: "text", text: "ok" }], structuredContent: { n: 1 } });
  });
});

describe("renderResource", () => {
  it("renderResource replaces blobs", () => {
    const text = renderResource("menus", { contents: [{ uri: "f://a", blob: "QUJD" }, { uri: "f://b", text: "hi" }] });
    expect(text.startsWith("MCP server: menus\n")).toBe(true);
    expect(text).toContain("[binary resource: 4 base64 characters; available to programmatic callers]");
    expect(text).toContain('"text": "hi"');
    expect(text).not.toContain("QUJD");
  });
});
