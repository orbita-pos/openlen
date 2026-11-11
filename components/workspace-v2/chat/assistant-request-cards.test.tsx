// HER REQUESTS IN LEN'S CHAT (spec local 2026-11-06-asistente-propio, §4.3.3, §4.6.1): «De Lucía: 5 clientes preguntaron
// por envíos · Que Len lo haga · Ahora no», over the composer like an event task's card. The press starts Len's turn on
// the server and the chat follows it; a turn that couldn't start leaves the card waiting, saying why; a reader sees no
// buttons; her own place shows none.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => {
  const t = Object.assign((key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key), { rich: (key: string) => key, has: () => true });
  return { useTranslations: () => t, useLocale: () => "es" };
});
const search = vi.hoisted(() => ({ card: null as string | null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => ({ get: (k: string) => (k === "card" ? search.card : null) }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", name: "Ana" } }, status: "authenticated" }) }));
vi.mock("../toast", () => ({ useToast: () => ({ show: () => {}, success: () => {}, error: () => {} }), ToastProvider: ({ children }: { children: React.ReactNode }) => children }));

import { AssistantRequestCards, type ChatRequestCard } from "./assistant-request-cards";
import { NewChatPanel } from "./new-chat-panel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Once for the whole file, never un-stubbed: Len's face (brand/len-cara/cara.js), which the chat panel loads lazily,
// reads matchMedia when its module runs — after a per-test stub is gone (final review I5).
window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
const roots: Root[] = [];
const fetchMock = vi.fn();
beforeEach(() => {
  search.card = null;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const card = (over: Partial<ChatRequestCard> = {}): ChatRequestCard => ({
  id: "c1",
  assistantId: "a1",
  assistantName: "Lucía",
  projectId: "p1",
  title: "Envíos a domicilio",
  visitors: 5,
  status: "pending",
  failure: null,
  acceptedRowId: null,
  createdAt: "2026-11-09T10:00:00.000Z",
  lastAt: "2026-11-09T11:00:00.000Z",
  decidedAt: null,
  ...over,
});

function serve(cards: ChatRequestCard[], press?: (url: string, init: RequestInit) => Response) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return press ? press(url, init) : new Response(JSON.stringify({ status: "dismissed" }), { status: 200 });
    if (String(url).endsWith("/assistant-requests")) return new Response(JSON.stringify({ cards }), { status: 200 });
    // Whatever else the chat panel asks for has nothing to say here.
    return new Response("{}", { status: 404 });
  });
}

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
  return host;
}

const click = async (el: Element | null) => {
  if (!el) throw new Error("no button");
  await act(async () => (el as HTMLButtonElement).click());
  await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
};

describe("AssistantRequestCards", () => {
  it("shows who it's from, how many asked and the two buttons", async () => {
    serve([card()]);
    const host = await mount(<AssistantRequestCards projectId="p1" busy={false} onFollowTurn={() => {}} />);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/projects/p1/assistant-requests");
    const el = host.querySelector('[data-assistant-request-card="c1"]')!;
    expect(el.textContent).toContain('ownAssistant.requests.from {"name":"Lucía"}');
    expect(el.textContent).toContain("Envíos a domicilio");
    expect(el.textContent).toContain('ownAssistant.requests.visitors {"count":5}');
    expect(el.querySelector("[data-request-do-it]")!.textContent).toBe("ownAssistant.requests.doIt");
    expect(el.querySelector("[data-request-not-now]")!.textContent).toBe("ownAssistant.requests.notNow");
  });

  it("after the press it follows Len's turn", async () => {
    const origin = { kind: "assistant", assistantId: "a1", assistantName: "Lucía" };
    serve([card()], () => new Response(JSON.stringify({ status: "accepted", rowId: "row-1", text: "💬 De Lucía: Envíos a domicilio", origin, projectId: "p1" }), { status: 202 }));
    const follow = vi.fn();
    const host = await mount(<AssistantRequestCards projectId="p1" busy={false} onFollowTurn={follow} />);
    await click(host.querySelector("[data-request-do-it]"));
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(post[0]).toBe("/api/assistants/a1/requests/c1");
    expect(JSON.parse(String((post[1] as RequestInit).body))).toMatchObject({ action: "accept" });
    expect(follow).toHaveBeenCalledWith({ filaId: "row-1", texto: "💬 De Lucía: Envíos a domicilio", origen: origin });
  });

  it("🔴 a card that couldn't start says so and can be pressed again", async () => {
    serve([card({ failure: "the turn did not run" }), card({ id: "c2", failure: "no_credits" })]);
    const host = await mount(<AssistantRequestCards projectId="p1" busy={false} onFollowTurn={() => {}} />);
    const first = host.querySelector('[data-assistant-request-card="c1"]')!;
    expect(first.querySelector("[role=alert]")!.textContent).toBe("ownAssistant.requests.failed");
    expect(first.querySelector("[data-request-do-it]")).not.toBeNull();
    expect(host.querySelector('[data-assistant-request-card="c2"] [role=alert]')!.textContent).toBe("ownAssistant.requests.noCredits");
  });

  it("a press the server refuses says so", async () => {
    serve([card()], () => new Response(JSON.stringify({ error: "not_pending" }), { status: 409 }));
    const host = await mount(<AssistantRequestCards projectId="p1" busy={false} onFollowTurn={() => {}} />);
    await click(host.querySelector("[data-request-not-now]"));
    expect(host.querySelector('[data-assistant-request-card="c1"] [role=alert]')!.textContent).toBe("ownAssistant.requests.failed");
  });

  it("decided cards fold below, with what came of them", async () => {
    serve([card(), card({ id: "c2", title: "Reservas", status: "accepted", acceptedRowId: "row-9", decidedAt: "2026-11-09T11:30:00.000Z" }), card({ id: "c3", title: "Regalos", status: "dismissed", decidedAt: "2026-11-09T11:30:00.000Z" })]);
    const host = await mount(<AssistantRequestCards projectId="p1" busy={false} onFollowTurn={() => {}} />);
    const earlier = host.querySelector("[data-request-earlier]")!;
    expect(earlier.textContent).toContain("ownAssistant.requests.done");
    expect(earlier.textContent).toContain("ownAssistant.requests.dismissed");
    expect(earlier.querySelector("[data-request-do-it]")).toBeNull();
  });

  it("read-only: no buttons", async () => {
    serve([card()]);
    const host = await mount(<AssistantRequestCards projectId="p1" soloLectura busy={false} onFollowTurn={() => {}} />);
    expect(host.querySelector('[data-assistant-request-card="c1"]')).not.toBeNull();
    expect(host.querySelector("[data-request-do-it]")).toBeNull();
    expect(host.querySelector("[data-request-not-now]")).toBeNull();
  });

  it("?card= highlights it", async () => {
    search.card = "c2";
    serve([card(), card({ id: "c2" })]);
    const host = await mount(<AssistantRequestCards projectId="p1" busy={false} onFollowTurn={() => {}} />);
    expect(host.querySelector('[data-assistant-request-card="c2"]')!.getAttribute("data-highlight")).toBe("true");
    expect(host.querySelector('[data-assistant-request-card="c1"]')!.getAttribute("data-highlight")).toBe("false");
  });

  it("a turn that ends looks again", async () => {
    serve([card()]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<AssistantRequestCards projectId="p1" busy onFollowTurn={() => {}} />));
    const before = fetchMock.mock.calls.length;
    await act(async () => root.render(<AssistantRequestCards projectId="p1" busy={false} onFollowTurn={() => {}} />));
    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });

  it("in her own place the chat shows none", async () => {
    serve([card()]);
    const LUCIA = { id: "a1", name: "Lucía", slug: "lucia", look: { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" } as const, color: "#f4a48b", tone: "friendly" as const, projectId: "p1" };
    const inHerPlace = await mount(<NewChatPanel flatProjectId="p1" flatProjectHtml="" onFlatHtmlUpdate={() => {}} flatProjectChat={[]} assistant={LUCIA} centered />);
    expect(inHerPlace.querySelector("[data-assistant-request-card]")).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("assistant-requests"))).toBe(false);
    // In Len's chat, it does.
    const inLens = await mount(<NewChatPanel flatProjectId="p1" flatProjectHtml="" onFlatHtmlUpdate={() => {}} flatProjectChat={[]} centered />);
    expect(inLens.querySelector('[data-assistant-request-card="c1"]')).not.toBeNull();
  });
});
