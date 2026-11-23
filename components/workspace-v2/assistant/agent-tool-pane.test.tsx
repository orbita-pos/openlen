// AN AGENT'S TOOLS ON THE WEB (spec local 2026-11-22-herramienta-dentro-del-agente, §2, §4): tabs in the agent's rail,
// live-synced with SSE follow (`baseline`, `change`, reconnect on drop, stop + remove on `gone`), restricted bridge
// (`LEN_ARTIFACT_BRIDGE_METHODS`), `sendPrompt` filling the composer without sending, and person-only delete with confirmation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { BRIDGE_CHANNEL, METHOD_NOT_FOUND } from "@/lib/tools/bridge/protocol";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, v?: Record<string, unknown>) => (v ? `${clave} ${JSON.stringify(v)}` : clave),
  useLocale: () => "es",
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", name: "Ana" } }, status: "authenticated" }) }));
vi.mock("../toast", () => ({
  useToast: () => ({ show: () => {}, success: () => {}, error: () => {} }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const panel = vi.hoisted(() => ({
  consumed: null as null | (() => void),
  chatChanged: null as null | (() => void),
  latestTurnChange: null as null | ((turn: { id: string; status: string; cut: boolean; isFirst: boolean; actions: { tool: string; status: string }[] } | null) => void),
}));
vi.mock("../chat/new-chat-panel", () => ({
  NewChatPanel: (p: {
    pendingDraft?: string | null;
    pendingDraftAutoSend?: boolean;
    onPendingDraftConsumed?: () => void;
    onChatChange?: () => void;
    onLatestTurnChange?: (turn: { id: string; status: string; cut: boolean; isFirst: boolean; actions: { tool: string; status: string }[] } | null) => void;
  }) => {
    panel.consumed = p.onPendingDraftConsumed ?? null;
    panel.chatChanged = p.onChatChange ?? null;
    panel.latestTurnChange = p.onLatestTurnChange ?? null;
    return <i data-chat="" data-draft={p.pendingDraft ?? ""} data-auto={String(Boolean(p.pendingDraftAutoSend))} />;
  },
}));

import { AssistantHome } from "./assistant-home";
import { ArtifactPane, type LenArtifactListItem } from "../artifacts/artifact-pane";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOOK = { v: 1, shape: "round", color: "#19c3b1", eyes: "oval", eyewear: "none", accessory: "none" } as const;
const ANA = {
  id: "a1",
  name: "Ana",
  slug: "ana",
  look: LOOK,
  color: LOOK.color,
  tone: "friendly" as const,
  projectId: "space-1",
  agentType: "language-teacher",
};
const TOOL_1: LenArtifactListItem = {
  id: "tool-1",
  slug: "recorrido",
  title: "Recorrido",
  frameUrl: "https://lienzo-aaa.openlen.app/?v=sha1",
  frameOrigin: "https://lienzo-aaa.openlen.app",
};
const TOOL_2: LenArtifactListItem = {
  id: "tool-2",
  slug: "vocab",
  title: "Vocabulario",
  frameUrl: "https://lienzo-bbb.openlen.app/?v=sha2",
  frameOrigin: "https://lienzo-bbb.openlen.app",
};

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CLOSED = 2;
  static OPEN = 1;
  static CONNECTING = 0;

  readonly url: string;
  readyState = FakeEventSource.OPEN;
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

  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.get(type)?.delete(fn);
  }

  emit(type: string, data: unknown) {
    const ev = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(ev);
  }

  fail() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.(new Event("error"));
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
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

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  panel.consumed = null;
  panel.chatChanged = null;
});

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

describe("what the tool is told, and who asks for tools", () => {
  it("the tool's context names the signed-in person and the published version it shows", async () => {
    const host = mount(<ArtifactPane artifact={{ ...TOOL_1, releaseSha: "sha-real" }} locale="es" personName="Jesús" onPrompt={vi.fn()} onRemoved={vi.fn()} />);
    const iframe = host.querySelector<HTMLIFrameElement>("iframe")!;
    const { win, posted } = stubIframeWindow(iframe);
    sendFromFrame(win, TOOL_1.frameOrigin, 1, "context");
    await flush();
    const answer = posted.map((p) => p.message as { id?: number; result?: { person: { name: string; locale: string }; tool: { version: string } } }).find((m) => m.id === 1);
    expect(answer?.result?.person).toEqual({ name: "Jesús", locale: "es" });
    expect(answer?.result?.tool.version).toBe("sha-real");
  });

  it("a list without the version still names it, from the frame's address", async () => {
    const host = mount(<ArtifactPane artifact={TOOL_1} locale="es" onPrompt={vi.fn()} onRemoved={vi.fn()} />);
    const { win, posted } = stubIframeWindow(host.querySelector<HTMLIFrameElement>("iframe")!);
    sendFromFrame(win, TOOL_1.frameOrigin, 2, "context");
    await flush();
    const answer = posted.map((p) => p.message as { id?: number; result?: { tool: { version: string } } }).find((m) => m.id === 2);
    expect(answer?.result?.tool.version).toBe("sha1");
  });

  it("an assistant outside the person's space never asks for tools", async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push(String(url));
        return new Response("[]", { status: 200 });
      }),
    );
    mount(<AssistantHome assistant={ANA} projectHtml="" initialChat={[]} onPage={false} needsPublish={false} nothingToKnow={false} />);
    await flush();
    expect(fetched.filter((u) => u.startsWith("/api/len-artifacts"))).toEqual([]);
  });
});

describe("AssistantHome + LenArtifactPane", () => {
  it("lists one tool tab per returned tool in the rail, and shows none when the list is empty (tools off)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url) === "/api/len-artifacts?assistantId=a1"
          ? new Response(JSON.stringify([TOOL_1, TOOL_2]), { status: 200 })
          : new Response("{}", { status: 200 }),
      ),
    );
    const host = mount(
      <AssistantHome assistant={ANA} projectHtml="" initialChat={[]} onPage={false} needsPublish={false} nothingToKnow={false} inSpace />,
    );
    await flush();

    const tabs = host.querySelectorAll<HTMLButtonElement>("[data-agent-tool-tab]");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]!.getAttribute("title")).toBe("Recorrido");
    expect(tabs[1]!.getAttribute("title")).toBe("Vocabulario");

    // With tools off, the route answers 200 [] and the rail renders no tool tabs.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    );
    const emptyHost = mount(
      <AssistantHome assistant={ANA} projectHtml="" initialChat={[]} onPage={false} needsPublish={false} nothingToKnow={false} inSpace />,
    );
    await flush();
    expect(emptyHost.querySelectorAll("[data-agent-tool-tab]")).toHaveLength(0);
  });

  it("mounts the iframe with frameUrl, restricts bridge methods, streams baseline/change, reconnects on drop, and restarts on repeat subscribe", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url) === "/api/len-artifacts/tool-1/data") {
        return new Response(JSON.stringify({ doc: { collection: "lessons", docId: "1", data: { ok: true }, updatedAt: "2026-11-22T00:00:00Z", updatedBy: "agent" } }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const onPrompt = vi.fn();
    const onRemoved = vi.fn();
    const host = mount(<ArtifactPane artifact={TOOL_1} locale="es" onPrompt={onPrompt} onRemoved={onRemoved} />);

    const iframe = host.querySelector<HTMLIFrameElement>("iframe")!;
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute("src")).toBe(TOOL_1.frameUrl);
    // No popups (a window that escapes the tool's policy) and no camera, microphone or location.
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-pointer-lock");
    expect(iframe.getAttribute("allow")).toBe("clipboard-write; fullscreen");
    expect(iframe.getAttribute("data-tool-frame")).toBe("tool-1");
    expect(iframe.getAttribute("data-tool-frame")).not.toBe("draft");

    const { win, posted } = stubIframeWindow(iframe);

    // Installed-tool method outside LEN_ARTIFACT_BRIDGE_METHODS is refused with METHOD_NOT_FOUND.
    await act(async () => {
      sendFromFrame(win, TOOL_1.frameOrigin, 1, "projects");
      await Promise.resolve();
    });
    expect(posted.at(-1)?.message).toMatchObject({ id: 1, error: { code: METHOD_NOT_FOUND } });

    // data.get relays to /api/len-artifacts/tool-1/data.
    await act(async () => {
      sendFromFrame(win, TOOL_1.frameOrigin, 2, "data.get", { collection: "lessons", docId: "1" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/len-artifacts/tool-1/data", expect.objectContaining({ method: "POST" }));
    expect(posted.at(-1)?.message).toMatchObject({ id: 2, result: { doc: { collection: "lessons", docId: "1" } } });

    // data.subscribe opens the SSE follow stream and answers { ok: true } immediately.
    await act(async () => {
      sendFromFrame(win, TOOL_1.frameOrigin, 3, "data.subscribe");
      await Promise.resolve();
    });
    expect(posted.at(-1)?.message).toMatchObject({ id: 3, result: { ok: true } });
    expect(FakeEventSource.instances).toHaveLength(1);
    const es1 = FakeEventSource.instances[0]!;
    expect(es1.url).toBe("/api/len-artifacts/tool-1/follow");

    // baseline & change events are forwarded untouched as data.changed notifications.
    const baseline = { kind: "baseline", docs: [] };
    const change = {
      kind: "change",
      by: "agent",
      docs: [{ collection: "lessons", docId: "3", data: { unlocked: true }, updatedAt: "2026-11-22T12:00:00Z", updatedBy: "agent" }],
      deleted: [],
    };
    act(() => {
      es1.emit("baseline", baseline);
      es1.emit("change", change);
    });
    expect(posted.at(-2)?.message).toMatchObject({ method: "data.changed", params: baseline, channel: BRIDGE_CHANNEL });
    expect(posted.at(-1)?.message).toMatchObject({ method: "data.changed", params: change, channel: BRIDGE_CHANNEL });

    // A second data.subscribe (e.g. iframe reload) closes the previous stream and opens a fresh one synchronously.
    await act(async () => {
      sendFromFrame(win, TOOL_1.frameOrigin, 4, "data.subscribe");
      await Promise.resolve();
    });
    expect(es1.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    const es2 = FakeEventSource.instances[1]!;

    // If the stream drops/errors, reconnects after backoff to get a fresh baseline.
    act(() => {
      es2.fail();
    });
    expect(es2.closed).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(FakeEventSource.instances).toHaveLength(3);
    const es3 = FakeEventSource.instances[2]!;
    expect(onRemoved).not.toHaveBeenCalled();

    // Only `gone` stops reconnecting and notifies onRemoved.
    act(() => {
      es3.emit("gone", {});
    });
    expect(es3.closed).toBe(true);
    expect(onRemoved).toHaveBeenCalledWith("tool-1");
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(FakeEventSource.instances).toHaveLength(3);
  });

  it("sendPrompt fills the agent composer without auto-sending and switches back to Talk", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url) === "/api/len-artifacts?assistantId=a1"
          ? new Response(JSON.stringify([TOOL_1]), { status: 200 })
          : new Response("{}", { status: 200 }),
      ),
    );
    const host = mount(
      <AssistantHome assistant={ANA} projectHtml="" initialChat={[]} onPage={false} needsPublish={false} nothingToKnow={false} inSpace />,
    );
    await flush();

    // Open the tool tab.
    act(() => host.querySelector<HTMLButtonElement>('[data-agent-tool-tab="tool-1"]')!.click());
    const iframe = host.querySelector<HTMLIFrameElement>("iframe")!;
    const { win, posted } = stubIframeWindow(iframe);

    await act(async () => {
      sendFromFrame(win, TOOL_1.frameOrigin, 10, "sendPrompt", { text: "Check my lesson 3 answers" });
      await Promise.resolve();
    });
    expect(posted.at(-1)?.message).toMatchObject({ id: 10, result: { status: "placed" } });

    const chatEl = host.querySelector<HTMLElement>("[data-chat]")!;
    expect(chatEl.dataset.draft).toBe("Check my lesson 3 answers");
    expect(chatEl.dataset.auto).toBe("false");
    // Switched back to talk tab.
    expect(host.querySelector<HTMLButtonElement>('[data-agent-tool-tab="tool-1"]')!.getAttribute("aria-selected")).toBe("false");
  });

  it("remove menu asks for confirmation naming the tool and warning data is deleted, then calls DELETE and removes the tab", async () => {
    const deletes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url) === "/api/len-artifacts?assistantId=a1") return new Response(JSON.stringify([TOOL_1]), { status: 200 });
        if (String(url) === "/api/len-artifacts/tool-1" && init?.method === "DELETE") {
          deletes.push(String(url));
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const host = mount(
      <AssistantHome assistant={ANA} projectHtml="" initialChat={[]} onPage={false} needsPublish={false} nothingToKnow={false} inSpace />,
    );
    await flush();

    act(() => host.querySelector<HTMLButtonElement>('[data-agent-tool-tab="tool-1"]')!.click());
    act(() => host.querySelector<HTMLButtonElement>("[data-agent-tool-menu]")!.click());
    act(() => host.querySelector<HTMLButtonElement>("[data-agent-tool-remove]")!.click());

    // Confirmation dialog (portal in document.body) names the tool and warns data is deleted.
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Recorrido");
    expect(dialog.textContent).toContain("lenArtifacts.removeTitle");
    expect(dialog.textContent).toContain("lenArtifacts.removeBody");
    expect(deletes).toEqual([]);

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("[data-agent-tool-confirm-remove]")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deletes).toEqual(["/api/len-artifacts/tool-1"]);
    expect(host.querySelectorAll("[data-agent-tool-tab]")).toHaveLength(0);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("refreshes the tool list when publish_artifact finishes in a live turn and falls back to Talk if the active tool disappears", async () => {
    let serverTools: LenArtifactListItem[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url) === "/api/len-artifacts?assistantId=a1"
          ? new Response(JSON.stringify(serverTools), { status: 200 })
          : new Response("{}", { status: 200 }),
      ),
    );
    const host = mount(
      <AssistantHome assistant={ANA} projectHtml="" initialChat={[]} onPage={false} needsPublish={false} nothingToKnow={false} inSpace />,
    );
    await flush();
    expect(host.querySelectorAll("[data-agent-tool-tab]")).toHaveLength(0);

    // Live turn starts streaming, then publish_artifact completes -> tab appears without reload.
    serverTools = [TOOL_1];
    act(() => {
      panel.latestTurnChange?.({ id: "turn-1", status: "streaming", cut: false, isFirst: true, actions: [] });
      panel.latestTurnChange?.({ id: "turn-1", status: "streaming", cut: false, isFirst: true, actions: [{ tool: "publish_artifact", status: "done" }] });
    });
    await flush();
    expect(host.querySelectorAll("[data-agent-tool-tab]")).toHaveLength(1);

    // Select the tool tab, then simulate it disappearing from the server on turn settle -> falls back to Talk.
    act(() => host.querySelector<HTMLButtonElement>('[data-agent-tool-tab="tool-1"]')!.click());
    serverTools = [];
    act(() => {
      panel.latestTurnChange?.({ id: "turn-1", status: "applied", cut: false, isFirst: true, actions: [{ tool: "publish_artifact", status: "done" }] });
    });
    await flush();
    expect(host.querySelectorAll("[data-agent-tool-tab]")).toHaveLength(0);
    expect(host.querySelector('[data-chat]')?.closest(".hidden")).toBeNull();
  });
});
