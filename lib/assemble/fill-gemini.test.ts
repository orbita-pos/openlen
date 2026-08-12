import { afterEach, describe, expect, it, vi } from "vitest";

import { fillWithGemini } from "./fill-gemini";

describe("fillWithGemini composition semantics", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("includes role-ownership rules in the real Gemini request for hybrid compositions", async () => {
    let requestBody = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = String(init?.body ?? "");
      throw new Error("stop after request capture");
    }));

    await fillWithGemini({
      sourceHtml: '<!doctype html><html><head><title>Test</title></head><body><section data-openlen-role="stories"><h2>Features</h2></section></body></html>',
      data: { business_name: "Mundo Pincel" },
      clonedTemplate: true,
      roleAware: true,
    });

    expect(requestBody).toContain("data-openlen-role must describe that exact role");
    expect(requestBody).toContain("Do not rename minigames as features");
  });
});
