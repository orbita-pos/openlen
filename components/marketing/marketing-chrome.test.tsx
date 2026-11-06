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

// jsdom has no matchMedia; Len's face asks about reduced motion.
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
})) as unknown as typeof window.matchMedia;

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
});
function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<MarketingChrome>contenido</MarketingChrome>));
  return host;
}
const hrefs = (host: HTMLElement) => [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
const toggle = (host: HTMLElement) => host.querySelector('button[aria-label="nav.toggleDark"]');

// The home left this chrome on 06/11 for the start frame (`home-shell.tsx`, tested in `home-shell.test.tsx`).
describe("every marketing page", () => {
  it("keeps the toggle and the big footer", () => {
    const host = mount();
    expect(toggle(host)).not.toBeNull();
    expect(host.textContent).toContain("footer.product.title");
    expect(host.querySelector("[data-home-footer]")).toBeNull();
    expect(host.querySelector("[data-len-mark]")).toBeNull();
  });
});

describe("Features and Pricing are pages", () => {
  it("🔴 the menu and the footer link to /features and /pricing", () => {
    const links = hrefs(mount());
    expect(links).toContain("/features");
    expect(links).toContain("/pricing");
    expect(links).not.toContain("/#features");
    expect(links).not.toContain("/#pricing");
  });
});
