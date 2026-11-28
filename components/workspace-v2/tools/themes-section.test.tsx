// «TEMAS» ON THE HERRAMIENTAS PAGE (spec local 2026-11-27-temas-del-workspace, §4.4): Claude Code's `/custom-theme` as a
// picker — a card per theme, grouped by the window it paints, with «Vista previa» (this tab only, nothing saved),
// «Usar en todo» / «Usar en este proyecto» (what `PUT /api/themes` saves), «Desactivar», and «Quitar» for a theme the person
// installed. With themes off (`GET /api/themes` → 404) the section is not there at all.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A translator that shows its parameters, so a test can see WHICH twin a card names.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${Object.values(vars).join(",")}` : key),
  useLocale: () => "es",
}));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
// The tab's own store is the layer's (use-workspace-theme.ts, with its own tests): here only what the picker asks of it —
// the preview and the reload, read directly, never `useWorkspaceTheme` (which would GET the themes a second time).
const theme = vi.hoisted(() => ({ previewing: null as string | null, preview: vi.fn(), reload: vi.fn(), hook: vi.fn() }));
vi.mock("@/components/workspace-v2/theme/use-workspace-theme", () => ({
  useWorkspaceTheme: theme.hook,
  useThemePreview: () => theme.previewing,
  previewWorkspaceTheme: (ref: string | null) => theme.preview(ref),
  reloadWorkspaceThemes: () => theme.reload(),
}));

import type { AvailableTheme } from "@/lib/themes/resolve";

import { ThemesSection } from "./themes-section";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = "bundled:aurora-day";
const NIGHT = "bundled:aurora-night";
const POND = "installed:i1:estanque";

const available = (): AvailableTheme[] => [
  { ref: POND, title: "Estanque", blurb: "Un estanque al alba", window: "light", source: "installed", installationId: "i1", projectId: "tp1" },
  {
    ref: DAY,
    title: "Aurora día",
    blurb: "Luz de aurora",
    window: "light",
    twinRef: NIGHT,
    stillUrl: "/api/themes/scene?ref=bundled%3Aaurora-day&still=1",
    source: "bundled",
  },
  {
    ref: NIGHT,
    title: "Aurora noche",
    blurb: "Aurora de noche",
    window: "dark",
    twinRef: DAY,
    stillUrl: "/api/themes/scene?ref=bundled%3Aaurora-night&still=1",
    source: "bundled",
  },
];

let list: AvailableTheme[];
let applied: { everywhere: string | null; project: string | null };
let status: number;
let writeStatus: number;
const fetchMock = vi.fn();
let root: Root | null = null;

beforeEach(() => {
  list = available();
  applied = { everywhere: null, project: null };
  status = 200;
  writeStatus = 200;
  theme.previewing = null;
  theme.preview.mockReset();
  theme.reload.mockReset();
  theme.hook.mockReset();
  nav.push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      return status === 200 ? new Response(JSON.stringify({ applied, resolved: null, twin: null, available: list })) : new Response(JSON.stringify({ error: "themes_off" }), { status });
    }
    if (method === "DELETE") list = list.filter((a) => a.projectId === undefined || !String(url).includes(`/${a.projectId}/`));
    return new Response(JSON.stringify(writeStatus === 200 ? { ok: true } : { error: "x" }), { status: writeStatus });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function render(projectId: string | null = "p1") {
  const div = document.createElement("div");
  document.body.appendChild(div);
  root = createRoot(div);
  await act(async () => root!.render(<ThemesSection projectId={projectId} />));
}
const card = (ref: string) => document.querySelector<HTMLElement>(`[data-theme-card="${ref}"]`);
const buttonIn = (el: Element | null, text: string) => [...(el?.querySelectorAll("button") ?? [])].find((b) => b.textContent === text);
const writes = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
const writeBody = (n: number) => JSON.parse(String((writes()[n]![1] as RequestInit).body));

describe("ThemesSection", () => {
  it("asks for this person's themes in the page's language, with the open project", async () => {
    await render("p1");
    expect(fetchMock).toHaveBeenCalledWith("/api/themes?project=p1&locale=es", expect.objectContaining({ cache: "no-store" }));
  });

  it("with no project open it asks for none", async () => {
    await render(null);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/themes?locale=es");
  });

  it("with themes off (404) the section is not there", async () => {
    status = 404;
    await render();
    expect(document.querySelector("[data-themes]")).toBeNull();
    expect(document.body.textContent).toBe("");
  });

  it("signed out (401) the section is not there either", async () => {
    status = 401;
    await render();
    expect(document.querySelector("[data-themes]")).toBeNull();
  });

  it("makes ONE read of the themes: the layer's hook is never mounted here", async () => {
    await render();
    expect(theme.hook).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method ?? "GET") === "GET")).toHaveLength(1);
  });

  it("a re-read that fails for a passing reason keeps the cards and says so in a line; the next good read clears it", async () => {
    await render();
    status = 500;
    await act(async () => buttonIn(card(DAY), "themes.useEverywhere")!.click());
    expect(card(DAY)).not.toBeNull();
    expect(document.querySelector("[data-themes-stale]")?.textContent).toBe("themes.readFailed");
    // A network error is the same passing failure.
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ ok: true })));
    fetchMock.mockImplementationOnce(async () => Promise.reject(new Error("offline")));
    await act(async () => buttonIn(card(DAY), "themes.useEverywhere")!.click());
    expect(card(DAY)).not.toBeNull();
    status = 200;
    await act(async () => buttonIn(card(DAY), "themes.useEverywhere")!.click());
    expect(document.querySelector("[data-themes-stale]")).toBeNull();
  });

  it("a re-read that answers 404 (themes turned off meanwhile) takes the section away", async () => {
    await render();
    status = 404;
    await act(async () => buttonIn(card(DAY), "themes.useEverywhere")!.click());
    expect(document.querySelector("[data-themes]")).toBeNull();
  });

  it("groups the cards by the window they paint, and names the twin", async () => {
    await render();
    const light = document.querySelector('[data-theme-group="light"]')!;
    const dark = document.querySelector('[data-theme-group="dark"]')!;
    expect(light.textContent).toContain("themes.lightWindow");
    expect(dark.textContent).toContain("themes.darkWindow");
    expect([...light.querySelectorAll("[data-theme-card]")].map((c) => c.getAttribute("data-theme-card"))).toEqual([POND, DAY]);
    expect([...dark.querySelectorAll("[data-theme-card]")].map((c) => c.getAttribute("data-theme-card"))).toEqual([NIGHT]);
    // The twin is named by its title, found among the cards; a theme with none names nothing.
    expect(card(DAY)!.textContent).toContain("themes.twinDark:Aurora noche");
    expect(card(NIGHT)!.textContent).toContain("themes.twinLight:Aurora día");
    expect(card(POND)!.textContent).not.toMatch(/themes.twin(Light|Dark)/);
  });

  it("a window with no theme draws no heading", async () => {
    list = available().filter((a) => a.window === "light");
    await render();
    expect(document.querySelector('[data-theme-group="dark"]')).toBeNull();
    expect(document.querySelector('[data-theme-group="light"]')).not.toBeNull();
  });

  it("paints the still picture in an <img> when the theme has a scene, and nothing when it has none", async () => {
    await render();
    expect(card(DAY)!.querySelector("img")!.getAttribute("src")).toBe("/api/themes/scene?ref=bundled%3Aaurora-day&still=1");
    expect(card(POND)!.querySelector("img")).toBeNull();
    // Its title and blurb are still there.
    expect(card(POND)!.textContent).toContain("Estanque");
    expect(card(POND)!.textContent).toContain("Un estanque al alba");
  });

  it("«Vista previa» shows it in this tab and saves nothing", async () => {
    await render();
    await act(async () => buttonIn(card(DAY), "themes.preview")!.click());
    expect(theme.preview).toHaveBeenCalledWith(DAY);
    expect(writes()).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")).toHaveLength(0);
  });

  it("the card being previewed offers to stop it", async () => {
    theme.previewing = DAY;
    await render();
    expect(buttonIn(card(DAY), "themes.preview")).toBeUndefined();
    await act(async () => buttonIn(card(DAY), "themes.stopPreview")!.click());
    expect(theme.preview).toHaveBeenCalledWith(null);
    // The others still offer it.
    expect(buttonIn(card(NIGHT), "themes.preview")).toBeDefined();
  });

  it("«Usar en todo» saves it everywhere — with no project in the body — and the layer reads again", async () => {
    await render();
    await act(async () => buttonIn(card(DAY), "themes.useEverywhere")!.click());
    expect(writes()).toHaveLength(1);
    expect(writes()[0]![0]).toBe("/api/themes");
    expect(writeBody(0)).toEqual({ scope: "everywhere", themeRef: DAY });
    expect(theme.reload).toHaveBeenCalled();
    // What was only previewed is now the pick.
    expect(theme.preview).toHaveBeenCalledWith(null);
  });

  it("«Usar en este proyecto» saves it for the open project", async () => {
    await render("p1");
    await act(async () => buttonIn(card(NIGHT), "themes.useInProject")!.click());
    expect(writeBody(0)).toEqual({ scope: "project", projectId: "p1", themeRef: NIGHT });
    expect(theme.reload).toHaveBeenCalled();
  });

  it("«Usar en este proyecto» is there only with a project open", async () => {
    await render(null);
    expect(buttonIn(card(DAY), "themes.useEverywhere")).toBeDefined();
    expect(document.body.textContent).not.toContain("themes.useInProject");
  });

  it("says where a card is on, and «Desactivar» clears only that pick", async () => {
    applied = { everywhere: NIGHT, project: DAY };
    await render("p1");
    expect(card(DAY)!.textContent).toContain("themes.onInProject");
    expect(card(NIGHT)!.textContent).toContain("themes.onEverywhere");
    expect(card(POND)!.textContent).not.toContain("themes.on");
    expect(buttonIn(card(POND), "themes.off")).toBeUndefined();
    await act(async () => buttonIn(card(DAY), "themes.off")!.click());
    expect(writes()).toHaveLength(1);
    expect(writeBody(0)).toEqual({ scope: "project", projectId: "p1", themeRef: null });
  });

  it("a theme that is on in both places is turned off in both", async () => {
    applied = { everywhere: DAY, project: DAY };
    await render("p1");
    await act(async () => buttonIn(card(DAY), "themes.off")!.click());
    expect(writes().map((_, n) => writeBody(n))).toEqual([
      { scope: "project", projectId: "p1", themeRef: null },
      { scope: "everywhere", themeRef: null },
    ]);
  });

  it("the project's own pick is not shown when no project is open", async () => {
    applied = { everywhere: null, project: DAY };
    await render(null);
    expect(card(DAY)!.textContent).not.toContain("themes.on");
  });

  it("«Quitar» is for a theme the person installed: it removes the installation and the card goes", async () => {
    await render();
    expect(buttonIn(card(DAY), "themes.remove")).toBeUndefined();
    await act(async () => buttonIn(card(POND), "themes.remove")!.click());
    const del = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")!;
    expect(del[0]).toBe("/api/projects/tp1/theme-install");
    expect(card(POND)).toBeNull();
    expect(card(DAY)).not.toBeNull();
    expect(theme.reload).toHaveBeenCalled();
  });

  it("removing the theme being previewed ends the preview", async () => {
    theme.previewing = POND;
    await render();
    await act(async () => buttonIn(card(POND), "themes.remove")!.click());
    expect(theme.preview).toHaveBeenCalledWith(null);
  });

  it("when saving fails it says so and the cards stay as they were", async () => {
    writeStatus = 500;
    await render();
    await act(async () => buttonIn(card(DAY), "themes.useEverywhere")!.click());
    expect(document.body.textContent).toContain("tools.page.failed");
    expect(card(DAY)).not.toBeNull();
    expect(theme.reload).not.toHaveBeenCalled();
  });

  it("«Nuevo tema» goes to the home with the Tema kind", async () => {
    await render();
    await act(async () => buttonIn(document.body, "themes.newTheme")!.click());
    expect(nav.push).toHaveBeenCalledWith("/?kind=theme");
  });

  it("leaving the page ends a preview, so it does not stay on with no way to stop it", async () => {
    await render();
    expect(theme.preview).not.toHaveBeenCalled();
    act(() => root!.unmount());
    root = null;
    expect(theme.preview).toHaveBeenCalledWith(null);
  });
});
