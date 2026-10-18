// @vitest-environment node
import { describe, expect, it } from "vitest";
import { draftThumbnailRevision, needsDraftThumbnail } from "./thumbnail-state";

const project = { id: "p1", title: "App", logoUrl: null, subdomain: null, publishedAt: null, thumbnailUrl: null, filesHash: "files1", envHash: null, draftEnvVersion: null, data: { html: '<div id="root"></div>', app: { catalogo: "2026-11", entrada: "/src/main.jsx" } } };

describe("draft thumbnail revision", () => {
  it("recovers existing drafts without a thumbnail and skips empty projects", () => {
    expect(needsDraftThumbnail(project)).toBe(true);
    expect(needsDraftThumbnail({ ...project, data: { html: "  " } })).toBe(false);
  });
  it("keeps a current image, but refreshes after source, files or env change", () => {
    const revision = draftThumbnailRevision(project);
    const current = { ...project, thumbnailUrl: `https://uploads.test/project-thumbnails/p1-draft-${revision}-abc.avif` };
    expect(needsDraftThumbnail(current)).toBe(false);
    for (const change of [{ filesHash: "files2" }, { envHash: "env2" }, { draftEnvVersion: "draft-env2" }, { data: { html: "<p>new</p>" } }, { logoUrl: "https://logo.test/a.png" }]) {
      expect(needsDraftThumbnail({ ...current, ...change })).toBe(true);
    }
  });
  it("does not replace a published image with the draft", () => {
    expect(needsDraftThumbnail({ ...project, subdomain: "my-app" })).toBe(false);
    expect(needsDraftThumbnail({ ...project, publishedAt: new Date() })).toBe(false);
  });
  it("conversation-only changes do not cause another capture", () => {
    const withConversation = { ...project, data: { ...project.data, chatHistory: ["hi"] } };
    expect(draftThumbnailRevision(withConversation)).toBe(draftThumbnailRevision(project));
  });
});
