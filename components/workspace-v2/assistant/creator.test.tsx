// THE CREATOR, LIKE MUSE (spec local 2026-11-06-asistente-propio, §4.4): Len's card opens it; the figure in big, its
// name, shape, color and how it talks; «Listo» creates it. The card says when it is ready, with the way to its place.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, v?: Record<string, unknown>) => (v ? `${clave} ${JSON.stringify(v)}` : clave),
  useLocale: () => "es",
}));

// The live figure asks the switch and wants WebGL: here it is a mark that says what it was given.
vi.mock("./live-figure", () => ({
  LiveFigure: ({ look, activity }: { look: { shape: string }; activity?: string }) => <i data-live-figure={look.shape} data-activity={activity ?? "ready"} />,
}));

import { FIGURE_ACCESSORIES, FIGURE_EYES, FIGURE_EYEWEAR, FIGURE_SHAPES, checkLook } from "@/lib/figure/look";

import { AssistantCreateCard } from "./create-card";
import { AssistantCreatorDialog } from "./creator-dialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
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
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the creator", () => {
  it("sends what was picked and tells the caller what it made", async () => {
    fetchMock.mockReturnValueOnce(json({ id: "a1", slug: "lucia" }, 201));
    const onCreated = vi.fn();
    mount(<AssistantCreatorDialog open projectId="p1" onClose={() => {}} onCreated={onCreated} />);
    type(document.querySelector<HTMLInputElement>("[data-assistant-name]")!, "Lucía");
    act(() => document.querySelector<HTMLButtonElement>('[data-figure-category="shape"] [data-figure-option="heart"]')!.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-figure-category="accessory"] [data-figure-option="crown"]')!.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-assistant-tone="formal"]')!.click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-assistant-done]")!.click());
    await flush();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/assistants");
    expect(JSON.parse(String(init.body))).toMatchObject({ projectId: "p1", name: "Lucía", look: { v: 1, shape: "heart", accessory: "crown" }, tone: "formal" });
    expect(checkLook(JSON.parse(String(init.body)).look).ok).toBe(true);
    expect(onCreated).toHaveBeenCalledWith({ id: "a1", slug: "lucia", name: "Lucía" });
  });

  // Phase 4D (spec §6.9): the creator offers the morning summary, unticked.
  it("🔴 the creator offers the morning summary, unticked, and sends what was chosen with the page's language", async () => {
    fetchMock.mockReturnValue(json({ id: "a1", slug: "lucia" }, 201));
    mount(<AssistantCreatorDialog open projectId="p1" onClose={() => {}} onCreated={() => {}} />);
    const box = document.querySelector<HTMLInputElement>("[data-assistant-morning]")!;
    expect(box.checked).toBe(false);
    type(document.querySelector<HTMLInputElement>("[data-assistant-name]")!, "Lucía");
    await act(async () => document.querySelector<HTMLButtonElement>("[data-assistant-done]")!.click());
    await flush();
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).toMatchObject({ morningSummary: false, locale: "es" });
    act(() => box.click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-assistant-done]")!.click());
    await flush();
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body))).toMatchObject({ morningSummary: true, locale: "es" });
  });

  it("shows a taken name next to the name and creates nothing", async () => {
    fetchMock.mockReturnValueOnce(json({ error: "name_taken" }, 409));
    const onCreated = vi.fn();
    mount(<AssistantCreatorDialog open projectId="p1" onClose={() => {}} onCreated={onCreated} />);
    type(document.querySelector<HTMLInputElement>("[data-assistant-name]")!, "Lucía");
    await act(async () => document.querySelector<HTMLButtonElement>("[data-assistant-done]")!.click());
    await flush();
    expect(document.querySelector("[data-assistant-error]")!.textContent).toContain("ownAssistant.errors.nameTaken");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("🔴 a member is told only the project's owner can create its assistant", async () => {
    fetchMock.mockReturnValueOnce(json({ error: "solo_dueno" }, 403));
    mount(<AssistantCreatorDialog open projectId="p1" onClose={() => {}} onCreated={() => {}} />);
    type(document.querySelector<HTMLInputElement>("[data-assistant-name]")!, "Lucía");
    await act(async () => document.querySelector<HTMLButtonElement>("[data-assistant-done]")!.click());
    await flush();
    expect(document.querySelector("[data-assistant-error]")!.textContent).toContain("ownAssistant.errors.ownerOnly");
  });

  const HEART = { v: 1, shape: "heart", color: "#19c3b1", eyes: "round", eyewear: "shades", accessory: "crown" } as const;

  it("🔴 offers every entry of the catalog, however many there are, and opens with the look it was given", () => {
    mount(<AssistantCreatorDialog open projectId="p1" onClose={() => {}} onCreated={() => {}} initial={HEART} />);
    const options = (category: string) => [...document.querySelectorAll(`[data-figure-category="${category}"] [data-figure-option]`)].map((b) => b.getAttribute("data-figure-option"));
    expect(options("shape")).toEqual([...FIGURE_SHAPES]);
    expect(options("eyes")).toEqual([...FIGURE_EYES]);
    expect(options("eyewear")).toEqual([...FIGURE_EYEWEAR]);
    expect(options("accessory")).toEqual([...FIGURE_ACCESSORIES]);
    const pressed = [...document.querySelectorAll('[data-figure-option][aria-pressed="true"]')].map((b) => b.getAttribute("data-figure-option"));
    expect(pressed).toEqual(["heart", "round", "shades", "crown"]);
    expect(document.querySelector("[data-live-figure]")!.getAttribute("data-live-figure")).toBe("heart");
  });

  it("«sorpréndeme» gives a look of the catalog, and a free color is taken", async () => {
    fetchMock.mockReturnValue(json({ id: "a1", slug: "lucia" }, 201));
    mount(<AssistantCreatorDialog open projectId="p1" onClose={() => {}} onCreated={() => {}} initial={HEART} />);
    type(document.querySelector<HTMLInputElement>("[data-assistant-name]")!, "Lucía");
    act(() => document.querySelector<HTMLButtonElement>("[data-figure-surprise]")!.click());
    type(document.querySelector<HTMLInputElement>("[data-assistant-free-color]")!, "#123abc");
    await act(async () => document.querySelector<HTMLButtonElement>("[data-assistant-done]")!.click());
    await flush();
    const sent = JSON.parse(String(fetchMock.mock.calls[0]![1].body)).look;
    expect(checkLook(sent)).toEqual({ ok: true, value: sent });
    expect(sent.color).toBe("#123abc");
  });

  it("the figure listens while its name is being written", () => {
    mount(<AssistantCreatorDialog open projectId="p1" onClose={() => {}} onCreated={() => {}} />);
    const input = document.querySelector<HTMLInputElement>("[data-assistant-name]")!;
    expect(document.querySelector("[data-live-figure]")!.getAttribute("data-activity")).toBe("ready");
    act(() => input.focus());
    expect(document.querySelector("[data-live-figure]")!.getAttribute("data-activity")).toBe("listening");
  });

  it("🔴 changing the figure of one that exists sends only her look, to her", async () => {
    fetchMock.mockReturnValueOnce(json({ look: HEART }));
    const onSaved = vi.fn();
    mount(<AssistantCreatorDialog open projectId="p1" onClose={() => {}} onCreated={() => {}} editing={{ id: "a1", name: "Lucía", look: HEART }} onSaved={onSaved} />);
    expect(document.querySelector("[data-assistant-name]")).toBeNull();
    expect(document.querySelector("[data-assistant-tone]")).toBeNull();
    act(() => document.querySelector<HTMLButtonElement>('[data-figure-category="shape"] [data-figure-option="flower"]')!.click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-assistant-done]")!.click());
    await flush();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/assistants/a1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ look: { ...HEART, shape: "flower" } });
    expect(onSaved).toHaveBeenCalledWith({ ...HEART, shape: "flower" });
  });

  it("won't send without a name", () => {
    mount(<AssistantCreatorDialog open projectId="p1" onClose={() => {}} onCreated={() => {}} />);
    expect(document.querySelector<HTMLButtonElement>("[data-assistant-done]")!.disabled).toBe(true);
  });
});

describe("the card Len leaves", () => {
  const ACTIONS = [{ tool: "create_assistant", status: "done" as const, summary: "create_assistant" }];

  it("offers to create one when the project has none", async () => {
    fetchMock.mockReturnValueOnce(json({ assistants: [] }));
    const host = mount(<AssistantCreateCard actions={ACTIONS} projectId="p1" />);
    await flush();
    expect(host.querySelector("[data-assistant-create]")).not.toBeNull();
  });

  it("🔴 the creator opens with the figure Len suggested", async () => {
    fetchMock.mockReturnValueOnce(json({ assistants: [] }));
    const suggested = [{ tool: "create_assistant", status: "done" as const, summary: 'create_assistant {"v":1,"shape":"flower","color":"#19c3b1","eyes":"smile","eyewear":"none","accessory":"bow"}' }];
    const host = mount(<AssistantCreateCard actions={suggested} projectId="p1" />);
    await flush();
    act(() => host.querySelector<HTMLButtonElement>("[data-assistant-create]")!.click());
    const pressed = [...document.querySelectorAll('[data-figure-option][aria-pressed="true"]')].map((b) => b.getAttribute("data-figure-option"));
    expect(pressed).toEqual(["flower", "smile", "none", "bow"]);
  });

  it("says it is ready, with the way to its place, when it exists", async () => {
    fetchMock.mockReturnValueOnce(json({ assistants: [{ id: "a1", name: "Lucía", slug: "lucia", look: { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" } as const, color: "#f4a48b", tone: "friendly", projectId: "p1" }] }));
    const host = mount(<AssistantCreateCard actions={ACTIONS} projectId="p1" />);
    await flush();
    expect(host.querySelector("[data-assistant-create]")).toBeNull();
    expect(host.querySelector<HTMLAnchorElement>("[data-assistant-talk]")!.getAttribute("href")).toBe("/es/assistant/lucia");
  });

  // Phase 4: she can serve this project without it being her home.
  it("says it is ready when this project is one she serves, not only her home", async () => {
    fetchMock.mockReturnValueOnce(json({ assistants: [{ id: "a1", name: "Lucía", slug: "lucia", look: { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" } as const, color: "#f4a48b", tone: "friendly", projectId: "p9", projectIds: ["p9", "p1"] }] }));
    const host = mount(<AssistantCreateCard actions={ACTIONS} projectId="p1" />);
    await flush();
    expect(host.querySelector("[data-assistant-talk]")).not.toBeNull();
  });

  it("the card offers to use Lucía here; pressing it connects her and shows her ready", async () => {
    fetchMock.mockReturnValueOnce(json({ assistants: [{ id: "a1", name: "Lucía", slug: "lucia", look: { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" } as const, color: "#f4a48b", tone: "friendly", projectId: "p9", projectIds: ["p9"] }] }));
    const host = mount(<AssistantCreateCard actions={ACTIONS} projectId="p1" />);
    await flush();
    const use = host.querySelector<HTMLButtonElement>('[data-assistant-use="a1"]')!;
    expect(use.textContent).toBe('ownAssistant.card.useHere {"name":"Lucía"}');
    expect(host.querySelector("[data-assistant-create]")!.textContent).toBe("ownAssistant.card.createAnother");
    fetchMock.mockReturnValueOnce(json({ projectId: "p1" }, 201));
    act(() => use.click());
    await flush();
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/assistants/a1/projects");
    expect(JSON.parse(String(init.body))).toEqual({ projectId: "p1" });
    expect(host.querySelector<HTMLAnchorElement>("[data-assistant-talk]")!.getAttribute("href")).toBe("/es/assistant/lucia");
  });

  it("using her here when the project got another meanwhile says so", async () => {
    fetchMock.mockReturnValueOnce(json({ assistants: [{ id: "a1", name: "Lucía", slug: "lucia", look: { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" } as const, color: "#f4a48b", tone: "friendly", projectId: "p9", projectIds: ["p9"] }] }));
    const host = mount(<AssistantCreateCard actions={ACTIONS} projectId="p1" />);
    await flush();
    fetchMock.mockReturnValueOnce(json({ error: "project_has_assistant" }, 409));
    act(() => host.querySelector<HTMLButtonElement>('[data-assistant-use="a1"]')!.click());
    await flush();
    expect(host.querySelector("[role=alert]")!.textContent).toBe("ownAssistant.errors.projectHas");
  });

  it("«create another» still opens the creator", async () => {
    fetchMock.mockReturnValueOnce(json({ assistants: [{ id: "a1", name: "Lucía", slug: "lucia", look: { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" } as const, color: "#f4a48b", tone: "friendly", projectId: "p9", projectIds: ["p9"] }] }));
    const host = mount(<AssistantCreateCard actions={ACTIONS} projectId="p1" />);
    await flush();
    act(() => host.querySelector<HTMLButtonElement>("[data-assistant-create]")!.click());
    await flush();
    expect(document.querySelector("[role=dialog]")).not.toBeNull();
  });

  it("is not there without Len's card", () => {
    const host = mount(<AssistantCreateCard actions={[{ tool: "Read", status: "done", summary: "x" }]} projectId="p1" />);
    expect(host.innerHTML).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
