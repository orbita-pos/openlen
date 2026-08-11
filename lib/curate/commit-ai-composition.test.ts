import { describe, expect, it, vi } from "vitest";

import { sha256 } from "@/lib/generation/content-hash";
import type { VisualEngineProjectMetadata } from "@/lib/projects/types";
import { commitAiCompositionDocument } from "./commit-ai-composition";

const HTML = "<html>FINAL-HYBRID-HTML</html>";

function metadata(
  overrides: Record<string, unknown> = {},
): Extract<VisualEngineProjectMetadata, { route: "section_composition" }> {
  return {
    schemaVersion: "visual-engine-project/1.0",
    route: "section_composition",
    templateId: null,
    compositionManifest: {
      resultCode: "composed",
      outputHash: sha256(HTML),
    },
    ...overrides,
  } as unknown as Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;
}

describe("commitAiCompositionDocument", () => {
  it("persists the final hybrid document before emitting its only preview", async () => {
    const order: string[] = [];
    const persisted: unknown[] = [];

    await commitAiCompositionDocument({ html: HTML, visualEngine: metadata() }, {
      persist: async (data) => {
        order.push("persist");
        persisted.push(data);
      },
      emitPreview: () => order.push("preview"),
    });

    expect(order).toEqual(["persist", "preview"]);
    expect(persisted).toEqual([{
      html: HTML,
      generation: { visualEngine: metadata() },
    }]);
  });

  it.each([
    ["missing metadata", { html: HTML }],
    ["skeleton metadata", { html: HTML, visualEngine: metadata({ route: "template_skeleton", templateId: "legacy" }) }],
    ["a non-null template id", { html: HTML, visualEngine: metadata({ templateId: "legacy" }) }],
    ["a stale output hash", { html: HTML, visualEngine: metadata({ compositionManifest: { resultCode: "composed", outputHash: sha256("OTHER") } }) }],
  ])("rejects %s before persistence", async (_name, document) => {
    const persist = vi.fn();
    const emitPreview = vi.fn();

    await expect(commitAiCompositionDocument(document as never, { persist, emitPreview })).rejects.toThrow();
    expect(persist).not.toHaveBeenCalled();
    expect(emitPreview).not.toHaveBeenCalled();
  });

  it("does not emit a preview when persistence throws", async () => {
    const emitPreview = vi.fn();

    await expect(commitAiCompositionDocument({ html: HTML, visualEngine: metadata() }, {
      persist: async () => { throw new Error("db-private-message"); },
      emitPreview,
    })).rejects.toThrow("db-private-message");
    expect(emitPreview).not.toHaveBeenCalled();
  });
});
