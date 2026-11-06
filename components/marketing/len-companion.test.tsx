// Len who comes along (spec local 2026-11-06-portada-solo-input). Its one gesture is «take me to the box»: on the home
// it scrolls up and focuses it, as before; on a page without the box (/features) it goes to the home's box (`/#ask`,
// handled by `HomeHashRouter`). Same harness as hero-kind-picker.test.tsx.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const push = vi.fn();
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push }) }));

import { LenCompanion } from "./len-companion";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // jsdom has neither; the companion only needs them to exist.
  class IO {
    observe() {}
    disconnect() {}
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
  push.mockClear();
  vi.restoreAllMocks();
});
function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<LenCompanion />));
  return host.querySelector<HTMLButtonElement>('button[aria-label="aria"]')!;
}

describe("touching Len who comes along", () => {
  it("🔴 on a page without the box, goes to the home's box", () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const button = mount();
    act(() => button.click());
    expect(push).toHaveBeenCalledWith("/#ask");
    expect(scroll).not.toHaveBeenCalled();
  });

  it("on the home, scrolls up to the box as before", () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const box = document.createElement("textarea");
    box.id = "hero-prompt";
    document.body.appendChild(box);
    const button = mount();
    act(() => button.click());
    expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(push).not.toHaveBeenCalled();
  });
});
