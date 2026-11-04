// THE EVENT-TASK CARDS OVER THE COMPOSER (spec local 2026-11-03-len-que-avisa, §7.6, §8): pending ones with
// «Hazlo» and «Ahora no»; decided ones folded under «Avisos anteriores»; a reader sees no buttons. Each action in its
// block, the button that says what it touches, and what came of each (spec local 2026-11-04-hazlo, §7.3, §8).
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
let served = false;
beforeEach(() => {
  search.card = null;
  served = false;
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
  actions: null,
  dismissNote: null,
  subjectKey: null,
  lookedAgain: null,
  ...over,
});

const change = { kind: "data_change" as const, table: "reservas", key: { id: "r7" }, set: { mesa: "6" }, before: { mesa: "4" } };
const reply = { kind: "reply" as const, channel: "email" as const, to: "luis@ejemplo.com", subject: "Tu reserva", body: "Hola Luis, te movimos a la mesa 6." };
const rec = <A,>(action: A, over: Record<string, unknown> = {}) => ({ action, state: "pending" as const, attempts: 0, nextAttemptAt: null, error: null, result: null, ...over }) as never;

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST").map(([url, init]) => ({ url, body: JSON.parse(String((init as RequestInit).body)) }));

/** Answers the GET with these cards; a POST with `answer`, after which the GET gives `after`. */
function serve(cards: EventCard[], o: { answer?: unknown; status?: number; after?: EventCard[] } = {}) {
  let current = cards;
  served = true;
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method !== "POST") return json({ cards: current, repliesTo: "dueno@lamesa.mx" });
    if (o.after) current = o.after;
    return json(o.answer ?? { status: "accepted", results: [] }, o.status ?? 200);
  });
}

function type(el: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function paint(cards: EventCard[], o: { soloLectura?: boolean; onFollowTurn?: ReturnType<typeof vi.fn> } = {}) {
  if (!served) serve(cards);
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

  it("Ahora no asks what you'd change, and without a note posts a plain dismiss", async () => {
    const { host } = await paint([card()]);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-event-dismiss]")!.click());
    expect(posts()).toEqual([]);
    expect(host.querySelector<HTMLTextAreaElement>("[data-event-note]")!.placeholder).toBe("eventTasks.whatWouldYouChange");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-event-dismiss-confirm]")!.click());
    expect(posts().map((p) => p.body)).toEqual([{ action: "dismiss" }]);
  });

  it("Ahora no with a note posts it", async () => {
    const { host } = await paint([card()]);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-event-dismiss]")!.click());
    await act(async () => type(host.querySelector<HTMLTextAreaElement>("[data-event-note]")!, "  Ofrécele la 8, la 6 es de fumadores. "));
    const confirm = host.querySelector<HTMLButtonElement>("[data-event-dismiss-confirm]")!;
    expect(confirm.textContent).toBe("eventTasks.askAgain");
    await act(async () => confirm.click());
    expect(posts()).toEqual([{ url: "/api/projects/p1/event-cards/c1", body: { action: "dismiss", note: "Ofrécele la 8, la 6 es de fumadores." } }]);
  });

  it("a card with a data_change shows before and after and the button says Aplicar", async () => {
    const { host } = await paint([card({ actions: [rec(change)] })]);
    const block = host.querySelector('[data-event-card="c1"] [data-event-action="data_change"]')!;
    expect(block.textContent).toContain('eventTasks.actionData {"table":"reservas"}');
    expect(block.querySelector('[data-event-column="mesa"]')!.textContent).toMatch(/mesa.*4.*→.*6/);
    expect(host.querySelector("[data-event-accept]")!.textContent).toBe("eventTasks.apply");
    // No old one-line proposal under the blocks.
    expect(host.querySelector("[data-event-proposed]")).toBeNull();
  });

  it("a card with both says Aplicar y enviar and shows who the reply goes to", async () => {
    const { host } = await paint([card({ actions: [rec(change), rec(reply)] })]);
    const block = host.querySelector('[data-event-card="c1"] [data-event-action="reply"]')!;
    expect(block.textContent).toContain('eventTasks.actionReply {"to":"luis@ejemplo.com"}');
    expect(block.textContent).toContain("Tu reserva");
    expect(block.textContent).toContain("Hola Luis, te movimos a la mesa 6.");
    expect(block.textContent).toContain('eventTasks.repliesGoTo {"email":"dueno@lamesa.mx"}');
    expect(host.querySelector("[data-event-accept]")!.textContent).toBe("eventTasks.applyAndSend");
  });

  it("a project action shows its text under Len propone, and the button stays Hazlo", async () => {
    const { host } = await paint([card({ actions: [rec({ kind: "project", text: "Prepararte la pantalla de reservas por mesa." })] })]);
    expect(host.querySelector('[data-event-action="project"]')!.textContent).toContain("Prepararte la pantalla de reservas por mesa.");
    expect(host.querySelector("[data-event-accept]")!.textContent).toBe("eventTasks.accept");
  });

  it("after Hazlo a blocked change shows La fila cambió and Volver a mirar", async () => {
    const blocked = card({ status: "accepted", actions: [rec(change, { state: "blocked", result: "mesa 5", error: "The row changed since the card was made." }), rec(reply)] });
    serve([card({ actions: [rec(change), rec(reply)] })], { answer: { status: "accepted", results: [{ kind: "data_change", state: "blocked", error: "x" }, { kind: "reply", state: "pending", error: null }] }, status: 202, after: [blocked] });
    const { host } = await paint([]);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-event-accept]")!.click());
    // It stays in sight: it needs the owner.
    const box = host.querySelector('[data-event-card="c1"]')!;
    expect(box.closest("details")).toBeNull();
    expect(box.textContent).toContain("eventTasks.rowChanged");
    expect(box.textContent).toContain('eventTasks.rowNow {"now":"mesa 5"}');
    serve([blocked], { answer: { status: "looking_again" } });
    await act(async () => box.querySelector<HTMLButtonElement>("[data-event-look-again]")!.click());
    expect(posts().at(-1)!.body).toEqual({ action: "look_again" });
    expect(host.querySelector('[data-event-card="c1"]')!.textContent).toContain("eventTasks.lookingAgain");
    expect(host.querySelector("[data-event-look-again]")).toBeNull();
  });

  it("Volver a mirar past the day's limit says so", async () => {
    const blocked = card({ status: "accepted", actions: [rec(change, { state: "blocked", result: "mesa 5" })] });
    serve([blocked], { answer: { error: "daily_limit" }, status: 429 });
    const { host } = await paint([]);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-event-look-again]")!.click());
    expect(host.querySelector('[data-event-card="c1"] [role="alert"]')!.textContent).toBe("eventTasks.dailyLimit");
  });

  it("a blocked card folds once a newer card about the same row has come", async () => {
    const blocked = card({ status: "accepted", subjectKey: "r7", actions: [rec(change, { state: "blocked", result: "mesa 5" })], createdAt: "2026-11-03T10:00:00.000Z" });
    const newer = card({ id: "c2", subjectKey: "r7", actions: [rec(change)], createdAt: "2026-11-03T10:05:00.000Z" });
    const { host } = await paint([newer, blocked]);
    expect(host.querySelector('[data-event-card="c1"]')!.closest("details")).not.toBeNull();
  });

  it("a blocked card Len looked at again says what it found, and folds (real turn, 04/11)", async () => {
    const { host } = await paint([card({ status: "accepted", actions: [rec(change, { state: "blocked", result: "mesa 3" })], lookedAgain: "Ya no choca con ninguna: no hay nada que hacer." })]);
    const box = host.querySelector('[data-event-card="c1"]')!;
    expect(box.closest("details")).not.toBeNull();
    expect(box.textContent).toContain('eventTasks.lookedAgain {"answer":"Ya no choca con ninguna: no hay nada que hacer."}');
    expect(host.querySelector("[data-event-look-again]")).toBeNull();
    // Nothing was applied: the card doesn't say «Hecho» (real turn, 04/11).
    expect(box.textContent).not.toContain("eventTasks.done");
    expect(box.textContent).toContain("eventTasks.notDone");
  });

  it("an action a cut-off press left behind says so, and a reply held back by its change says why (final review I1, I2)", async () => {
    const { host } = await paint([
      card({ status: "accepted", actions: [rec(change, { state: "failed", error: "interrupted", result: "mesa 4" }), rec(reply, { state: "failed", error: "change_not_done" })] }),
      card({ id: "c2", status: "accepted", actions: [rec(reply, { state: "failed", error: "expired" })] }),
    ]);
    const box = host.querySelector('[data-event-card="c1"]')!;
    expect(box.textContent).toContain("eventTasks.interrupted");
    expect(box.textContent).toContain('eventTasks.rowNow {"now":"mesa 4"}');
    expect(box.textContent).toContain("eventTasks.notSentChange");
    expect(host.querySelector('[data-event-card="c2"]')!.textContent).toContain("eventTasks.sendExpired");
  });

  it("a sending reply shows its state and Retirar", async () => {
    const sending = card({ status: "accepted", actions: [rec(change, { state: "done", result: "mesa 4 → 6" }), rec(reply, { state: "sending", attempts: 2, error: "Resend is down" })] });
    serve([sending], { answer: { status: "withdrawn" } });
    const { host } = await paint([]);
    const box = host.querySelector('[data-event-card="c1"]')!;
    expect(box.closest("details")).toBeNull();
    expect(box.textContent).toContain('eventTasks.sending {"attempts":2}');
    expect(box.textContent).toContain('eventTasks.doneApplied {"result":"mesa 4 → 6"}');
    await act(async () => box.querySelector<HTMLButtonElement>("[data-event-withdraw]")!.click());
    expect(posts()).toEqual([{ url: "/api/projects/p1/event-cards/c1", body: { action: "withdraw_send", index: 1 } }]);
  });

  it("a decided card in the fold says what each action did, and the note it was dismissed with", async () => {
    const { host } = await paint([
      card({ id: "c3", status: "accepted", actions: [rec(change, { state: "done", result: "mesa 4 → 6" }), rec(reply, { state: "done", result: "luis@ejemplo.com" })] }),
      card({ id: "c4", status: "accepted", actions: [rec(reply, { state: "failed", error: "Invalid `to` field." })] }),
      card({ id: "c5", status: "dismissed", dismissNote: "Ofrécele la 8." }),
      card({ id: "c6", status: "accepted", actions: [rec(reply, { state: "failed", error: "retirado por el dueño" })] }),
    ]);
    const earlier = host.querySelector("details[data-event-earlier]")!;
    expect(earlier.querySelector('[data-event-card="c3"]')!.textContent).toContain('eventTasks.doneApplied {"result":"mesa 4 → 6"}');
    expect(earlier.querySelector('[data-event-card="c3"]')!.textContent).toContain('eventTasks.doneSent {"to":"luis@ejemplo.com"}');
    expect(earlier.querySelector('[data-event-card="c4"]')!.textContent).toContain('eventTasks.sendFailed {"error":"Invalid `to` field."}');
    expect(earlier.querySelector('[data-event-card="c6"]')!.textContent).toContain("eventTasks.withdrawn");
    expect(earlier.querySelector('[data-event-card="c5"]')!.textContent).toContain('eventTasks.yourNote {"note":"Ofrécele la 8."}');
  });

  it("a refused decision says so on the card", async () => {
    serve([card()], { answer: { error: "not_pending" }, status: 409 });
    const { host } = await paint([card()]);
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

  it("a chat reply shows who and where, with no subject", async () => {
    const chat = { kind: "reply" as const, channel: "chat" as const, to: "conv1", toLabel: "Ana", body: "Hola Ana, ¿para cuántos sería?" };
    const { host } = await paint([card({ actions: [rec(chat)] })]);
    const block = host.querySelector('[data-event-card="c1"] [data-event-action="reply"]')!;
    expect(block.textContent).toContain('eventTasks.actionReplyChat {"to":"Ana"}');
    expect(block.querySelector("b")).toBeNull();
    expect(block.textContent).toContain("Hola Ana, ¿para cuántos sería?");
    expect(block.textContent).not.toContain("eventTasks.repliesGoTo");
  });
});
