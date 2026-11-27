// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { desktopIconResponse, letterIconSvg, type IconDeps } from "./icon";
import type { DesktopAppRow } from "./store";

const ROW: DesktopAppRow = {
  id: "d1",
  personId: "u1",
  projectId: "p1",
  releaseSha: "sha1",
  name: "Bookings",
  iconPath: null,
  toolInstallationId: null,
  filesFingerprint: "fp1",
  hostLabel: "lienzo-0123456789abcdef0123456789abcdef",
  installedAt: new Date(),
  updatedAt: new Date(),
  removedAt: null,
};

describe("letterIconSvg", () => {
  it("draws the capital initial of the name on a square tile", () => {
    const svg = letterIconSvg("bookings");
    expect(svg).toMatch(/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain(">B</text>");
  });

  it("the colour comes from the name: the same name always gets the same one, others differ", () => {
    const fill = (name: string) => /fill="(hsl\([^"]+\))"/.exec(letterIconSvg(name))?.[1];
    expect(fill("Bookings")).toBeDefined();
    expect(fill("Bookings")).toBe(fill("Bookings"));
    const hues = new Set(["Bookings", "Invoices", "Recipes", "Habits", "Notes", "Budget"].map(fill));
    expect(hues.size).toBeGreaterThan(3);
  });

  it("an astral first character is kept whole, a name with no letters still gets a glyph, and markup in a name is text", () => {
    expect(letterIconSvg("😀 Party")).toContain(">😀</text>");
    expect(letterIconSvg("   ")).toContain(">?</text>");
    const svg = letterIconSvg("<script>alert(1)</script>");
    expect(svg).not.toContain("<script");
    expect(svg).toContain(">&lt;</text>");
    expect(letterIconSvg("&co")).toContain(">&amp;</text>");
  });
});

const deps = (over: Partial<IconDeps> = {}): IconDeps => ({
  readRelease: vi.fn(async () => ({ "/icon.svg": { content: "<svg xmlns='http://www.w3.org/2000/svg'/>", contentType: "image/svg+xml" } })),
  getBlob: vi.fn(async () => new Uint8Array([137, 80, 78, 71])),
  ...over,
});

describe("desktopIconResponse", () => {
  it("an app without an icon of its own gets the letter, as an image that can never run as a page", async () => {
    const d = deps();
    const res = await desktopIconResponse(ROW, d);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toContain(">B</text>");
    expect(d.readRelease).not.toHaveBeenCalled();
  });

  it("a tool's icon is the file of the version that is installed", async () => {
    const d = deps();
    const res = await desktopIconResponse({ ...ROW, iconPath: "/icon.svg" }, d);
    expect(d.readRelease).toHaveBeenCalledWith("sha1");
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(await res.text()).toContain("<svg");
  });

  it("a binary icon comes as its bytes, never its pointer", async () => {
    const pointer = "￿openlen-blob:" + "a".repeat(64) + ":4:" + "b".repeat(40);
    const d = deps({ readRelease: vi.fn(async () => ({ "/icon.png": { content: pointer, contentType: "image/png" } })) });
    const res = await desktopIconResponse({ ...ROW, iconPath: "/icon.png" }, d);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(d.getBlob).toHaveBeenCalledWith(pointer);
  });

  it("an icon the version does not have falls back to the letter instead of a hole", async () => {
    expect(await (await desktopIconResponse({ ...ROW, iconPath: "/gone.svg" }, deps())).text()).toContain(">B</text>");
    expect(await (await desktopIconResponse({ ...ROW, iconPath: "/icon.svg" }, deps({ readRelease: vi.fn(async () => null) }))).text()).toContain(">B</text>");
  });
});
