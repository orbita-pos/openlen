// THE ASSISTANT'S PLACE (spec local 2026-11-06-asistente-propio, §4.6): the chat panel with its name and figure instead
// of Len's, none of Len's project chrome, and every message sent as it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, v?: Record<string, unknown>) => (v ? `${clave} ${JSON.stringify(v)}` : clave),
  useLocale: () => "es",
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", name: "Ana" } }, status: "authenticated" }) }));
vi.mock("../toast", () => ({ useToast: () => ({ show: () => {}, success: () => {}, error: () => {} }) }));

import { NewChatPanel } from "../chat/new-chat-panel";
import { LenTurn } from "../chat/chat-turn";
import { restoreTurn } from "../chat/use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LUCIA = { id: "a1", name: "Lucía", slug: "lucia", shape: "blob" as const, color: "#F4A48B", tone: "friendly" as const, projectId: "p1" };
const roots: Root[] = [];
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

describe("the assistant's place", () => {
  it("shows its name and figure, not Len's header, Len Watch or the team", async () => {
    const host = mount(<NewChatPanel flatProjectId="p1" flatProjectHtml="" onFlatHtmlUpdate={() => {}} flatProjectChat={[]} assistant={LUCIA} centered />);
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    const header = host.querySelector("[data-assistant-header]")!;
    expect(header).not.toBeNull();
    expect(header.textContent).toContain("Lucía");
    expect(host.querySelector("[data-assistant-empty]")!.textContent).toContain('"name":"Lucía"');
  });

  it("🔴 in a shared project, its composer still talks only to it: no team, no «@person» message into Len's chat", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith("/miembros")
        ? new Response(JSON.stringify({ rol: "dueno", yo: "u1", dueno: { userId: "u1", nombre: "Ana", email: "a@x" }, miembros: [{ userId: "u2", nombre: "Eli", email: "e@x", rol: "editor" }] }))
        : new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const host = mount(<NewChatPanel flatProjectId="p1" flatProjectHtml="" onFlatHtmlUpdate={() => {}} flatProjectChat={[]} assistant={LUCIA} centered />);
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/miembros"))).toBe(false);
    const box = host.querySelector("textarea")!;
    expect(box.getAttribute("placeholder")).toBe('ownAssistant.place.placeholder {"name":"Lucía"}');
  });

  it("an answer says who answered: its name and figure, not Len's", () => {
    const turn = restoreTurn({ id: "r1", userText: "hola", assistantReasoning: "¡Hola! Soy Lucía.", status: "applied", appliedAt: 1 });
    const host = mount(
      <LenTurn
        turn={turn}
        next={undefined}
        isLast
        currentPage={null}
        projectId="p1"
        when="ahora"
        vote={undefined}
        labels={{} as never}
        onRetry={() => {}}
        onPublished={() => {}}
        onConfirmSettled={() => {}}
        onAnswerQuestion={() => {}}
        onDismissQuestion={() => {}}
        onRate={async () => true}
        onClearRate={async () => true}
        speaker={{ name: "Lucía", face: <span data-face="">L</span> }}
      />,
    );
    expect(host.querySelector("[data-reply-speaker] [data-face]")).not.toBeNull();
    expect(host.textContent).toContain("Lucía");
    expect(host.textContent).not.toMatch(/\bLen\b/);
  });

  // Real turns of 07/11: her steps said «Len hizo 2 pasos».
  it("🔴 her steps say she took them, not Len", () => {
    const turn = restoreTurn({
      id: "r2", userText: "¿horario?", assistantReasoning: "Martes a domingo.", status: "applied", appliedAt: 1,
      actions: [{ tool: "Read", status: "done", summary: "/index.html" }, { tool: "bash", status: "done", summary: "grep -i horario /index.html" }],
    });
    const host = mount(
      <LenTurn
        turn={turn}
        next={undefined}
        isLast
        currentPage={null}
        projectId="p1"
        when="ahora"
        vote={undefined}
        labels={{} as never}
        onRetry={() => {}}
        onPublished={() => {}}
        onConfirmSettled={() => {}}
        onAnswerQuestion={() => {}}
        onDismissQuestion={() => {}}
        onRate={async () => true}
        onClearRate={async () => true}
        speaker={{ name: "Lucía", face: <span data-face="">L</span> }}
      />,
    );
    expect(host.textContent).toContain('ownAssistant.speaker.steps {"count":2,"name":"Lucía"}');
    expect(host.textContent).not.toContain("newChat.steps.done");
  });

  // Real turns of 07/11: the line under her box said «Len puede equivocarse. Revisa tu página antes de publicarla.».
  it("🔴 the line under her box is hers: she can make mistakes; nothing about publishing", async () => {
    const host = mount(<NewChatPanel flatProjectId="p1" flatProjectHtml="" onFlatHtmlUpdate={() => {}} flatProjectChat={[]} assistant={LUCIA} centered />);
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    expect(host.textContent).toContain('ownAssistant.speaker.disclaimer {"name":"Lucía"}');
    expect(host.textContent).not.toContain("newChat.composer.disclaimer");
  });
});
