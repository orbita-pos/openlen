// The marketing chrome (spec local 2026-11-06-portada-solo-input): on the home there is no theme toggle (the home is
// always dark, so it would do nothing) and the footer is one row; Features and Pricing are pages now, not anchors of
// the home. Same manual react-dom + act() harness as hero-kind-picker.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/locale-switcher", () => ({ LocaleSwitcher: () => <span data-locale-switcher /> }));
vi.mock("@/lib/use-dark-mode", () => ({ useDarkMode: () => [false, () => {}] }));

import { MarketingChrome } from "./marketing-chrome";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
});
function mount(variant?: "home" | "default") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<MarketingChrome {...(variant ? { variant } : {})}>contenido</MarketingChrome>));
  return host;
}
const hrefs = (host: HTMLElement) => [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
const toggle = (host: HTMLElement) => host.querySelector('button[aria-label="nav.toggleDark"]');

describe("the home's chrome", () => {
  it("🔴 has no theme toggle and a one-row footer with the legal links", () => {
    const host = mount("home");
    expect(toggle(host)).toBeNull();
    // Only the footer row's own links: /docs and GitHub are in the menu too, and must not satisfy this by accident.
    const footer = host.querySelector<HTMLElement>("[data-home-footer]");
    expect(footer).not.toBeNull();
    const links = hrefs(footer!);
    expect(links).toContain("/privacy");
    expect(links).toContain("/terms");
    expect(links).toContain("/docs");
    expect(links).toContain("https://github.com/orbita-pos/openlen");
    expect(host.textContent).not.toContain("footer.product.title");
  });
});

describe("every other marketing page", () => {
  it("keeps the toggle and the big footer", () => {
    const host = mount();
    expect(toggle(host)).not.toBeNull();
    expect(host.textContent).toContain("footer.product.title");
    expect(host.querySelector("[data-home-footer]")).toBeNull();
  });
});

describe("Features and Pricing are pages", () => {
  it.each(["home", "default"] as const)("🔴 the menu and the footer link to /features and /pricing (%s)", (variant) => {
    const links = hrefs(mount(variant));
    expect(links).toContain("/features");
    expect(links).toContain("/pricing");
    expect(links).not.toContain("/#features");
    expect(links).not.toContain("/#pricing");
  });
});
