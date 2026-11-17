import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WelcomeCreator } from "./welcome-creator";

vi.mock("use-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@/components/workspace-v2/assistant/live-figure", () => ({ LiveFigure: () => <div data-live-figure="" /> }));
vi.mock("../atras", () => ({ useAtras: () => {} }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const pedir = vi.fn();
const cliente = { pedir, avisarAlCerrar: vi.fn() };
const on = { created: vi.fn(), notNow: vi.fn() };
beforeEach(() => {
  pedir.mockReset();
  on.created.mockReset();
  on.notNow.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<WelcomeCreator cliente={cliente} projectId="p1" idioma="es" onCreated={on.created} onNotNow={on.notNow} />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const nameInput = () => host.querySelector<HTMLInputElement>("[data-assistant-name]")!;
const done = () => host.querySelector<HTMLButtonElement>("[data-assistant-done]")!;
function type(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(nameInput(), value);
    nameInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("meet your assistant on the phone (spec local 2026-11-16-movil-es-tu-asistente, §5.1)", () => {
  it("«Listo» waits for a name", () => {
    expect(done().disabled).toBe(true);
    type("Lucía");
    expect(done().disabled).toBe(false);
  });

  it("🔴 «Listo» creates her on the project, with her bubble off", async () => {
    pedir.mockResolvedValue(Response.json({ id: "a9", slug: "lucia" }, { status: 201 }));
    type("Lucía");
    await act(async () => done().click());
    const [route, init] = pedir.mock.calls[0] as [string, RequestInit];
    expect(route).toBe("/api/assistants");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ projectId: "p1", name: "Lucía", tone: "friendly", onPage: false });
    expect(body.look).toMatchObject({ v: 1 });
    expect(on.created).toHaveBeenCalledWith("a9");
  });

  it("a refused name is marked on its field", async () => {
    pedir.mockResolvedValue(Response.json({ field: "name" }, { status: 400 }));
    type("!!");
    await act(async () => done().click());
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("own.errors.name");
    expect(on.created).not.toHaveBeenCalled();
  });

  it("a name she already has says so", async () => {
    pedir.mockResolvedValue(Response.json({ error: "name_taken" }, { status: 409 }));
    type("Lucía");
    await act(async () => done().click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("own.errors.nameTaken");
  });

  it("«Ahora no» leaves without creating", () => {
    act(() => host.querySelector<HTMLButtonElement>("[data-welcome-not-now]")!.click());
    expect(on.notNow).toHaveBeenCalled();
    expect(pedir).not.toHaveBeenCalled();
  });
});
