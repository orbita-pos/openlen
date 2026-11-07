// THE CREATOR, LIKE MUSE (spec local 2026-11-06-asistente-propio, §4.4): Len's card opens it; the figure in big, its
// name, shape, color and how it talks; «Listo» creates it. The card says when it is ready, with the way to its place.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, v?: Record<string, unknown>) => (v ? `${clave} ${JSON.stringify(v)}` : clave),
  useLocale: () => "es",
}));

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
    act(() => document.querySelector<HTMLButtonElement>('[data-assistant-shape="ring"]')!.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-assistant-tone="formal"]')!.click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-assistant-done]")!.click());
    await flush();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/assistants");
    expect(JSON.parse(String(init.body))).toMatchObject({ projectId: "p1", name: "Lucía", shape: "ring", tone: "formal" });
    expect(onCreated).toHaveBeenCalledWith({ id: "a1", slug: "lucia", name: "Lucía" });
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

  it("says it is ready, with the way to its place, when it exists", async () => {
    fetchMock.mockReturnValueOnce(json({ assistants: [{ id: "a1", name: "Lucía", slug: "lucia", shape: "blob", color: "#F4A48B", tone: "friendly", projectId: "p1" }] }));
    const host = mount(<AssistantCreateCard actions={ACTIONS} projectId="p1" />);
    await flush();
    expect(host.querySelector("[data-assistant-create]")).toBeNull();
    expect(host.querySelector<HTMLAnchorElement>("[data-assistant-talk]")!.getAttribute("href")).toBe("/es/assistant/lucia");
  });

  it("is not there without Len's card", () => {
    const host = mount(<AssistantCreateCard actions={[{ tool: "Read", status: "done", summary: "x" }]} projectId="p1" />);
    expect(host.innerHTML).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
