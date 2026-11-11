// RENAMING HER FROM HER PLACE (spec local 2026-11-06-asistente-propio, §6.8, phase 4D): her name and her address change
// together; a published page shows the new name after its next publish.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, v?: Record<string, unknown>) => (v ? `${clave} ${JSON.stringify(v)}` : clave),
  useLocale: () => "es",
}));

import { RenameHer } from "./rename-her";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ name: "Marta", slug: "marta" }), { status: 200 }));
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
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function rename(host: HTMLElement, to: string) {
  act(() => host.querySelector<HTMLButtonElement>("[data-rename-open]")!.click());
  type(document.querySelector<HTMLInputElement>("[data-rename-input]")!, to);
  act(() => document.querySelector<HTMLButtonElement>("[data-rename-save]")!.click());
  await flush();
}

describe("RenameHer", () => {
  it("🔴 saving a new name goes to her new address", async () => {
    const leave = vi.fn();
    const host = mount(<RenameHer assistantId="a1" name="Lucía" onPage={false} leave={leave} />);
    await rename(host, "Marta");
    expect(fetchMock).toHaveBeenCalledWith("/api/assistants/a1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Marta" }) }));
    expect(leave).toHaveBeenCalledWith("/es/assistant/marta");
  });

  it("🔴 a taken name says so and stays", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "name_taken" }), { status: 409 }));
    const leave = vi.fn();
    const host = mount(<RenameHer assistantId="a1" name="Lucía" onPage={false} leave={leave} />);
    await rename(host, "Ana");
    expect(document.querySelector('[data-her-sheet] [role="alert"]')?.textContent).toBe("ownAssistant.errors.nameTaken");
    expect(leave).not.toHaveBeenCalled();
  });

  it("with her bubble on her page, it says the page shows the new name after publishing", () => {
    const on = mount(<RenameHer assistantId="a1" name="Lucía" onPage leave={vi.fn()} />);
    act(() => on.querySelector<HTMLButtonElement>("[data-rename-open]")!.click());
    // The sheet is on <body>, not inside the menu.
    expect(document.querySelector("[data-her-sheet]")!.textContent).toContain("ownAssistant.place.renamePublish");
    act(() => roots.splice(0).forEach((r) => r.unmount()));
    const off = mount(<RenameHer assistantId="a1" name="Lucía" onPage={false} leave={vi.fn()} />);
    act(() => off.querySelector<HTMLButtonElement>("[data-rename-open]")!.click());
    expect(document.querySelector("[data-her-sheet]")!.textContent).not.toContain("ownAssistant.place.renamePublish");
  });
});
