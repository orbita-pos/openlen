// @vitest-environment node
//
// THE SHELL OF THE WINDOW (spec local 2026-11-26-apps-en-el-escritorio, §4.3): its <html> is its own, in the request's
// language, and its <head> carries the manifest link (with the cookie) and the script that keeps the browser's offer to install.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requestLocale: vi.fn(async () => "es") }));

vi.mock("@/lib/desktop-apps/page-request", () => ({ requestLocale: m.requestLocale }));
vi.mock("@/app/globals.css", () => ({}));
vi.mock("@/app/[locale]/new/tokens.css", () => ({}));

const { default: DesktopLayout, viewport } = await import("./layout");

const ID = "0b6f1c1e-8f4d-4a52-9b0e-2f7f6a1d3c55";
const html = async () => renderToStaticMarkup(await DesktopLayout({ children: <main id="child" />, params: Promise.resolve({ id: ID }) }));

beforeEach(() => m.requestLocale.mockResolvedValue("es"));

describe("the window's layout", () => {
  it("is its own document, in the request's language, around the page", async () => {
    const out = await html();
    expect(out).toContain('<html lang="es"');
    expect(out).toContain('<main id="child"></main>');
  });

  it("🔴 links the manifest WITH credentials (a manifest is fetched without the session otherwise, and this one answers only to its person)", async () => {
    const out = await html();
    expect(out).toMatch(new RegExp(`<link rel="manifest" href="/desktop/${ID}/manifest.webmanifest" crossorigin="use-credentials"`, "i"));
  });

  it("keeps the browser's offer to install before the page hydrates, and sets the theme before the first paint", async () => {
    const out = await html();
    expect(out).toContain("beforeinstallprompt");
    expect(out).toContain("inari:dark");
    expect(out.indexOf("beforeinstallprompt")).toBeLessThan(out.indexOf("<main"));
  });

  it("the tab's colour is the strip's", () => {
    expect(viewport.themeColor).toBe("#fefcfc");
  });
});
