// THE CONFIRMATION OPENLEN DRAWS (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, option B): outside the
// tool's frame, with the change in front of the person, and nothing applied until they press «Aplicar».
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
}));

import { DataChangeDialog } from "./data-change-dialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

const CHANGE = { projectId: "p1", table: "reservas", key: { id: 12 }, set: { estado: "confirmada" }, before: { estado: "pendiente" } };

function render(onAccept = vi.fn(), onCancel = vi.fn()) {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  roots.push(root);
  act(() => root.render(<DataChangeDialog open toolTitle="Reservas de hoy" projectTitle="Café" change={CHANGE} onAccept={onAccept} onCancel={onCancel} />));
  return { onAccept, onCancel };
}

const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;

describe("DataChangeDialog", () => {
  it("shows who wants to change what, before → after", () => {
    render();
    expect(document.body.textContent).toContain('tools.change.title {"tool":"Reservas de hoy","table":"reservas","project":"Café"}');
    const row = document.querySelector('[data-event-column="estado"]')!;
    expect(row.textContent).toContain("pendiente");
    expect(row.textContent).toContain("confirmada");
  });

  it("names the row it changes by its key", () => {
    render();
    expect(document.querySelector("[data-tool-change-key]")?.textContent).toBe("id = 12");
  });

  it("«Aplicar» accepts; «Cancelar» doesn't", () => {
    const r = render();
    act(() => button("tools.change.apply").click());
    expect(r.onAccept).toHaveBeenCalledTimes(1);
    act(() => button("tools.change.cancel").click());
    expect(r.onCancel).toHaveBeenCalledTimes(1);
  });
});
