// @vitest-environment node
// VARIANT B GETS WHAT CONTROL GETS BEFORE THE BAKE (review item 16). `publishProject` completes control's <head>
// (ensurePageMeta, the raster og:image) and swaps Stripe's test ids for the live ones (`toLive`) BEFORE `publishToDir`;
// Variant B went straight in, so B shipped with test-mode ids and without meta tags (or a link card).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ ensurePageMeta: vi.fn(), pageMetaFor: vi.fn(), ensureSocialOgImage: vi.fn() }));
vi.mock("@/lib/publish/ensure-page-meta", () => ({ ensurePageMeta: m.ensurePageMeta }));
vi.mock("@/lib/publish/page-meta-intent", () => ({ pageMetaFor: m.pageMetaFor }));
vi.mock("@/lib/branding/social-image", () => ({ ensureSocialOgImage: m.ensureSocialOgImage }));

import type { AbPublishSpec } from "@/lib/publish/filesystem";
import { prebakeVariantB } from "./prebake";

const toLive = (t: string) => t.replaceAll("price_test_1", "price_live_1");
const CTX = { title: "Panadería", baseUrl: "https://pan.openlen.app", toLive };

const spec = (over: Partial<AbPublishSpec> = {}): AbPublishSpec => ({
  id: "ab_1234abcd",
  targetPath: "/",
  splitBps: 5000,
  salt: "s",
  includeLocales: false,
  variantB: {
    html: "<html><head></head><body>B price_test_1</body></html>",
    pages: [{ slug: "menu", html: "<p>menu price_test_1</p>" }],
    files: [{ path: "/js/pay.js", content: "pay('price_test_1')" }, { path: "/css/a.css", content: "a{}" }],
  },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.pageMetaFor.mockImplementation((i: unknown) => ({ intent: i }));
  m.ensurePageMeta.mockImplementation((html: string) => html.replace("</head>", "<meta name=\"description\" content=\"META\"></head>"));
  m.ensureSocialOgImage.mockImplementation(async (html: string) => html.replace("</head>", "<meta property=\"og:image\" content=\"OG\"></head>"));
});

describe("prebakeVariantB", () => {
  it("🔴 the home variant gets control's meta tags and og:image, and Stripe's live ids — the same steps, in control's order", async () => {
    const out = await prebakeVariantB(spec(), CTX);
    const html = out.variantB.html;
    expect(html).toContain('<meta name="description" content="META">');
    expect(html).toContain('<meta property="og:image" content="OG">');
    expect(html).toContain("price_live_1");
    expect(html).not.toContain("price_test_1");
    // Same arguments control's pre-bake uses.
    expect(m.pageMetaFor).toHaveBeenCalledWith({ provenance: "authored", title: "Panadería" });
    expect(m.ensureSocialOgImage).toHaveBeenCalledWith(expect.stringContaining("META"), { title: "Panadería", baseUrl: "https://pan.openlen.app" });
  });

  it("🔴 its subpages and its folder files carry the live ids too (control's pages and files do)", async () => {
    const out = await prebakeVariantB(spec(), CTX);
    expect(out.variantB.pages).toEqual([{ slug: "menu", html: "<p>menu price_live_1</p>" }]);
    expect(out.variantB.files).toEqual([{ path: "/js/pay.js", content: "pay('price_live_1')" }, { path: "/css/a.css", content: "a{}" }]);
  });

  it("a subpage test: only that page is published, so only the live ids apply — control's subpages never get the home's meta pass", async () => {
    const out = await prebakeVariantB(spec({ targetPath: "/menu" }), CTX);
    expect(m.ensurePageMeta).not.toHaveBeenCalled();
    expect(m.ensureSocialOgImage).not.toHaveBeenCalled();
    expect(out.variantB.pages).toEqual([{ slug: "menu", html: "<p>menu price_live_1</p>" }]);
  });

  it("with no Stripe twins (toLive null) the strings are untouched apart from the meta", async () => {
    const out = await prebakeVariantB(spec(), { ...CTX, toLive: null });
    expect(out.variantB.html).toContain("price_test_1");
    expect(out.variantB.pages).toEqual(spec().variantB.pages);
    expect(out.variantB.files).toEqual(spec().variantB.files);
  });

  it("the og:image step failing is soft, as it is for control: the meta stays and the publish goes on", async () => {
    m.ensureSocialOgImage.mockRejectedValue(new Error("render down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = await prebakeVariantB(spec(), CTX);
    expect(out.variantB.html).toContain('<meta name="description" content="META">');
    expect(out.variantB.html).not.toContain("og:image");
    warn.mockRestore();
  });

  it("everything else of the experiment is left as it was", async () => {
    const original = spec();
    const out = await prebakeVariantB(original, CTX);
    expect(out).toMatchObject({ id: "ab_1234abcd", targetPath: "/", splitBps: 5000, salt: "s", includeLocales: false });
    expect(original.variantB.html).toContain("price_test_1"); // the input is not mutated
  });
});
