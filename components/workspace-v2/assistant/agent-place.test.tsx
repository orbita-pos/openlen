// AN AGENT'S PLACE (spec local 2026-11-19-agentes-para-todos, §6.3–6.4): an agent with a file opens with its first
// message — the file's `initialPrompt`, sent once as the person's first turn, as Claude Code auto-submits it — and its
// menu sends the person to Len in their space to change it («Cambiar a <nombre>»).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, v?: Record<string, unknown>) => (v ? `${clave} ${JSON.stringify(v)}` : clave),
  useLocale: () => "es",
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", name: "Ana" } }, status: "authenticated" }) }));
vi.mock("../toast", () => ({ useToast: () => ({ show: () => {}, success: () => {}, error: () => {} }), ToastProvider: ({ children }: { children: React.ReactNode }) => children }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => router }));
// Len's chat panel is a mark that says what it was given, and hands the draft back when asked.
const panel = vi.hoisted(() => ({ consumed: null as null | (() => void), chatChanged: null as null | (() => void) }));
vi.mock("../chat/new-chat-panel", () => ({
  NewChatPanel: (p: { pendingDraft?: string | null; pendingDraftAutoSend?: boolean; onPendingDraftConsumed?: () => void; onChatChange?: () => void; pendingAttachments?: { opening?: boolean } | null }) => {
    panel.consumed = p.onPendingDraftConsumed ?? null;
    panel.chatChanged = p.onChatChange ?? null;
    return <i data-chat="" data-draft={p.pendingDraft ?? ""} data-auto={String(Boolean(p.pendingDraftAutoSend))} data-opening={String(Boolean(p.pendingAttachments?.opening))} />;
  },
}));

import { AssistantHome } from "./assistant-home";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOOK = { v: 1, shape: "round", color: "#19c3b1", eyes: "oval", eyewear: "none", accessory: "none" } as const;
const SMITH = { id: "a2", name: "Mr. Smith", slug: "mr-smith", look: LOOK, color: LOOK.color, tone: "friendly" as const, projectId: "space-1", agentType: "english-teacher" };
const LUCIA = { id: "a1", name: "Lucía", slug: "lucia", look: LOOK, color: LOOK.color, tone: "friendly" as const, projectId: "p1" };
const roots: Root[] = [];
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  panel.consumed = null;
});
function mount(assistant: typeof SMITH | typeof LUCIA, startsWith: string | null = null, agents = true) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <AssistantHome assistant={assistant} projectHtml="" initialChat={[]} onPage={false} needsPublish={false} nothingToKnow={false} startsWith={startsWith} agents={agents} />,
    ),
  );
  return host;
}
const chat = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-chat]")!;

describe("an agent's first message", () => {
  it("🔴 goes out as the person's first turn, once", () => {
    const host = mount(SMITH, "Hola, hazme la prueba de nivel");
    expect(chat(host).dataset.draft).toBe("Hola, hazme la prueba de nivel");
    expect(chat(host).dataset.auto).toBe("true");
    // Marked as her opening: the server lets it go once, whoever else opened her at the same moment.
    expect(chat(host).dataset.opening).toBe("true");
    act(() => panel.consumed?.());
    expect(chat(host).dataset.draft).toBe("");
    expect(chat(host).dataset.auto).toBe("false");
  });

  it("🔴 when her chat says it changed (her opening went from another tab), her place reads it again", () => {
    router.refresh.mockReset();
    mount(SMITH, "Hola, hazme la prueba de nivel");
    act(() => panel.chatChanged?.());
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("without one, the box waits as before", () => {
    const host = mount(SMITH);
    expect(chat(host).dataset.draft).toBe("");
    expect(chat(host).dataset.auto).toBe("false");
  });
});

describe("changing an agent", () => {
  it("🔴 its menu sends the person to Len in their space, with the box filled", () => {
    const host = mount(SMITH);
    const link = host.querySelector<HTMLAnchorElement>("[data-change-agent]")!;
    expect(link.textContent).toContain('ownAssistant.place.change {"name":"Mr. Smith"}');
    expect(link.getAttribute("href")).toBe(`/es/space?draft=${new URLSearchParams({ d: 'ownAssistant.place.changeDraft {"name":"Mr. Smith"}' }).toString().slice(2)}`);
  });

  it("an assistant without a file has no such entry: there is no file for Len to change", () => {
    const host = mount(LUCIA);
    expect(host.querySelector("[data-change-agent]")).toBeNull();
  });

  // Final review, finding 7: with agents off, /space answers 404.
  it("🔴 with agents off it isn't there: the space it leads to is off too", () => {
    const host = mount(SMITH, null, false);
    expect(host.querySelector("[data-change-agent]")).toBeNull();
  });
});
