// The home in the start frame (Jesús, 06/11, on Gemini's sidebar: «/new y / quiero que sea compartido»): the same rail
// as /new without a project —the same places, Herramientas too when tools are on, under the same face—. Without an
// account its places go to their public pages or to sign in, and the corner says Precios, Iniciar sesión and Pruébalo
// gratis; with one, they open in the workspace and the account sits at the rail's foot, the credits inside its menu.
// Same manual react-dom + act() harness as the other tests here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

let status: "authenticated" | "unauthenticated" | "loading" = "unauthenticated";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status }) }));
vi.mock("@/lib/use-dark-mode", () => ({ useDarkMode: () => [true, () => {}] }));
vi.mock("@/components/app/credit-pill", () => ({ CreditPill: () => <span data-credit-pill /> }));
vi.mock("@/components/workspace-v2/account-menu", () => ({
  AccountMenu: ({ credits }: { credits?: boolean }) => <span data-account-menu data-with-credits={String(credits === true)} />,
}));
vi.mock("@/components/locale-switcher", () => ({ LocaleSwitcher: () => <span data-locale-switcher /> }));
vi.mock("./hero-len", () => ({ HeroLenMark: () => <span data-len-mark /> }));

import { HomeShell } from "./home-shell";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
beforeEach(() => {
  status = "unauthenticated";
});
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
});
function mount({ tools = false }: { tools?: boolean } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <HomeShell tools={tools}>
        <p data-hero />
      </HomeShell>,
    ),
  );
  return host;
}
const railHref = (host: HTMLElement, label: string) =>
  host.querySelector(`[data-start-rail] [aria-label="${label}"]`)?.getAttribute("href");

describe("the home in the start frame", () => {
  it("🔴 wears the workspace's tokens, with the rail, the top row, the hero and the footer row", () => {
    const host = mount();
    const frame = host.querySelector(".workspace-v2")!;
    expect(frame).not.toBeNull();
    // Without its own background: `.workspace-v2` paints one, and it covered the home's light (z-index -1).
    expect(frame.className).toContain("!bg-transparent");
    expect(frame.querySelector("[data-start-rail]")).not.toBeNull();
    expect(frame.querySelector("[data-start-top]")).not.toBeNull();
    expect(frame.querySelector("main [data-hero]")).not.toBeNull();
    expect(frame.querySelector("[data-home-footer]")).not.toBeNull();
    // The rail is crowned by Len's live face, as the menu was.
    expect(frame.querySelector("[data-start-rail] [data-len-mark]")).not.toBeNull();
  });

  it("🔴 without an account: public places open as they are, yours ask to sign in, and the corner offers both", () => {
    const host = mount();
    expect(railHref(host, "startTabs.crear")).toBe("/#ask");
    expect(railHref(host, "startTabs.plantillas")).toBe("/templates");
    expect(railHref(host, "startTabs.comunidad")).toBe("/explore");
    expect(railHref(host, "startTabs.mispaginas")).toBe(`/login?next=${encodeURIComponent("/new?view=projects")}`);
    const corner = host.querySelector("[data-start-top]")!;
    expect(corner.querySelector('a[href="/pricing"]')?.textContent).toBe("nav.links.pricing");
    expect(corner.querySelector('a[href="/login"]')?.textContent).toBe("nav.signIn");
    expect(corner.querySelector('a[href="/register"]')?.textContent).toContain("nav.tryFree");
    expect(host.querySelector("[data-credit-pill]")).toBeNull();
    expect(host.querySelector("[data-account-menu]")).toBeNull();
  });

  it("🔴 with an account: the places open in the workspace, the account at its foot with the credits in its menu", () => {
    status = "authenticated";
    const host = mount();
    expect(railHref(host, "startTabs.plantillas")).toBe("/new?mode=template");
    expect(railHref(host, "startTabs.mispaginas")).toBe("/new?view=projects");
    expect(railHref(host, "startTabs.comunidad")).toBe("/new?view=explore");
    // Jesús, 06/11: «donde se ve los créditos mételo al dropdown del icono del user» — neither the corner nor the rail.
    expect(host.querySelector("[data-start-top] [data-credit-pill]")).toBeNull();
    expect(host.querySelector('[data-start-top] a[href="/login"]')).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('[data-start-rail] button[aria-label="nav.menu"]')!.click());
    expect(host.querySelector("[data-credit-pill]")).toBeNull();
    const account = host.querySelector<HTMLElement>("[data-start-rail] [data-account-menu]")!;
    expect(account.dataset.withCredits).toBe("true");
  });

  // Jesús, 06/11: «le doy a My pages, me lleva a /new y se cambia el sidebar, se agrega otro que es Tools».
  it("🔴 with tools on, the rail offers Herramientas as /new does — signing in first without an account", () => {
    const off = mount();
    expect(railHref(off, "startTabs.herramientas")).toBeUndefined();
    const out = mount({ tools: true });
    expect(railHref(out, "startTabs.herramientas")).toBe(`/login?next=${encodeURIComponent("/new?view=tools")}`);
    status = "authenticated";
    const signedIn = mount({ tools: true });
    expect(railHref(signedIn, "startTabs.herramientas")).toBe("/new?view=tools");
  });

  it("🔴 the footer row keeps what isn't for using OpenLen: Features, Pricing, Docs, GitHub and the legal pages", () => {
    const host = mount();
    const footer = host.querySelector<HTMLElement>("[data-home-footer]")!;
    const links = [...footer.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(
      expect.arrayContaining(["/features", "/pricing", "/docs", "https://github.com/orbita-pos/openlen", "/privacy", "/terms"]),
    );
    expect(links).not.toContain("/#features");
    expect(links).not.toContain("/#pricing");
  });

  it("while the session loads, the corner stays empty: no «sign in» flashing at someone signed in", () => {
    status = "loading";
    const host = mount();
    const corner = host.querySelector("[data-start-top]")!;
    expect(corner.querySelector('a[href="/login"]')).toBeNull();
    expect(corner.querySelector("[data-credit-pill]")).toBeNull();
  });
});
