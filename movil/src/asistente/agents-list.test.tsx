// @vitest-environment jsdom
// THE LIST OF AGENTS (spec local 2026-11-19-agentes-para-todos, §2.2 and §6.8): «se ven en una lista, como contactos de
// WhatsApp» — on the phone, to choose whom to talk to.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssistantListItem } from "@/lib/assistants/view";

import { AgentsList } from "./agents-list";

vi.mock("use-intl", () => ({ useTranslations: () => (k: string) => k }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const look = { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" } as const;
const agent = (id: string, name: string): AssistantListItem => ({ id, name, slug: id, look, color: look.color, tone: "friendly", projectId: "space", projectIds: ["space"] });
const CHEF = agent("a3", "Chef Rosa");
const ANA = agent("a4", "Teacher Ana");

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
});
function paint(props: Partial<React.ComponentProps<typeof AgentsList>> = {}) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const onElegir = vi.fn();
  act(() => root!.render(<AgentsList agentes={[CHEF, ANA]} actual="a4" onElegir={onElegir} {...props} />));
  const rows = () => [...host.querySelectorAll<HTMLButtonElement>("[data-agente]")];
  return { onElegir, rows };
}

describe("the list of agents", () => {
  it("🔴 each agent is a row with her figure and name, the app's one marked", () => {
    const { rows } = paint();
    expect(rows().map((r) => r.dataset.agente)).toEqual(["a3", "a4"]);
    expect(rows().map((r) => r.textContent)).toEqual(["Chef Rosa", "Teacher Ana"]);
    expect(rows()[0]!.querySelector("[data-assistant-figure]")).not.toBeNull();
    expect(rows().map((r) => r.getAttribute("aria-current"))).toEqual([null, "true"]);
  });

  it("tapping one talks to her", () => {
    const { rows, onElegir } = paint();
    act(() => rows()[0]!.click());
    expect(onElegir).toHaveBeenCalledWith(CHEF);
  });

  it("«Crear un agente» only when it can be made", () => {
    paint();
    expect(host.querySelector("[data-crear-agente]")).toBeNull();
    act(() => root!.unmount());
    root = null;
    host.remove();
    const onCrear = vi.fn();
    paint({ onCrear });
    act(() => host.querySelector<HTMLButtonElement>("[data-crear-agente]")!.click());
    expect(onCrear).toHaveBeenCalled();
    expect(host.querySelector("[data-crear-agente]")!.textContent).toBe("crearAgente");
  });

  it("as a panel, it has its title and a way back", () => {
    const onCerrar = vi.fn();
    paint({ onCerrar });
    expect(host.textContent).toContain("agentes");
    act(() => host.querySelector<HTMLButtonElement>("[data-agentes-volver]")!.click());
    expect(onCerrar).toHaveBeenCalled();
  });

  // Final review I1: like every other panel, Android's back closes it instead of sending the app to the background.
  it("🔴 as a panel, the phone's back closes it", async () => {
    const onCerrar = vi.fn();
    paint({ onCerrar });
    // Waited for until the page has heard it, not for a fixed time (see delivered-tab.test).
    await act(async () => {
      const heard = new Promise<void>((r) => window.addEventListener("popstate", () => r(), { once: true }));
      history.back();
      await heard;
    });
    expect(onCerrar).toHaveBeenCalled();
  });
});
