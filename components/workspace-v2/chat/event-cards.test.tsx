// THE EVENT-TASK CARDS OVER THE COMPOSER (spec local 2026-11-03-len-que-avisa, §7.6, §8): pending ones with
// «Hazlo» and «Ahora no»; decided ones folded under «Avisos anteriores»; a reader sees no buttons.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
}));
const search = vi.hoisted(() => ({ card: null as string | null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => ({ get: (k: string) => (k === "card" ? search.card : null) }) }));

import { EventCards, type EventCard } from "./event-cards";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
const fetchMock = vi.fn();
beforeEach(() => {
  search.card = null;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const card = (over: Partial<EventCard> = {}): EventCard => ({
  id: "c1",
  taskId: "e1",
  taskTitle: "Reservas que chocan",
  title: "Dos reservas a la misma hora",
  summary: "Ana y Luis reservaron la mesa 4 el viernes a las 9.",
  proposedAction: "Escribirle a Luis para moverla a las 10.",
  status: "pending",
  acceptedRowId: null,
  createdAt: "2026-11-03T10:00:00.000Z",
  ...over,
});

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

async function paint(cards: EventCard[], o: { soloLectura?: boolean; onFollowTurn?: ReturnType<typeof vi.fn> } = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (init?.method === "POST" ? json({ status: "accepted" }) : json({ cards })));
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const onFollowTurn = o.onFollowTurn ?? vi.fn();
  await act(async () => root.render(<EventCards projectId="p1" soloLectura={o.soloLectura ?? false} busy={false} onFollowTurn={onFollowTurn} />));
  return { host, onFollowTurn };
}

describe("EventCards", () => {
  it("a pending card shows its two buttons and pressing Hazlo posts accept", async () => {
    const onFollowTurn = vi.fn();
    const { host } = await paint([card()], { onFollowTurn });
    const box = host.querySelector('[data-event-card="c1"]')!;
    expect(box.textContent).toContain('eventTasks.cardFrom {"task":"Reservas que chocan"}');
    expect(box.textContent).toContain("Dos reservas a la misma hora");
    expect(box.querySelector("[data-event-proposed]")!.textContent).toContain("Escribirle a Luis para moverla a las 10.");
    expect(box.querySelector("[data-event-dismiss]")).not.toBeNull();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json({ status: "accepted", rowId: "row-9", text: "🔔 Reservas que chocan: Hazlo", origin: { kind: "event_task", taskId: "e1", cardId: "c1", title: "Reservas que chocan" } }, 202)
        : json({ cards: [card({ status: "accepted", acceptedRowId: "row-9" })] }),
    );
    await act(async () => box.querySelector<HTMLButtonElement>("[data-event-accept]")!.click());
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(post[0]).toBe("/api/projects/p1/event-cards/c1");
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ action: "accept" });
    expect(onFollowTurn).toHaveBeenCalledWith({ filaId: "row-9", texto: "🔔 Reservas que chocan: Hazlo", origen: { kind: "event_task", taskId: "e1", cardId: "c1", title: "Reservas que chocan" } });
  });

  it("Ahora no posts dismiss", async () => {
    const { host } = await paint([card()]);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-event-dismiss]")!.click());
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ action: "dismiss" });
  });

  it("a refused decision says so on the card", async () => {
    const { host } = await paint([card()]);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (init?.method === "POST" ? json({ error: "not_pending" }, 409) : json({ cards: [card()] })));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-event-accept]")!.click());
    expect(host.querySelector('[data-event-card="c1"] [role="alert"]')!.textContent).toBe("eventTasks.failed");
  });

  it("a reader sees no buttons", async () => {
    const { host } = await paint([card()], { soloLectura: true });
    expect(host.querySelector('[data-event-card="c1"]')).not.toBeNull();
    expect(host.querySelector("[data-event-accept]")).toBeNull();
    expect(host.querySelector("[data-event-dismiss]")).toBeNull();
  });

  it("decided cards fold under Avisos anteriores with their state", async () => {
    const { host } = await paint([
      card({ id: "c3", status: "accepted", acceptedRowId: "row-3" }),
      card({ id: "c4", status: "dismissed" }),
      card({ id: "c5", status: "replaced" }),
    ]);
    expect(host.querySelector("[data-event-accept]")).toBeNull();
    const earlier = host.querySelector<HTMLDetailsElement>("details[data-event-earlier]")!;
    expect(earlier.open).toBe(false);
    expect(earlier.querySelector("summary")!.textContent).toContain("eventTasks.earlier");
    expect(earlier.querySelector('[data-event-card="c3"] [data-event-done]')!.textContent).toBe("eventTasks.done");
    expect(earlier.querySelector('[data-event-card="c4"]')!.textContent).toContain("eventTasks.dismissed");
    expect(earlier.querySelector('[data-event-card="c5"]')!.textContent).toContain("eventTasks.replaced");
  });

  it("Hecho goes to the accepted turn's row", async () => {
    const row = document.createElement("div");
    row.setAttribute("data-chat-row", "row-3");
    document.body.appendChild(row);
    const { host } = await paint([card({ id: "c3", status: "accepted", acceptedRowId: "row-3" })]);
    act(() => host.querySelector<HTMLButtonElement>("[data-event-done]")!.click());
    expect(row.scrollIntoView).toHaveBeenCalled();
  });

  it("?card= scrolls to the card and highlights it, opening the fold when it was decided", async () => {
    search.card = "c4";
    const { host } = await paint([card(), card({ id: "c4", status: "dismissed" })]);
    const target = host.querySelector<HTMLElement>('[data-event-card="c4"]')!;
    expect(target.getAttribute("data-highlight")).toBe("true");
    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(host.querySelector<HTMLDetailsElement>("details[data-event-earlier]")!.open).toBe(true);
  });

  it("without cards there is nothing", async () => {
    const { host } = await paint([]);
    expect(host.innerHTML).toBe("");
  });
});
