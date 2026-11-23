// LEN'S ARTIFACTS IN THE WORKSPACE (spec local 2026-11-22-artifacts-de-len, §4): each artifact Len made in a project
// is a lens of the canvas (`artifact:<id>`), opens automatically when `publish_artifact` finishes `done`, frames its
// published version under SANDBOX_HERRAMIENTA_AGENTE / ALLOW_HERRAMIENTA_AGENTE with LEN_ARTIFACT_BRIDGE_METHODS,
// fills Len's composer without sending on `sendPrompt`, confirms removal naming the artifact and warning its data goes,
// returns to the canvas lens on removal, draws nothing when the list 404s (member), and collapses to icons on mobile.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import { BRIDGE_CHANNEL, METHOD_NOT_FOUND } from "@/lib/tools/bridge/protocol";
import { ALLOW_HERRAMIENTA_AGENTE, SANDBOX_HERRAMIENTA_AGENTE } from "../sandbox-del-lienzo";

vi.mock("next/font/google", () => ({
  Schibsted_Grotesk: () => ({ className: "", variable: "" }),
  Chivo_Mono: () => ({ className: "", variable: "" }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, v?: Record<string, unknown>) => (v ? `${clave} ${JSON.stringify(v)}` : clave),
  useLocale: () => "es",
}));

vi.mock("../use-lienzo-remoto", () => ({
  useLienzoRemoto: () => ({ estado: { modo: "local" }, marcarListo: () => {}, recargar: () => {} }),
}));
vi.mock("../use-terminal-de-len", () => ({
  useTerminalDeLen: () => ({ encendida: false, cargando: false, turnos: [], enVivo: [] }),
}));
vi.mock("../use-terminal-del-usuario", () => ({
  useTerminalDelUsuario: () => ({ corriendo: false, historial: [], correr: () => {} }),
}));

import { PreviewArea, type Lente } from "../preview-area";
import {
  artifactIdOfLens,
  artifactLens,
  newestArtifactId,
  useArtifactTurnSync,
  useLenArtifacts,
  type ArtifactTurnLike,
} from "./use-len-artifacts";
import type { LenArtifactListItem } from "./artifact-pane";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ART_1: LenArtifactListItem = {
  id: "art-1",
  slug: "presupuesto",
  title: "Presupuesto",
  releaseSha: "sha1",
  updatedAt: "2026-11-22T10:00:00.000Z",
  frameUrl: "https://lienzo-aaa.openlen.app/?v=sha1",
  frameOrigin: "https://lienzo-aaa.openlen.app",
};
const ART_2: LenArtifactListItem = {
  id: "art-2",
  slug: "pendientes",
  title: "Pendientes",
  releaseSha: "sha2",
  updatedAt: "2026-11-22T11:00:00.000Z",
  frameUrl: "https://lienzo-bbb.openlen.app/?v=sha2",
  frameOrigin: "https://lienzo-bbb.openlen.app",
};

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  onerror: ((e: Event) => void) | null = null;
  private listeners = new Map<string, Set<(e: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }
  emit(type: string, data: unknown) {
    const ev = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(ev);
  }
  close() {
    this.closed = true;
  }
}

const roots: Root[] = [];
function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

function stubIframeWindow(iframe: HTMLIFrameElement) {
  const posted: { message: unknown; targetOrigin: string }[] = [];
  const win = {
    postMessage: (message: unknown, targetOrigin: string) => {
      posted.push({ message, targetOrigin });
    },
  } as unknown as Window;
  Object.defineProperty(iframe, "contentWindow", { value: win, configurable: true });
  return { win, posted };
}

function sendFromFrame(win: Window, origin: string, id: number, method: string, params?: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin,
      source: win,
      data: { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}), channel: BRIDGE_CHANNEL },
    }),
  );
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("lens helpers and newestArtifactId", () => {
  it("builds and parses artifact:<id> lenses", () => {
    expect(artifactLens("art-1")).toBe("artifact:art-1");
    expect(artifactIdOfLens("artifact:art-1")).toBe("art-1");
    expect(artifactIdOfLens("tool:t1")).toBeNull();
    expect(artifactIdOfLens("pagina")).toBeNull();
  });

  it("picks a newly added or republished artifact over older ones", () => {
    expect(newestArtifactId([])).toBeNull();
    expect(newestArtifactId([ART_1, ART_2])).toBe("art-2");
    // Republishing ART_1 moves its updatedAt/releaseSha ahead of ART_2 -> opens ART_1.
    const republished1 = { ...ART_1, releaseSha: "sha1-v2", updatedAt: "2026-11-22T12:00:00.000Z" };
    expect(newestArtifactId([republished1, ART_2], [ART_1, ART_2])).toBe("art-1");
  });
});

describe("useLenArtifacts + useArtifactTurnSync", () => {
  it("🔴 returns empty when the list route 404s (member) so no lens is drawn", async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push(String(url));
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      }),
    );
    let latestItems: LenArtifactListItem[] = [ART_1];
    function Probe({ projectId }: { projectId: string | null }) {
      const { items } = useLenArtifacts(projectId);
      latestItems = items;
      return null;
    }
    mount(<Probe projectId="p1" />);
    await flush();
    expect(fetched).toEqual(["/api/len-artifacts?projectId=p1"]);
    expect(latestItems).toEqual([]);
  });

  it("🔴 opens the newest artifact's lens when publish_artifact finishes done in latestTurn, and refreshes on settle without stealing focus", async () => {
    let serverList: LenArtifactListItem[] = [ART_1];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url) === "/api/len-artifacts?projectId=p1"
          ? new Response(JSON.stringify(serverList), { status: 200 })
          : new Response("{}", { status: 404 }),
      ),
    );

    const opened: string[] = [];
    let pushTurn!: (t: ArtifactTurnLike | null) => void;
    let itemsNow: LenArtifactListItem[] = [];

    function Harness() {
      const [turn, setTurn] = useState<ArtifactTurnLike | null>({
        id: "old-turn",
        status: "applied",
        actions: [{ tool: "publish_artifact", status: "done" }],
      });
      pushTurn = setTurn;
      const artifacts = useLenArtifacts("p1");
      itemsNow = artifacts.items;
      useArtifactTurnSync({
        projectId: "p1",
        latestTurn: turn,
        artifacts,
        onOpenArtifact: (lens) => opened.push(lens),
      });
      return null;
    }

    mount(<Harness />);
    await flush();
    // An already-finished historical turn on mount must NOT steal the lens.
    expect(opened).toEqual([]);
    expect(itemsNow.map((x) => x.id)).toEqual(["art-1"]);

    // New streaming turn runs publish_artifact -> reloads and opens the newest artifact's lens.
    act(() => pushTurn({ id: "turn-2", status: "streaming", actions: [{ tool: "publish_artifact", status: "running" }] }));
    serverList = [ART_1, ART_2];
    act(() => pushTurn({ id: "turn-2", status: "streaming", actions: [{ tool: "publish_artifact", status: "done" }] }));
    await flush();
    expect(itemsNow.map((x) => x.id)).toEqual(["art-1", "art-2"]);
    expect(opened).toEqual(["artifact:art-2"]);

    // Turn settles with an updated title -> reloads without stealing the active lens again.
    serverList = [ART_1, { ...ART_2, title: "Pendientes (hoy)" }];
    act(() => pushTurn({ id: "turn-2", status: "applied", actions: [{ tool: "publish_artifact", status: "done" }] }));
    await flush();
    expect(itemsNow[1]?.title).toBe("Pendientes (hoy)");
    expect(opened).toEqual(["artifact:art-2"]);
  });
});

describe("PreviewArea with Len's artifacts", () => {
  function mountWorkspace({
    initialArtifacts = [ART_1, ART_2],
    initialLens = "pagina" as Lente,
    onArtifactPrompt = vi.fn(),
  }: {
    initialArtifacts?: LenArtifactListItem[];
    initialLens?: Lente;
    onArtifactPrompt?: (text: string) => void;
  } = {}) {
    let currentLens: Lente = initialLens;
    let setLensExternal!: (l: Lente) => void;
    let setArtifactsExternal!: (a: LenArtifactListItem[]) => void;

    function Wrapper() {
      const [lente, setLente] = useState<Lente>(initialLens);
      const [items, setItems] = useState<LenArtifactListItem[]>(initialArtifacts);
      currentLens = lente;
      setLensExternal = setLente;
      setArtifactsExternal = setItems;
      return (
        <PreviewArea
          doc="<html><body><h1>Hola</h1></body></html>"
          projectId="p1"
          lente={lente}
          onLente={setLente}
          toolPerson={{ name: "Jesús", locale: "es" }}
          lenArtifacts={items}
          onArtifactPrompt={onArtifactPrompt}
          onArtifactRemoved={(id) => {
            setItems((prev) => prev.filter((x) => x.id !== id));
            setLente((cur) => (cur === artifactLens(id) ? "pagina" : cur));
          }}
        />
      );
    }

    const host = mount(<Wrapper />);
    return {
      host,
      getLens: () => currentLens,
      setLens: (l: Lente) => act(() => setLensExternal(l)),
      setArtifacts: (a: LenArtifactListItem[]) => act(() => setArtifactsExternal(a)),
      onArtifactPrompt,
    };
  }

  it("🔴 shows one lens per artifact with its title, collapses labels to icons on mobile, and draws none when empty (member)", () => {
    const { host } = mountWorkspace();
    const budgetBtn = [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Presupuesto");
    const tasksBtn = [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Pendientes");
    expect(budgetBtn).toBeDefined();
    expect(tasksBtn).toBeDefined();
    // Mobile width shows icons (same `hidden sm:inline` span + SVG icon as the other lenses).
    expect(budgetBtn!.querySelector("svg")).not.toBeNull();
    const labelSpan = budgetBtn!.querySelector("span");
    expect(labelSpan?.textContent).toBe("Presupuesto");
    expect(labelSpan?.className).toContain("hidden");
    expect(labelSpan?.className).toContain("sm:inline");

    // Empty list (member 404 or artifacts off) -> no artifact lenses drawn.
    const empty = mountWorkspace({ initialArtifacts: [] });
    expect([...empty.host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Presupuesto")).toBeUndefined();
  });

  it("🔴 frames the artifact with SANDBOX/ALLOW + LEN_ARTIFACT_BRIDGE_METHODS, and sendPrompt fills Len's composer without sending", async () => {
    const onArtifactPrompt = vi.fn();
    const { host } = mountWorkspace({ initialLens: "artifact:art-1", onArtifactPrompt });

    const iframe = host.querySelector<HTMLIFrameElement>('[data-artifact-lens="art-1"] iframe')!;
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute("src")).toBe(ART_1.frameUrl);
    expect(iframe.getAttribute("sandbox")).toBe(SANDBOX_HERRAMIENTA_AGENTE);
    expect(iframe.getAttribute("allow")).toBe(ALLOW_HERRAMIENTA_AGENTE);

    const { win, posted } = stubIframeWindow(iframe);
    // Installed-tool method outside LEN_ARTIFACT_BRIDGE_METHODS is refused.
    await act(async () => {
      sendFromFrame(win, ART_1.frameOrigin, 1, "projects");
      await Promise.resolve();
    });
    expect(posted.at(-1)?.message).toMatchObject({ id: 1, error: { code: METHOD_NOT_FOUND } });

    // sendPrompt fills Len's composer without sending.
    await act(async () => {
      sendFromFrame(win, ART_1.frameOrigin, 2, "sendPrompt", { text: "Add rent to May budget" });
      await Promise.resolve();
    });
    expect(posted.at(-1)?.message).toMatchObject({ id: 2, result: { status: "placed" } });
    expect(onArtifactPrompt).toHaveBeenCalledWith("Add rent to May budget");
  });

  it("🔴 «Quitar» names the artifact and warns its data goes, deletes it, removes the lens and returns to the canvas", async () => {
    const deletes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url) === "/api/len-artifacts/art-1" && init?.method === "DELETE") {
          deletes.push(String(url));
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const { host, getLens } = mountWorkspace({ initialLens: "artifact:art-1" });
    act(() => host.querySelector<HTMLButtonElement>("[data-agent-tool-menu]")!.click());
    act(() => host.querySelector<HTMLButtonElement>("[data-agent-tool-remove]")!.click());

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Presupuesto");
    expect(dialog.textContent).toContain("lenArtifacts.removeTitle");
    expect(dialog.textContent).toContain("lenArtifacts.removeBody");
    expect(deletes).toEqual([]);

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("[data-agent-tool-confirm-remove]")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deletes).toEqual(["/api/len-artifacts/art-1"]);
    expect(getLens()).toBe("pagina");
    expect([...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Presupuesto")).toBeUndefined();
  });

  it("🔴 returns to the canvas lens when the open artifact disappears from the list", async () => {
    const { setArtifacts, getLens } = mountWorkspace({ initialLens: "artifact:art-2" });
    expect(getLens()).toBe("artifact:art-2");
    setArtifacts([ART_1]);
    await flush();
    expect(getLens()).toBe("pagina");
  });
});
