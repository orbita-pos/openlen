import { describe, it, expect } from "vitest";
import type { ProjectData } from "./types";
import { pageEdgePaths } from "./site-pages";

const D = (pages: ProjectData["pages"], settings?: ProjectData["settings"]): ProjectData =>
  ({ html: "<html></html>", pages, ...(settings ? { settings } : {}) }) as ProjectData;

// Appended to EVERY result: the member door may have existed in the previous
// release, so its paths purge unconditionally (see pageEdgePaths).
const DOOR = ["/cuenta", "/cuenta/", "/login", "/login/", "/register", "/register/"];

describe("pageEdgePaths — CF purge set for subpages", () => {
  it("returns just the door paths when there are no subpages", () => {
    expect(pageEdgePaths(D(undefined))).toEqual(DOOR);
    expect(pageEdgePaths(null)).toEqual(DOOR);
    expect(pageEdgePaths(D({}))).toEqual(DOOR);
  });

  it("emits BOTH /slug and /slug/ for each subpage (CF caches them distinctly)", () => {
    expect(pageEdgePaths(D({ pricing: { html: "<html>x</html>" } }))).toEqual([
      "/pricing",
      "/pricing/",
      ...DOOR,
    ]);
  });

  it("covers every subpage (so unpublish/rollback purge them all)", () => {
    const paths = pageEdgePaths(D({ pricing: { html: "<html>a</html>" }, about: { html: "<html>b</html>" } }));
    expect(paths).toEqual(["/about", "/about/", "/pricing", "/pricing/", ...DOOR]); // sorted by slug
  });

  it("INCLUDES members-only (gated) subpages — their stub sits at the public path", () => {
    const paths = pageEdgePaths(D({ vip: { html: "<html>g</html>", membersOnly: true } }, { members: { enabled: true } }));
    expect(paths).toEqual(["/vip", "/vip/", ...DOOR]);
  });

  it("skips empty-html pages (mirrors pagesForPublish)", () => {
    expect(pageEdgePaths(D({ blank: { html: "" }, real: { html: "<html>r</html>" } }))).toEqual([
      "/real",
      "/real/",
      ...DOOR,
    ]);
  });

  it("purges the door even with members OFF (a cached login card must not outlive it)", () => {
    expect(pageEdgePaths(D(undefined, { members: { enabled: false } }))).toEqual(DOOR);
  });

  it("never includes the home path", () => {
    const paths = pageEdgePaths(D({ pricing: { html: "<html>x</html>" } }));
    expect(paths).not.toContain("/");
    expect(paths).not.toContain("/index.html");
  });
});
