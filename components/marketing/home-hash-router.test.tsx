// The home acts on the hash it arrives with, on mount (a fresh load, or a client navigation from another page) AND on a
// later `hashchange` while the home is open (a plain anchor, the address bar, back/forward — Next's own navigations use
// `pushState`, which fires none). Same manual react-dom + act() harness as hero-kind-picker.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace }) }));

import { HomeHashRouter } from "./home-hash-router";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<HomeHashRouter />));
}

afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
  replace.mockClear();
});

describe("the home's hash router", () => {
  it("🔴 arriving at /#pricing goes to the pricing page", () => {
    history.replaceState(null, "", "/#pricing");
    mount();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/pricing");
  });

  it("🔴 a later hashchange to #features (a plain anchor, the address bar, back/forward) goes to the features page", () => {
    mount();
    expect(replace).not.toHaveBeenCalled();
    history.replaceState(null, "", "/#features");
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(replace).toHaveBeenCalledWith("/features");
  });

  it("#ask focuses the box and clears the hash", () => {
    const box = document.createElement("textarea");
    box.id = "hero-prompt";
    document.body.appendChild(box);
    history.replaceState(null, "", "/#ask");
    mount();
    expect(document.activeElement).toBe(box);
    expect(location.hash).toBe("");
    expect(replace).not.toHaveBeenCalled();
  });

  it("no hash, nothing", () => {
    mount();
    expect(replace).not.toHaveBeenCalled();
  });
});
