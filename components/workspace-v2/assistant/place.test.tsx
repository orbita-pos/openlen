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
const toast = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("../toast", () => ({ useToast: () => ({ show: () => {}, success: toast.success, error: () => {} }), ToastProvider: ({ children }: { children: React.ReactNode }) => children }));

import { NewChatPanel } from "../chat/new-chat-panel";
import { AssistantHome } from "./assistant-home";
import { HerProjects } from "./her-projects";
import { LenTurn } from "../chat/chat-turn";
import { restoreTurn } from "../chat/use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LUCIA = { id: "a1", name: "Lucía", slug: "lucia", look: { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" } as const, color: "#f4a48b", tone: "friendly" as const, projectId: "p1" };
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
    // Nothing said yet: no line in the middle repeating what the box below already invites to.
    expect(host.querySelector("[data-assistant-empty]")!.textContent).toBe("");
    expect(host.querySelector("textarea")!.getAttribute("placeholder")).toBe('ownAssistant.place.placeholder {"name":"Lucía"}');
  });

  // Phase 6 (spec local 2026-11-10-figuras-del-asistente, §2.4, §5.3).
  it("🔴 her place wears her color, with an ink that reads over it", async () => {
    const yellow = { ...LUCIA, look: { ...LUCIA.look, color: "#ffc21a" }, color: "#ffc21a" };
    const host = mount(<NewChatPanel flatProjectId="p1" flatProjectHtml="" onFlatHtmlUpdate={() => {}} flatProjectChat={[]} assistant={yellow} centered />);
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    const root = host.querySelector<HTMLElement>(".assistant-tint")!;
    expect(root.style.getPropertyValue("--assistant-tint")).toBe("#ffc21a");
    expect(root.style.getPropertyValue("--assistant-ink")).toBe("#1d1d1f");
    expect(root.style.getPropertyValue("--assistant-soft")).toMatch(/^#[0-9a-f]{6}$/);
    expect(root.querySelector("[data-assistant-header]")).not.toBeNull();
  });

  it("🔴 her figure heads her place, alive and alone, with her name and what she is doing under it", async () => {
    const empty = mount(<NewChatPanel flatProjectId="p1" flatProjectHtml="" onFlatHtmlUpdate={() => {}} flatProjectChat={[]} assistant={LUCIA} centered />);
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    expect(empty.querySelectorAll("[data-figure]")).toHaveLength(1);
    expect(empty.querySelector("[data-assistant-header] [data-figure]")).not.toBeNull();
    expect(empty.querySelector("[data-assistant-empty] [data-figure]")).toBeNull();
    expect(empty.querySelector("[data-assistant-header] [data-her-status]")!.textContent).toBe("ownAssistant.place.yours");
    const talked = mount(
      <NewChatPanel flatProjectId="p2" flatProjectHtml="" onFlatHtmlUpdate={() => {}} flatProjectChat={[{ id: "r1", userText: "hola", assistantReasoning: "¡Hola!", status: "applied", appliedAt: 1 }]} assistant={{ ...LUCIA, projectId: "p2" }} centered />,
    );
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    expect(talked.querySelectorAll("[data-figure]")).toHaveLength(1);
    expect(talked.querySelector("[data-assistant-header] [data-figure]")).not.toBeNull();
    // What she said is a bubble of its own, without a row repeating her face and name: they head her place.
    expect(talked.querySelector("[data-her-bubble]")!.textContent).toContain("¡Hola!");
    expect(talked.querySelector("[data-reply-speaker]")).toBeNull();
    // Her owner's bubble is the one her color paints (tokens.css).
    expect(talked.querySelector("[data-user-bubble]")!.textContent).toContain("hola");
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
    expect(host.querySelector("[data-her-bubble]")).not.toBeNull();
    expect(host.querySelector("[data-reply-speaker]")).toBeNull();
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

  // Real turns of 10/11: her effort button was still named «Esfuerzo de Len».
  it("🔴 in her place the effort button is named with her name", async () => {
    const host = mount(<NewChatPanel flatProjectId="p1" flatProjectHtml="" onFlatHtmlUpdate={() => {}} flatProjectChat={[]} assistant={LUCIA} centered />);
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    const named = [...host.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label"));
    expect(named).toContain('ownAssistant.composer.effort {"name":"Lucía"}');
    expect(named).not.toContain("composer.effort");
  });

  // Real turns of 07/11: the line under her box said «Len puede equivocarse. Revisa tu página antes de publicarla.».
  it("🔴 the line under her box is hers: she can make mistakes; nothing about publishing", async () => {
    const host = mount(<NewChatPanel flatProjectId="p1" flatProjectHtml="" onFlatHtmlUpdate={() => {}} flatProjectChat={[]} assistant={LUCIA} centered />);
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    expect(host.textContent).toContain('ownAssistant.speaker.disclaimer {"name":"Lucía"}');
    expect(host.textContent).not.toContain("newChat.composer.disclaimer");
  });
});

// HER PLACE'S CONTROLS (spec local 2026-11-06-asistente-propio, §4.4.5, §4.6.2, §6.2; phase 2A).
describe("her place's controls", () => {
  const AT = "2026-11-07T18:00:00.000Z";
  function serve(o: { patch?: unknown; requests?: unknown[]; projects?: unknown[]; visits?: unknown[] } = {}) {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), ...(init ? { init } : {}) });
        const u = String(url);
        if (u.endsWith("/api/assistants/a1/visits"))
          return new Response(JSON.stringify({ visits: o.visits ?? [{ id: "v1", startedAt: AT, lastAt: AT, messageCount: 1, handedOff: true, lines: [{ role: "visitor", text: "¿Hacen envíos?", at: AT }, { role: "assistant", text: "Sólo en Guadalajara.", at: AT }] }] }));
        // Phase 4: her projects.
        if (u.endsWith("/api/assistants/a1/projects") && !init?.method) return new Response(JSON.stringify({ projects: o.projects ?? [] }));
        if (u.includes("/api/assistants/a1/projects/") && init?.method === "DELETE") return new Response(null, { status: 204 });
        if (u.includes("/api/assistants/a1/projects/") && init?.method === "PATCH") return new Response(JSON.stringify({ onPage: true, needsPublish: true }));
        if (u.endsWith("/api/assistants/a1") && init?.method === "DELETE") return new Response(null, { status: 204 });
        if (u.endsWith("/api/assistants/visitor-budget")) return new Response(JSON.stringify({ spent: 1_200, cap: 12_500, explicit: null, max: 50_000 }));
        if (u.endsWith("/api/assistants/a1") && init?.method === "PATCH") return new Response(JSON.stringify(o.patch ?? { onPage: true, needsPublish: true }));
        if (u.endsWith("/api/assistants/a1/requests")) return new Response(JSON.stringify({ cards: o.requests ?? [] }));
        if (u.includes("/api/assistants/a1/requests/") && init?.method === "POST")
          return new Response(JSON.stringify({ status: "accepted", rowId: "row-1", text: "💬 De Lucía: Envíos", origin: { kind: "assistant", assistantId: "a1", assistantName: "Lucía" }, projectId: "p1" }), { status: 202 });
        return new Response("{}", { status: 200 });
      }),
    );
    return calls;
  }
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));

  it("her place has Hablar and Conversaciones, and Conversaciones lists what visitors said", async () => {
    serve();
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage={false} needsPublish={false} nothingToKnow={false} />);
    await settle();
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["ownAssistant.place.talk", "ownAssistant.place.conversations", "ownAssistant.requests.tab"]);
    act(() => tabs[1]!.click());
    await settle();
    const list = host.querySelector("[data-visitor-conversations]")!;
    expect(list.textContent).toContain("¿Hacen envíos?");
    expect(list.textContent).toContain("Sólo en Guadalajara.");
    expect(list.textContent).toContain("ownAssistant.place.handedOff");
    expect(list.textContent).toContain('ownAssistant.place.budget {"spent":"12","cap":"125"}');
  });

  // Phase 4: she serves one or more of her person's projects (spec §4.5).
  const HOME = { projectId: "p1", title: "Pastelería Canela", address: "canela.openlen.app", isHome: true, onPage: true, needsPublish: false, nothingToKnow: false };
  const SHOP = { projectId: "p2", title: "Canela Tienda", address: "canela-tienda.openlen.app", isHome: false, onPage: false, needsPublish: false, nothingToKnow: false, knowsIt: true };
  const openProjects = async (host: HTMLElement) => {
    act(() => host.querySelector<HTMLButtonElement>("[data-her-projects-open]")!.click());
    await settle();
    return document.querySelector<HTMLElement>("[data-her-projects]")!;
  };

  // Phase 4E: seeing them marks them read, as the page's inbox does, so `list_messages` in her chat counts what's new.
  it("🔴 seeing her conversations marks the shown ids read, once — not before they are shown", async () => {
    const calls = serve();
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage={false} needsPublish={false} nothingToKnow={false} />);
    await settle();
    const reads = () => calls.filter((c) => c.url.endsWith("/api/assistants/a1/visits/read"));
    expect(reads()).toHaveLength(0);
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    act(() => tabs[1]!.click());
    await settle();
    expect(reads()).toHaveLength(1);
    expect(reads()[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(reads()[0]!.init?.body))).toEqual({ seen: [{ id: "v1", lastAt: AT }] });
    act(() => tabs[0]!.click());
    act(() => tabs[1]!.click());
    await settle();
    expect(reads()).toHaveLength(1);
  });

  it("with one project her place looks as before", async () => {
    serve({ projects: [HOME] });
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage={true} needsPublish={false} nothingToKnow={false} />);
    await settle();
    expect(host.querySelectorAll('[data-assistant-controls] [data-on-page] [role="switch"]')).toHaveLength(1);
    expect(host.querySelector("[data-her-projects-open]")!.textContent).toBe('ownAssistant.projects.count {"count":1}');
    const panel = await openProjects(host);
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.querySelector("[data-her-project-remove]")).toBeNull();
    expect(panel.textContent).toContain("ownAssistant.projects.home");
  });

  it("with several, each has its own «En mi página»", async () => {
    const calls = serve({ projects: [HOME, SHOP] });
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage={true} needsPublish={false} nothingToKnow={false} />);
    await settle();
    expect(host.querySelector("[data-her-projects-open]")!.textContent).toBe('ownAssistant.projects.count {"count":2}');
    const panel = await openProjects(host);
    const rows = [...panel.querySelectorAll<HTMLElement>("[data-her-project]")];
    expect(rows.map((r) => r.getAttribute("data-her-project"))).toEqual(["p1", "p2"]);
    expect(rows[1]!.textContent).toContain("Canela Tienda");
    expect(rows[1]!.textContent).toContain("canela-tienda.openlen.app");
    const shopSwitch = rows[1]!.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(shopSwitch.getAttribute("aria-checked")).toBe("false");
    act(() => shopSwitch.click());
    await settle();
    const patch = calls.find((c) => c.init?.method === "PATCH")!;
    expect(patch.url).toBe("/api/assistants/a1/projects/p2");
    expect(JSON.parse(String(patch.init!.body))).toEqual({ onPage: true });
  });

  it("taking her off a project asks first and refreshes the list", async () => {
    const calls = serve({ projects: [HOME, SHOP] });
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage={true} needsPublish={false} nothingToKnow={false} />);
    await settle();
    const panel = await openProjects(host);
    const remove = panel.querySelector<HTMLButtonElement>('[data-her-project="p2"] [data-her-project-remove]')!;
    expect(remove.textContent).toBe("ownAssistant.projects.remove");
    act(() => remove.click());
    await settle();
    expect(calls.some((c) => c.init?.method === "DELETE")).toBe(false);
    const confirm = panel.querySelector<HTMLButtonElement>('[data-her-project="p2"] [data-her-project-remove-confirm]')!;
    expect(confirm.textContent).toBe("ownAssistant.projects.removeConfirm");
    const before = calls.filter((c) => c.url.endsWith("/api/assistants/a1/projects")).length;
    act(() => confirm.click());
    await settle();
    expect(calls.find((c) => c.init?.method === "DELETE")!.url).toBe("/api/assistants/a1/projects/p2");
    expect(calls.filter((c) => c.url.endsWith("/api/assistants/a1/projects")).length).toBe(before + 1);
  });

  // Final review I2: a project published before she served it is unknown to her until its next publish — say so.
  it("🔴 a project she doesn't know yet asks for a publish", async () => {
    serve({ projects: [HOME, { ...SHOP, knowsIt: false }] });
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage={true} needsPublish={false} nothingToKnow={false} />);
    await settle();
    const panel = await openProjects(host);
    expect(panel.querySelector('[data-her-project="p2"]')!.textContent).toContain('ownAssistant.projects.publishToKnow {"name":"Lucía"}');
    expect(panel.querySelector('[data-her-project="p1"]')!.textContent).not.toContain("ownAssistant.projects.publishToKnow");
  });

  it("🔴 taking her home while she answers says she is busy", async () => {
    const calls = serve({ projects: [HOME, SHOP] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") return new Response(JSON.stringify({ error: "busy" }), { status: 409 });
        return (calls.length, new Response(JSON.stringify({ projects: [{ ...HOME }, SHOP] })));
      }),
    );
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage={true} needsPublish={false} nothingToKnow={false} />);
    await settle();
    const panel = await openProjects(host);
    act(() => panel.querySelector<HTMLButtonElement>('[data-her-project="p1"] [data-her-project-remove]')!.click());
    await settle();
    act(() => panel.querySelector<HTMLButtonElement>('[data-her-project="p1"] [data-her-project-remove-confirm]')!.click());
    await settle();
    expect(panel.querySelector("[role=alert]")!.textContent).toBe('ownAssistant.projects.busy {"name":"Lucía"}');
  });

  it("her only project has no «Quitar»", async () => {
    serve({ projects: [HOME] });
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage={true} needsPublish={false} nothingToKnow={false} />);
    await settle();
    expect((await openProjects(host)).querySelector("[data-her-project-remove]")).toBeNull();
  });

  it("🔴 deleting her asks first, then leaves her place", async () => {
    const calls = serve({ projects: [HOME] });
    const left: string[] = [];
    const host = mount(<HerProjects assistantId="a1" name="Lucía" homeOnPage={true} homeNeedsPublish={false} homeNothingToKnow={false} leave={(href) => void left.push(href)} />);
    await settle();
    const panel = await openProjects(host);
    const del = panel.querySelector<HTMLButtonElement>("[data-her-delete]")!;
    expect(del.textContent).toBe('ownAssistant.projects.delete {"name":"Lucía"}');
    act(() => del.click());
    await settle();
    expect(calls.some((c) => c.init?.method === "DELETE")).toBe(false);
    act(() => panel.querySelector<HTMLButtonElement>("[data-her-delete-confirm]")!.click());
    await settle();
    expect(calls.find((c) => c.init?.method === "DELETE")!.url).toBe("/api/assistants/a1");
    expect(left).toEqual(["/es/projects"]);
  });

  it("each conversation says which project it came from", async () => {
    const line = (text: string) => [{ role: "visitor", text, at: AT }];
    serve({
      projects: [HOME, SHOP],
      visits: [
        { id: "v1", projectId: "p1", projectTitle: "Pastelería Canela", startedAt: AT, lastAt: AT, messageCount: 1, handedOff: false, lines: line("¿horario?") },
        { id: "v2", projectId: "p2", projectTitle: "Canela Tienda", startedAt: AT, lastAt: AT, messageCount: 1, handedOff: false, lines: line("¿envíos?") },
      ],
    });
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage={true} needsPublish={false} nothingToKnow={false} />);
    await settle();
    act(() => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')][1]!.click());
    await settle();
    const visits = [...host.querySelectorAll<HTMLElement>("[data-visit]")];
    expect(visits[0]!.textContent).toContain('ownAssistant.place.inProject {"project":"Pastelería Canela"}');
    expect(visits[1]!.textContent).toContain('ownAssistant.place.inProject {"project":"Canela Tienda"}');
  });

  // Phase 3: what visitors asked for and couldn't be done (spec §4.6.2 «Pedidos»).
  const request = (over: Record<string, unknown> = {}) => ({ id: "c1", projectId: "p1", projectTitle: "Pastelería", title: "Envíos a domicilio", visitors: 5, status: "pending", failure: null, acceptedRowId: null, createdAt: AT, lastAt: AT, decidedAt: null, ...over });
  const openRequests = async (host: HTMLElement) => {
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    act(() => tabs[2]!.click());
    await settle();
    return host.querySelector("[data-visitor-requests]")!;
  };

  it("her place has a third tab, Pedidos", async () => {
    const calls = serve();
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage={false} needsPublish={false} nothingToKnow={false} />);
    await settle();
    expect([...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(["ownAssistant.place.talk", "ownAssistant.place.conversations", "ownAssistant.requests.tab"]);
    // Mounted only the first time it opens.
    expect(calls.some((c) => c.url.endsWith("/api/assistants/a1/requests"))).toBe(false);
    expect(await openRequests(host)).not.toBeNull();
    expect(calls.some((c) => c.url.endsWith("/api/assistants/a1/requests"))).toBe(true);
  });

  it("waiting ones first, then what was decided", async () => {
    serve({ requests: [request({ id: "c1", title: "Regalos", status: "dismissed", decidedAt: AT }), request({ id: "c2", title: "Envíos a domicilio" }), request({ id: "c3", title: "Reservas", status: "accepted", decidedAt: AT, acceptedRowId: "row-9" })] });
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage={false} needsPublish={false} nothingToKnow={false} />);
    await settle();
    const list = await openRequests(host);
    const ids = [...list.querySelectorAll("[data-assistant-request-card]")].map((el) => el.getAttribute("data-assistant-request-card"));
    expect(ids[0]).toBe("c2");
    expect(ids.slice(1).sort()).toEqual(["c1", "c3"]);
    expect(list.querySelector('[data-assistant-request-card="c2"] [data-request-do-it]')).not.toBeNull();
    expect(list.querySelector('[data-assistant-request-card="c3"] [data-request-do-it]')).toBeNull();
    expect(list.textContent).toContain('ownAssistant.place.inProject {"project":"Pastelería"}');
  });

  it("with none it says so", async () => {
    serve({ requests: [] });
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage={false} needsPublish={false} nothingToKnow={false} />);
    await settle();
    expect((await openRequests(host)).textContent).toContain('ownAssistant.requests.empty {"name":"Lucía"}');
  });

  it("🔴 the press from here reports where Len is working", async () => {
    const calls = serve({ requests: [request()] });
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage={false} needsPublish={false} nothingToKnow={false} />);
    await settle();
    const list = await openRequests(host);
    act(() => list.querySelector<HTMLButtonElement>("[data-request-do-it]")!.click());
    await settle();
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(post.url).toBe("/api/assistants/a1/requests/c1");
    expect(JSON.parse(String(post.init!.body))).toMatchObject({ action: "accept" });
    const link = host.querySelector<HTMLAnchorElement>("[data-request-where]")!;
    expect(link.getAttribute("href")).toBe("/es/new?project=p1&chat=1");
    expect(link.textContent).toBe("ownAssistant.requests.openChat");
  });

  it("🔴 turning her on says it shows after publishing", async () => {
    const calls = serve();
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage={false} needsPublish={false} nothingToKnow={false} />);
    await settle();
    const sw = host.querySelector<HTMLButtonElement>('[data-on-page] [role="switch"]')!;
    expect(sw.getAttribute("aria-checked")).toBe("false");
    act(() => sw.click());
    await settle();
    const patch = calls.find((c) => c.init?.method === "PATCH")!;
    expect(patch.url).toBe("/api/assistants/a1");
    expect(JSON.parse(String(patch.init!.body))).toEqual({ onPage: true });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(host.textContent).toContain("ownAssistant.place.onPageHint");
  });
});

// Deferred minors of the phase 2A review.
describe("her place's controls, what they say", () => {
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));
  function serve() {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), ...(init ? { init } : {}) });
        if (String(url).endsWith("/api/assistants/a1/visits")) return new Response(JSON.stringify({ visits: [] }));
        if (String(url).endsWith("/api/assistants/visitor-budget")) return new Response(JSON.stringify({ spent: 0, cap: 12_500, explicit: null, max: 50_000 }));
        return new Response("{}", { status: 200 });
      }),
    );
    return calls;
  }

  // Phase 6: her figure is changed from her place, with the creator that made her.
  it("🔴 «Cambiar figura» saves her new look, her place wears it at once, and a published page is told to publish", async () => {
    const calls = serve();
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage needsPublish={false} nothingToKnow={false} />);
    await settle();
    expect(host.querySelector("[data-figure-publish]")).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>("[data-change-figure]")!.click());
    expect(document.querySelector("[data-assistant-name]")).toBeNull();
    act(() => document.querySelector<HTMLButtonElement>('[data-figure-category="shape"] [data-figure-option="heart"]')!.click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-assistant-done]")!.click());
    await settle();
    const patch = calls.find((c) => c.url.endsWith("/api/assistants/a1") && c.init?.method === "PATCH")!;
    expect(JSON.parse(String(patch.init!.body))).toEqual({ look: { ...LUCIA.look, shape: "heart" } });
    expect(document.querySelector("[data-assistant-done]")).toBeNull();
    expect(host.querySelector("[data-figure-publish]")).not.toBeNull();
    // 🔴 «Listo» answers: the creator closing alone does not say the figure was kept.
    expect(toast.success).toHaveBeenCalledWith("ownAssistant.place.figureSaved");
    // The heart's own outline is in her place now.
    expect(host.querySelector('[data-assistant-header] [data-part="body"] path[d^="M30 54"]')).not.toBeNull();
  });

  it("🔴 after a reload, on but not yet published with her still says it shows after publishing", async () => {
    serve();
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage needsPublish nothingToKnow={false} />);
    await settle();
    expect(host.querySelector('[data-on-page] [role="switch"]')!.getAttribute("aria-checked")).toBe("true");
    expect(host.textContent).toContain("ownAssistant.place.onPageHint");
  });

  // Phase 2B: apps and games can have her; published with nothing for her to know says so.
  it("an app can turn her on now", async () => {
    const calls = serve();
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage={false} needsPublish={false} nothingToKnow={false} />);
    await settle();
    const sw = host.querySelector<HTMLButtonElement>('[data-on-page] [role="switch"]')!;
    expect(sw.disabled).toBe(false);
    act(() => sw.click());
    await settle();
    expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true);
  });

  it("published with nothing to know says so", async () => {
    serve();
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage needsPublish={false} nothingToKnow />);
    await settle();
    expect(host.textContent).toContain("ownAssistant.place.nothingToKnow");
    expect(host.textContent).not.toContain("ownAssistant.place.onPageHint");
  });

  it("her visual shows in the visit, as the visitor saw it", async () => {
    const AT = "2026-11-08T18:00:00.000Z";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/api/assistants/a1/visits"))
          return new Response(JSON.stringify({ visits: [{ id: "v1", startedAt: AT, lastAt: AT, messageCount: 1, handedOff: false, lines: [{ role: "visitor", text: "¿Huecos?", at: AT }, { role: "assistant", text: "Estos:", at: AT, visuals: [{ title: "huecos", code: "<div>17:00</div>" }] }] }] }));
        if (String(url).endsWith("/api/assistants/visitor-budget")) return new Response(JSON.stringify({ spent: 0, cap: 12_500, explicit: null, max: 50_000 }));
        // As in production: the visuals host exists. Her visitors' visuals must not use it.
        if (String(url).endsWith("/api/visual-frame-url")) return new Response(JSON.stringify({ url: "https://lienzo-visuals.openlen.app/" }));
        return new Response("{}", { status: 200 });
      }),
    );
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage needsPublish={false} nothingToKnow={false} />);
    await settle();
    act(() => host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.click());
    await settle();
    const visit = host.querySelector("[data-visitor-conversations]")!;
    expect(visit.textContent).toContain("Estos:");
    expect(visit.querySelector('[data-testid="len-visual"]')).not.toBeNull();

    // Final review C1: a visitor could steer this code — it never runs on the visuals origin next to the owner's own
    // visuals, only as the visitor saw it: a closed srcdoc with a null origin.
    const frame = visit.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBeNull();
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("srcdoc")).toContain("connect-src 'none'");

    // Final review I1: a visual that navigates its own frame (a second load) is taken down.
    act(() => {
      frame.dispatchEvent(new Event("load"));
      frame.dispatchEvent(new Event("load"));
    });
    expect(visit.querySelector("iframe")).toBeNull();
  });

  it("🔴 a cap above the plan says what it can be, and isn't sent", async () => {
    const calls = serve();
    const host = mount(<AssistantHome assistant={LUCIA} projectHtml="" initialChat={[]} onPage={false} needsPublish={false} nothingToKnow={false} />);
    await settle();
    act(() => host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.click());
    await settle();
    const change = [...host.querySelectorAll<HTMLButtonElement>("[data-visitor-budget] button")].find((b) => b.textContent === "ownAssistant.place.budgetChange")!;
    act(() => change.click());
    const field = host.querySelector<HTMLInputElement>("#visitor-cap")!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(field, "999");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...host.querySelectorAll<HTMLButtonElement>("[data-visitor-budget] button")].find((b) => b.textContent === "ownAssistant.place.budgetSave")!;
    act(() => save.click());
    await settle();
    expect(host.textContent).toContain('ownAssistant.place.budgetRange {"max":"500"}');
    expect(calls.some((c) => c.init?.method === "PUT")).toBe(false);
  });
});
