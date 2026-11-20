// @vitest-environment node
// VARIANT B IN A SYSTEM RE-EMIT IS THE ONE THAT WAS LAUNCHED (G1+G3 review, item 18): the copy is a working directory that
// can still move after the launch, and a republish for some other reason must not ship a B nobody launched. B comes from
// the commit the launch recorded (`variantBCommitOid`); if that can't be read, the re-emit is refused and the live release —
// which already carries the launched B — keeps its split.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  copy: null as { data: Record<string, unknown>; folder: Record<string, string> } | null,
  launched: null as Record<string, string> | null,
  readAtCommit: vi.fn(),
}));

vi.mock("./worktree", () => ({
  copySources: async () => {
    if (!h.copy) throw new Error("no worktree");
    return h.copy;
  },
  ensurePublishedSources: async () => ({ commitOid: "base-1", data: { html: "<html>PUBLISHED</html>" }, extraFiles: {} }),
  readPublishedFolder: async () => ({ "/css/site.css": "published{}" }),
  readFilesAtCommit: h.readAtCommit,
}));

const { buildLiveAbPublish, variantBAsLaunched } = await import("./live-publish");

const EXP = { id: "ab_1234abcd", projectId: "p1", copyProjectId: "copy-1", variantBCommitOid: "tip-1", controlReleaseSha: null, targetPath: "/", salt: "s", includeLocales: false, splitBps: 5000 } as never;

beforeEach(() => {
  vi.clearAllMocks();
  h.copy = {
    data: { html: "<html>B DRIFTED after the launch</html>", pages: { pricing: { html: "<p>pricing B</p>", title: "Precios" }, added: { html: "<p>added after</p>" } } },
    folder: { "/css/site.css": "b-drifted{}", "/js/new-after.js": "late()", "/.openlen/esm-lock.json": "{}" },
  };
  // what the launch committed: home B, the pricing page, a stylesheet and a script that was later deleted from the copy
  h.readAtCommit.mockResolvedValue({
    "/index.html": "<html>B as launched</html>",
    "/pricing/index.html": "<p>pricing B as launched</p>",
    "/css/site.css": "b-launched{}",
    "/js/old.js": "old()",
  });
});

describe("variantBAsLaunched (pure)", () => {
  it("🔴 the launched files win: content of what was there, what the copy added after is dropped, what it deleted is back", () => {
    const b = variantBAsLaunched(h.copy! as never, {
      "/index.html": "<html>B as launched</html>",
      "/pricing/index.html": "<p>pricing B as launched</p>",
      "/css/site.css": "b-launched{}",
      "/js/old.js": "old()",
    });
    expect(b.data.html).toBe("<html>B as launched</html>");
    // the page keeps its metadata, with the launched html; the page added after the launch is gone
    expect(b.data.pages).toEqual({ pricing: { html: "<p>pricing B as launched</p>", title: "Precios" } });
    expect(b.folder["/css/site.css"]).toBe("b-launched{}");
    expect(b.folder["/js/old.js"]).toBe("old()");
    expect(b.folder).not.toHaveProperty("/js/new-after.js");
    // what git never sees (publishing reads it) stays the copy's
    expect(b.folder["/.openlen/esm-lock.json"]).toBe("{}");
  });
});

describe("buildLiveAbPublish", () => {
  it("🔴 Variant B is the launched commit's, not the copy's current head", async () => {
    const live = await buildLiveAbPublish(EXP, "u1");
    expect(h.readAtCommit).toHaveBeenCalledWith("p1", "tip-1");
    expect(live!.abExperiment.variantB.html).toBe("<html>B as launched</html>");
    expect(live!.abExperiment.variantB.files!.map((f) => f.path).sort()).toEqual(["/.openlen/esm-lock.json", "/css/site.css", "/js/old.js"]);
    // control is the published sources, as before
    expect(live!.sourcesOverride.data.html).toBe("<html>PUBLISHED</html>");
  });

  it("🔴 a launched commit that can't be read refuses the re-emit (the live release keeps the launched B)", async () => {
    h.readAtCommit.mockRejectedValue(new Error("object missing"));
    expect(await buildLiveAbPublish(EXP, "u1")).toBeNull();
  });

  it("an experiment with no recorded launch commit can't be proven to be the launched one: refused", async () => {
    expect(await buildLiveAbPublish({ ...(EXP as object), variantBCommitOid: null } as never, "u1")).toBeNull();
  });

  it("no copy left: refused, as before", async () => {
    h.copy = null;
    expect(await buildLiveAbPublish(EXP, "u1")).toBeNull();
  });
});
