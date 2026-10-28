// Len's photos in a reply, the way ChatGPT shows them (spec local 2026-10-27-chat-drop-and-images,
// Part B): one wide, two side by side, three or more as a bento with «+N»; a tile opens a big view
// with the credit from Commons, and nothing can be downloaded or dragged out of it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k) }));

import { PhotoGallery } from "./photo-gallery";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const SHA = "0123456789abcdef0123456789abcdef0123456";
const photo = (i: number) => ({ url: `/uploads/commons/${SHA}${i}-960.jpg`, alt: `Axolotl ${i}` });
function paint(n: number) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<PhotoGallery photos={Array.from({ length: n }, (_, i) => photo(i))} />));
  return host;
}
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

describe("PhotoGallery", () => {
  it("1 → wide, 2 → side by side, 3+ → bento with +N on the last visible tile", () => {
    expect(paint(1).querySelector("[data-photo-gallery]")?.getAttribute("data-layout")).toBe("single");
    act(() => root!.unmount());
    expect(paint(2).querySelector("[data-photo-gallery]")?.getAttribute("data-layout")).toBe("pair");
    act(() => root!.unmount());
    const seven = paint(7);
    const g = seven.querySelector("[data-photo-gallery]")!;
    expect(g.getAttribute("data-layout")).toBe("bento");
    expect(g.querySelectorAll("button img")).toHaveLength(3);
    expect(g.textContent).toContain("photos.more");
  });

  it("images are not draggable and send no referrer", () => {
    const img = paint(2).querySelector("img")!;
    expect(img.getAttribute("draggable")).toBe("false");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("a tile opens the big view; arrows move; Esc closes it and focus returns to the tile", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    const host = paint(3);
    const tile = host.querySelectorAll<HTMLButtonElement>("[data-photo-gallery] button")[1]!;
    act(() => tile.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(photo(1).url);
    act(() => void dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.querySelector('[role="dialog"] img')?.getAttribute("src")).toBe(photo(2).url);
    act(() => void document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await tick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(tile);
  });

  it("the big view shows the credit from Commons, linked to the license and the page, with no download", async () => {
    const credit = { title: "Ambystoma mexicanum 1", author: "Stan Shebs", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", pageUrl: "https://commons.wikimedia.org/wiki/File:A.jpg" };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(credit)));
    vi.stubGlobal("fetch", fetchMock);
    const host = paint(1);
    act(() => host.querySelector<HTMLButtonElement>("[data-photo-gallery] button")!.click());
    await tick();
    await tick();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toBe(`/api/commons-credit?url=${encodeURIComponent(photo(0).url)}`);
    expect(dialog.textContent).toContain("Stan Shebs");
    expect(dialog.querySelector<HTMLAnchorElement>(`a[href="${credit.licenseUrl}"]`)?.textContent).toBe("CC BY-SA 3.0");
    const page = dialog.querySelector<HTMLAnchorElement>(`a[href="${credit.pageUrl}"]`)!;
    expect(page.rel).toContain("noopener");
    expect(dialog.querySelector("a[download]")).toBeNull();
  });
});
