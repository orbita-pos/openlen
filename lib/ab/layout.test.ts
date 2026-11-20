// @vitest-environment node
// WHERE AN EXPERIMENT LIVES, AND WHAT IT DOES NOT TAKE FROM THE OWNER (review item 3).
// The experiment is under `openlen/`, a root that was already reserved: no new name is taken away from anyone.
import { describe, expect, it } from "vitest";

import { AB_MANIFEST_PATH, AB_RELEASE_DIR, abVariantPrefix } from "@/lib/ab/layout";
import { RESERVED_ROOTS, classifyFolderPath } from "@/lib/agent/ficheros/folder";
import { validatePageSlug } from "@/lib/projects/site-pages";
import { buildRobots } from "@/lib/publish/language-cluster";

describe("the experiment's place in a release", () => {
  it("is under the platform's reserved root", () => {
    expect(AB_RELEASE_DIR).toBe("openlen");
    expect(RESERVED_ROOTS).toContain(AB_RELEASE_DIR);
    expect(AB_MANIFEST_PATH).toBe("openlen/ab.json");
    expect(abVariantPrefix("ab_1234abcd")).toBe("openlen/ab/ab_1234abcd/b");
  });

  it("🔴 so a file of the owner's called ab.json, or in _ab/, is an ordinary file (no reservation was added for A/B)", () => {
    expect(classifyFolderPath("/ab.json")).toEqual({ ok: true, kind: "web" });
    expect(classifyFolderPath("/_ab/notes.txt").ok).toBe(true);
    // …and what is under openlen/ can't be saved: nothing can shadow the manifest or B's tree.
    expect(classifyFolderPath("/openlen/ab.json").ok).toBe(false);
    expect(classifyFolderPath("/openlen/ab/ab_1234abcd/b/index.html").ok).toBe(false);
  });

  it("page slugs never needed the entries: the slug rule already refuses an underscore and a dot", () => {
    expect(validatePageSlug("_ab")).toEqual({ ok: false, reason: "invalid" });
    expect(validatePageSlug("ab.json")).toEqual({ ok: false, reason: "invalid" });
    expect(validatePageSlug("ab")).toEqual({ ok: true, slug: "ab" });
  });

  it("robots keeps crawlers out of Variant B's copy only while an experiment is published", () => {
    expect(buildRobots("https://x.openlen.app")).toBe("User-agent: *\nAllow: /\n\nSitemap: https://x.openlen.app/sitemap.xml\n");
    expect(buildRobots("https://x.openlen.app", { disallowAb: true })).toBe(
      "User-agent: *\nAllow: /\nDisallow: /openlen/ab/\n\nSitemap: https://x.openlen.app/sitemap.xml\n",
    );
  });
});
