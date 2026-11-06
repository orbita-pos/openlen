// THE START RAIL (Jesús, 06/11, on Gemini's sidebar: «/new y / quiero que sea compartido»): the home and /new without
// a project share one frame — a rail of icons on the left with where you can go (Crear, Plantillas, Mis páginas,
// Comunidad, Herramientas), crowned by Len's face, and the account at its foot. No bar on top (Jesús, 06/11): the name
// shows only with the rail open, and what floats up there is the corner for whoever has no account and the phone's
// menu button. On a phone the rail is a drawer behind that button.
// Same manual react-dom + act() harness as the marketing tests.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { StartRail, StartTopRow, type StartItem } from "./start-rail";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
});
function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

const items = (onSelect = vi.fn()): StartItem[] => [
  { key: "crear", label: "Crear", href: "/new" },
  { key: "plantillas", label: "Plantillas", href: "/templates" },
  { key: "mispaginas", label: "Mis páginas", onSelect },
  { key: "comunidad", label: "Comunidad", href: "/explore" },
];

describe("the start rail", () => {
  it("🔴 draws each place as an icon in the rail, named, with the current one marked", () => {
    const host = mount(<StartRail homeHref="/" items={items()} active="comunidad" mark={<span data-mark />} />);
    const rail = host.querySelector("[data-start-rail]")!;
    expect(rail).not.toBeNull();
    expect(rail.querySelector("[data-mark]")).not.toBeNull();
    const links = [...rail.querySelectorAll<HTMLElement>("[data-start-item]")];
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual(["Crear", "Plantillas", "Mis páginas", "Comunidad"]);
    expect(rail.querySelector('a[href="/explore"]')?.getAttribute("aria-current")).toBe("page");
    expect(rail.querySelector('a[href="/new"]')?.getAttribute("aria-current")).toBeNull();
  });

  it("an item without a link does its action in place (the workspace changes view without reloading)", () => {
    const onSelect = vi.fn();
    const host = mount(<StartRail homeHref="/" items={items(onSelect)} active="crear" mark={null} />);
    const mine = host.querySelector<HTMLButtonElement>('[data-start-rail] button[aria-label="Mis páginas"]')!;
    act(() => mine.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("🔴 the account sits at the rail's foot", () => {
    const host = mount(<StartRail homeHref="/" items={items()} active="crear" mark={null} account={<span data-account />} />);
    expect(host.querySelector("[data-start-rail] [data-account]")).not.toBeNull();
  });

  it("🔴 on a phone it is a drawer: the menu button opens it with the names, and choosing closes it", () => {
    const onClose = vi.fn();
    const closed = mount(<StartRail homeHref="/" items={items()} active="crear" mark={null} drawerOpen={false} onCloseDrawer={onClose} />);
    expect(closed.querySelector("[data-start-drawer]")).toBeNull();

    const open = mount(<StartRail homeHref="/" items={items()} active="crear" mark={<span data-mark />} drawerOpen onCloseDrawer={onClose} />);
    const drawer = open.querySelector("[data-start-drawer]")!;
    expect(drawer).not.toBeNull();
    // The logo is not repeated: its SVG's gradient id would point at the hidden rail's copy and paint nothing. The
    // name, which is text, says OpenLen atop it instead — there is no bar above any more to say it.
    expect(drawer.querySelector("[data-mark]")).toBeNull();
    expect(drawer.querySelector("[data-start-name]")?.textContent).toBe("OpenLen");
    expect(drawer.textContent).toContain("Mis páginas");
    act(() => drawer.querySelector<HTMLAnchorElement>('a[href="/explore"]')!.click());
    expect(onClose).toHaveBeenCalled();
  });

  // Jesús, 06/11: «Slide from the left». It slid nowhere: it appeared and vanished at once.
  it("🔴 slides in from the left when opened, slides back out when closed, and only then leaves", () => {
    vi.useFakeTimers();
    try {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      roots.push(root);
      const draw = (open: boolean) =>
        act(() => root.render(<StartRail homeHref="/" items={items()} active="crear" mark={null} drawerOpen={open} onCloseDrawer={() => {}} />));

      draw(true);
      const drawer = host.querySelector<HTMLElement>("[data-start-drawer]")!;
      expect(drawer.dataset.state).toBe("open");
      expect(drawer.querySelector(".start-drawer__panel")).not.toBeNull();
      expect(drawer.querySelector(".start-drawer__scrim")).not.toBeNull();

      draw(false);
      // Still there, sliding out, and no longer in the way of a tap.
      const leaving = host.querySelector<HTMLElement>("[data-start-drawer]")!;
      expect(leaving.dataset.state).toBe("closed");
      expect(leaving.className).toContain("pointer-events-none");

      act(() => vi.advanceTimersByTime(250));
      expect(host.querySelector("[data-start-drawer]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("🔴 the slide is from the left, quick, and still with reduced motion", () => {
    const css = readFileSync(join(process.cwd(), "components/workspace-v2/start-rail.css"), "utf8");
    expect(css).toMatch(/@keyframes start-drawer-in\s*\{[^}]*translateX\(-100%\)/);
    expect(css).toMatch(/@keyframes start-drawer-out\s*\{[\s\S]*?translateX\(-100%\)/);
    expect(css).toMatch(/\[data-state="open"\] \.start-drawer__panel\s*\{[^}]*start-drawer-in/);
    expect(css).toMatch(/\[data-state="closed"\] \.start-drawer__panel\s*\{[^}]*start-drawer-out/);
    const reduced = css.slice(css.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain("animation: none");
  });

  it("the drawer closes with Escape", () => {
    const onClose = vi.fn();
    mount(<StartRail homeHref="/" items={items()} active="crear" mark={null} drawerOpen onCloseDrawer={onClose} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// Like Gemini's, the rail opens: a button at its top widens it with the names. Jesús, 06/11: «el texto OpenLen que se
// vea cuando se abre el sidebar» — the name sits beside Len only then; and the credits left the rail for the
// account's menu («mételo al dropdown del icono del user»).
describe("the rail opens, like Gemini's", () => {
  const named = (host: HTMLElement, label: string) =>
    host.querySelector(`[data-start-rail] [data-start-item][aria-label="${label}"]`)!.textContent;

  it("🔴 the button at its top widens it with the names, and the name OpenLen shows beside the mark only then", () => {
    localStorage.clear();
    const host = mount(<StartRail homeHref="/new" items={items()} active="crear" mark={<span data-mark />} />);
    const rail = host.querySelector("[data-start-rail]")!;
    expect(rail.getAttribute("data-open")).toBe("false");
    expect(named(host, "Mis páginas")).toBe("");
    expect(rail.querySelector("[data-start-name]")).toBeNull();

    act(() => rail.querySelector<HTMLButtonElement>('button[aria-label="nav.menu"]')!.click());
    expect(rail.getAttribute("data-open")).toBe("true");
    expect(named(host, "Mis páginas")).toBe("Mis páginas");
    const name = rail.querySelector<HTMLAnchorElement>("[data-start-name]")!;
    expect(name.textContent).toBe("OpenLen");
    expect(name.getAttribute("href")).toBe("/new");
    expect(rail.querySelector("[data-mark]")).not.toBeNull();

    act(() => rail.querySelector<HTMLButtonElement>('button[aria-label="start.closeMenu"]')!.click());
    expect(rail.getAttribute("data-open")).toBe("false");
    expect(rail.querySelector("[data-start-name]")).toBeNull();
  });

  it("remembers whether it was open, and comes back open without sliding open on every visit", () => {
    localStorage.setItem("openlen:start-rail-open", "1");
    const host = mount(<StartRail homeHref="/" items={items()} active="crear" mark={null} />);
    const rail = host.querySelector("[data-start-rail]")!;
    expect(rail.getAttribute("data-open")).toBe("true");
    expect(rail.className).not.toContain("transition-[width]");
    // It slides only when someone presses the button.
    act(() => rail.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
    expect(rail.className).toContain("transition-[width]");
    localStorage.clear();
  });
});

// Jesús, 06/11: «el navbar en /new sí hay navbar y en / no, quitemos ese navbar».
describe("what is left on top", () => {
  it("🔴 no name and no bar: the corner on the right and a menu button for the phone", () => {
    const onOpenMenu = vi.fn();
    const host = mount(<StartTopRow onOpenMenu={onOpenMenu} right={<span data-corner />} />);
    const top = host.querySelector<HTMLElement>("[data-start-top]")!;
    expect(top.textContent).not.toContain("OpenLen");
    expect(top.querySelector("[data-corner]")).not.toBeNull();
    act(() => top.querySelector<HTMLButtonElement>('button[aria-label="nav.menu"]')!.click());
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
    // On a computer it takes no row: it floats over the content's top, and lets clicks through where it is empty.
    expect(top.className).toContain("md:absolute");
    expect(top.className).toContain("pointer-events-none");
    expect(top.querySelector("button")!.className).toContain("md:hidden");
  });
});
