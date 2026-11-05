// THE «CREAR» CARD UNDER LEN'S ANSWER (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): DeepSeek's
// personalized-page card, per state — proposed (brief, initial content, place, the cost notice, Crear / Ahora no),
// creating (Cancelar), installing, installed (Abrir / Deshacer), removed (Restaurar), failed (Reintentar),
// needs_review (the findings, Instalar igual, Abrir proyecto), replaced and dismissed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
  useLocale: () => "es",
}));
const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, useSearchParams: () => new URLSearchParams("project=p1") }));

import type { ToolCardView } from "@/lib/tools/cards/types";

import { ToolSuggestionCard, ToolSuggestionCards } from "./tool-suggestion-card";
import { toolCardsLive } from "./use-tool-cards";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
beforeEach(() => {
  nav.replace.mockReset();
  try {
    localStorage.clear();
  } catch {
    // no storage here
  }
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  toolCardsLive.forget();
  vi.unstubAllGlobals();
});

function paint(node: React.ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

const card = (over: Partial<ToolCardView> = {}): ToolCardView => ({
  id: "card-1",
  chatRowId: "row-1",
  title: "Reservas de hoy",
  brief: "Ver las reservas del día y marcarlas al llegar.",
  initialContent: null,
  placement: "rail",
  customLocation: null,
  phase: "proposed",
  toolProjectId: null,
  installationId: null,
  error: null,
  review: null,
  ...over,
});

const buttons = (host: HTMLElement) => [...host.querySelectorAll("button")].map((b) => b.textContent);
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
const press = () => vi.fn(async (_verb: string, _payload?: Record<string, unknown>) => ({ status: "accepted" as const }));

describe("ToolSuggestionCard — proposed", () => {
  it("title, brief, place picker, Crear and Ahora no; Crear sends the place", async () => {
    const onPress = press();
    const host = paint(<ToolSuggestionCard card={card()} capCredits={25} onPress={onPress} />);
    expect(host.textContent).toContain("Reservas de hoy");
    expect(host.textContent).toContain("Ver las reservas del día");
    expect(buttons(host)).toEqual(expect.arrayContaining(["toolCard.create", "toolCard.notNow"]));
    const select = host.querySelector<HTMLSelectElement>("select[data-tool-card-place]")!;
    act(() => {
      select.value = "project";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button(host, "toolCard.create").click());
    expect(onPress).toHaveBeenCalledWith("create", { placement: "project" });
  });

  it("«Escribe dónde»: Crear is disabled while empty or over 1,000 characters, and sends the words", async () => {
    const onPress = press();
    const host = paint(<ToolSuggestionCard card={card()} capCredits={25} onPress={onPress} />);
    const select = host.querySelector<HTMLSelectElement>("select[data-tool-card-place]")!;
    act(() => {
      select.value = "custom";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const area = host.querySelector<HTMLTextAreaElement>("textarea[data-tool-card-custom]")!;
    expect(button(host, "toolCard.create").disabled).toBe(true);
    const type = (text: string) =>
      act(() => {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
        set.call(area, text);
        area.dispatchEvent(new Event("input", { bubbles: true }));
      });
    type("x".repeat(1001));
    expect(button(host, "toolCard.create").disabled).toBe(true);
    type("Junto al chat de cada proyecto");
    expect(button(host, "toolCard.create").disabled).toBe(false);
    await act(async () => button(host, "toolCard.create").click());
    expect(onPress).toHaveBeenCalledWith("create", { customLocation: "Junto al chat de cada proyecto" });
  });

  it("Ahora no dismisses with the place chosen", async () => {
    const onPress = press();
    const host = paint(<ToolSuggestionCard card={card()} capCredits={25} onPress={onPress} />);
    await act(async () => button(host, "toolCard.notNow").click());
    expect(onPress).toHaveBeenCalledWith("dismiss", { placement: "rail" });
  });

  it("the initial content is folded below", () => {
    const host = paint(<ToolSuggestionCard card={card({ initialContent: "Mesa 4, 20:00" })} capCredits={25} onPress={press()} />);
    const details = host.querySelector("details[data-tool-card-content]")!;
    expect(details.hasAttribute("open")).toBe(false);
    expect(details.textContent).toContain("Mesa 4, 20:00");
  });

  it("the cost notice names the cap, closes, stays closed on remount, and «i» reopens it", () => {
    const host = paint(<ToolSuggestionCard card={card()} capCredits={25} onPress={press()} />);
    expect(host.querySelector("[data-tool-card-notice]")!.textContent).toContain('"cap":25');
    act(() => host.querySelector<HTMLButtonElement>("button[aria-label='toolCard.closeNotice']")!.click());
    expect(host.querySelector("[data-tool-card-notice]")).toBeNull();
    const again = paint(<ToolSuggestionCard card={card()} capCredits={25} onPress={press()} />);
    expect(again.querySelector("[data-tool-card-notice]")).toBeNull();
    act(() => again.querySelector<HTMLButtonElement>("button[aria-label='toolCard.showNotice']")!.click());
    expect(again.querySelector("[data-tool-card-notice]")).not.toBeNull();
  });

  it("a Free plan press says so", async () => {
    const onPress = vi.fn(async () => ({ status: "refused" as const, reason: "plan_required" }));
    const host = paint(<ToolSuggestionCard card={card()} capCredits={25} onPress={onPress} />);
    await act(async () => button(host, "toolCard.create").click());
    expect(host.textContent).toContain("toolCard.planRequired");
  });
});

describe("ToolSuggestionCard — the other states", () => {
  it("creating: progress and Cancelar, disabled while the cancel waits", async () => {
    let finish: (v: { status: "settled"; card: ToolCardView }) => void = () => {};
    const onPress = vi.fn(() => new Promise<{ status: "settled"; card: ToolCardView }>((r) => (finish = r)));
    const host = paint(<ToolSuggestionCard card={card({ phase: "creating" })} capCredits={25} onPress={onPress} />);
    expect(host.textContent).toContain("toolCard.creating");
    await act(async () => button(host, "toolCard.cancel").click());
    expect(onPress).toHaveBeenCalledWith("cancel", undefined);
    expect(button(host, "toolCard.cancelling").disabled).toBe(true);
    await act(async () => finish({ status: "settled", card: card({ phase: "cancelled" }) }));
  });

  it("installing: no cancel", () => {
    const host = paint(<ToolSuggestionCard card={card({ phase: "installing" })} capCredits={25} onPress={press()} />);
    expect(host.textContent).toContain("toolCard.installing");
    expect(buttons(host)).toEqual([]);
  });

  it("installed: Abrir and Deshacer", async () => {
    const onPress = press();
    const onOpen = vi.fn();
    const host = paint(<ToolSuggestionCard card={card({ phase: "installed", installationId: "inst-1" })} capCredits={25} onPress={onPress} onOpen={onOpen} />);
    act(() => button(host, "toolCard.open").click());
    expect(onOpen).toHaveBeenCalledWith("inst-1");
    await act(async () => button(host, "toolCard.undo").click());
    expect(onPress).toHaveBeenCalledWith("undo", undefined);
  });

  it("removed: Restaurar; its version gone says to ask for a new proposal", async () => {
    const onPress = vi.fn(async () => ({ status: "refused" as const, reason: "source-missing" }));
    const host = paint(<ToolSuggestionCard card={card({ phase: "removed", installationId: "inst-1" })} capCredits={25} onPress={onPress} />);
    await act(async () => button(host, "toolCard.restore").click());
    expect(onPress).toHaveBeenCalledWith("restore", undefined);
    expect(host.textContent).toContain("toolCard.sourceMissing");
  });

  it("failed: the error and Reintentar", async () => {
    const onPress = press();
    const host = paint(<ToolSuggestionCard card={card({ phase: "failed", error: "TypeError: x is undefined" })} capCredits={25} onPress={onPress} />);
    expect(host.textContent).toContain("TypeError: x is undefined");
    await act(async () => button(host, "toolCard.retry").click());
    expect(onPress).toHaveBeenCalledWith("retry", undefined);
  });

  it("cancelled and interrupted: Reintentar", () => {
    for (const phase of ["cancelled", "interrupted"] as const) {
      const host = paint(<ToolSuggestionCard card={card({ phase })} capCredits={25} onPress={press()} />);
      expect(buttons(host)).toContain("toolCard.retry");
    }
  });

  it("needs_review: the findings, Instalar igual and Abrir proyecto", async () => {
    const onPress = press();
    const onOpenProject = vi.fn();
    const host = paint(
      <ToolSuggestionCard
        card={card({ phase: "needs_review", toolProjectId: "tool-1", review: { kind: "security_findings", fingerprint: "f1", findings: ["RLS off on notas"] } })}
        capCredits={25}
        onPress={onPress}
        onOpenProject={onOpenProject}
      />,
    );
    expect(host.textContent).toContain("RLS off on notas");
    await act(async () => button(host, "toolCard.installAnyway").click());
    expect(onPress).toHaveBeenCalledWith("install_anyway", undefined);
    act(() => button(host, "toolCard.openProject").click());
    expect(onOpenProject).toHaveBeenCalledWith("tool-1");
  });

  it("replaced: dimmed, no buttons; dismissed: one line", () => {
    const replaced = paint(<ToolSuggestionCard card={card({ phase: "replaced" })} capCredits={25} onPress={press()} />);
    expect(buttons(replaced)).toEqual([]);
    expect(replaced.querySelector("[data-tool-card]")!.className).toContain("opacity");
    const dismissed = paint(<ToolSuggestionCard card={card({ phase: "dismissed" })} capCredits={25} onPress={press()} />);
    expect(buttons(dismissed)).toEqual([]);
    expect(dismissed.textContent).toContain("toolCard.dismissed");
  });
});

describe("ToolSuggestionCards — under its turn", () => {
  it("the stream's tool_card shows the card before any fetch, only under its own row", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const host = paint(<ToolSuggestionCards projectId="p1" rowId="row-1" />);
    const other = paint(<ToolSuggestionCards projectId="p1" rowId="row-2" />);
    expect(host.querySelector("[data-tool-card]")).toBeNull();
    act(() => toolCardsLive.event("p1", card()));
    expect(host.querySelector("[data-tool-card]")).not.toBeNull();
    expect(other.querySelector("[data-tool-card]")).toBeNull();
  });

  it("Abrir opens the installed tool in the center, keeping the project", () => {
    act(() => toolCardsLive.event("p1", card({ phase: "installed", installationId: "inst-1" })));
    const host = paint(<ToolSuggestionCards projectId="p1" rowId="row-1" />);
    act(() => button(host, "toolCard.open").click());
    expect(nav.replace).toHaveBeenCalledWith("/es/new?project=p1&view=tool&tool=inst-1");
  });
});
