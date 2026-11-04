// An event task's cards in the phone's chat (spec local 2026-11-03-len-que-avisa, §8): the web's card and buttons,
// posting to the same route; a decided card says how it ended. Each action in its block, the button that says what it
// touches, and what came of each, with 44 px targets (spec local 2026-11-04-hazlo, §8).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("use-intl", () => ({ useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k) }));

import { AvisosDeLen, type TarjetaDeAviso } from "./avisos";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

const tarjeta = (o: Partial<TarjetaDeAviso> = {}): TarjetaDeAviso => ({
  id: "c1",
  taskId: "e1",
  taskTitle: "Reservas que chocan",
  title: "Dos reservas a la misma hora",
  summary: "Ana y Luis, mesa 4, viernes a las 21:00.",
  proposedAction: "Escribirle a Luis para moverla a las 22:00.",
  status: "pending",
  acceptedRowId: null,
  createdAt: new Date().toISOString(),
  actions: null,
  dismissNote: null,
  subjectKey: null,
  lookedAgain: null,
  ...o,
});

const cambio = { kind: "data_change" as const, table: "reservas", key: { id: "r7" }, set: { mesa: "6" }, before: { mesa: "4" } };
const mensaje = { kind: "reply" as const, channel: "email" as const, to: "luis@ejemplo.com", subject: "Tu reserva", body: "Hola Luis, te movimos a la mesa 6." };
const reg = <A,>(action: A, o: Record<string, unknown> = {}) => ({ action, state: "pending" as const, attempts: 0, nextAttemptAt: null, error: null, result: null, ...o }) as never;
const enviados = (c: ReturnType<typeof cliente>) => c.pedir.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(String(init!.body)));

function escribir(el: HTMLTextAreaElement, valor: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** With `respuesta`, a POST answers it (and the GET gives `despues` from then on); without, a simple accept/dismiss. */
function cliente(cards: TarjetaDeAviso[], o: { respuesta?: unknown; estado?: number; despues?: TarjetaDeAviso[] } = {}) {
  let actuales = cards;
  const pedir = vi.fn(async (ruta: string, init?: RequestInit) => {
    if (init?.method === "POST" && o.respuesta !== undefined) {
      if (o.despues) actuales = o.despues;
      return Response.json(o.respuesta, { status: o.estado ?? 200 });
    }
    if (init?.method === "POST") {
      const accion = JSON.parse(String(init.body)).action as string;
      actuales = actuales.map((c) => (c.id === "c1" ? { ...c, status: accion === "accept" ? "accepted" : "dismissed", acceptedRowId: accion === "accept" ? "row-9" : null } : c));
      return Response.json({ status: accion === "accept" ? "accepted" : "dismissed" }, { status: accion === "accept" ? 202 : 200 });
    }
    return Response.json({ cards: actuales, repliesTo: "dueno@lamesa.mx" });
  });
  return { pedir, avisarAlCerrar: () => {} };
}

async function pintar(c: ReturnType<typeof cliente>, resaltar: string | null = null) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  Element.prototype.scrollIntoView = vi.fn();
  await act(async () => root.render(<AvisosDeLen cliente={c as never} projectId="p1" abierto resaltar={resaltar} />));
  return host;
}

describe("AvisosDeLen", () => {
  it("a pending card posts accept and turns Hecho", async () => {
    const c = cliente([tarjeta()]);
    const host = await pintar(c);
    const card = host.querySelector('[data-aviso="c1"]')!;
    expect(card.textContent).toContain('eventTasks.cardFrom {"task":"Reservas que chocan"}');
    expect(card.textContent).toContain("Dos reservas a la misma hora");
    expect(card.querySelector("[data-aviso-propuesta]")!.textContent).toContain("Escribirle a Luis para moverla a las 22:00.");
    await act(async () => card.querySelector<HTMLButtonElement>("[data-aviso-hazlo]")!.click());
    const post = c.pedir.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/projects/p1/event-cards/c1");
    expect(JSON.parse(String(post[1]!.body))).toEqual({ action: "accept" });
    expect(host.querySelector("[data-aviso-hazlo]")).toBeNull();
    expect(host.querySelector('[data-aviso="c1"]')!.textContent).toContain("eventTasks.done");
  });

  it("Ahora no asks what you'd change; without a note it posts dismiss and the card says Descartada", async () => {
    const c = cliente([tarjeta()]);
    const host = await pintar(c);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-aviso-ahora-no]")!.click());
    expect(enviados(c)).toEqual([]);
    expect(host.querySelector<HTMLTextAreaElement>("[data-aviso-nota]")!.placeholder).toBe("eventTasks.whatWouldYouChange");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-aviso-descartar]")!.click());
    expect(enviados(c)).toEqual([{ action: "dismiss" }]);
    expect(host.querySelector('[data-aviso="c1"]')!.textContent).toContain("eventTasks.dismissed");
  });

  it("Ahora no with a note posts it", async () => {
    const c = cliente([tarjeta()]);
    const host = await pintar(c);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-aviso-ahora-no]")!.click());
    await act(async () => escribir(host.querySelector<HTMLTextAreaElement>("[data-aviso-nota]")!, " Ofrécele la 8. "));
    const descartar = host.querySelector<HTMLButtonElement>("[data-aviso-descartar]")!;
    expect(descartar.textContent).toBe("eventTasks.askAgain");
    // A 44 px target, like the other two.
    expect(descartar.closest(".ch-aviso-botones")).not.toBeNull();
    await act(async () => descartar.click());
    expect(enviados(c)).toEqual([{ action: "dismiss", note: "Ofrécele la 8." }]);
  });

  it("a card with a data_change shows before and after and the button says Aplicar", async () => {
    const host = await pintar(cliente([tarjeta({ actions: [reg(cambio)] })]));
    const bloque = host.querySelector('[data-aviso="c1"] [data-aviso-accion="data_change"]')!;
    expect(bloque.textContent).toContain('eventTasks.actionData {"table":"reservas"}');
    expect(bloque.querySelector('[data-aviso-columna="mesa"]')!.textContent).toMatch(/mesa.*4.*→.*6/);
    expect(host.querySelector("[data-aviso-hazlo]")!.textContent).toBe("eventTasks.apply");
    expect(host.querySelector("[data-aviso-propuesta]")).toBeNull();
  });

  it("a card with both says Aplicar y enviar and shows who the reply goes to", async () => {
    const host = await pintar(cliente([tarjeta({ actions: [reg(cambio), reg(mensaje)] })]));
    const bloque = host.querySelector('[data-aviso="c1"] [data-aviso-accion="reply"]')!;
    expect(bloque.textContent).toContain('eventTasks.actionReply {"to":"luis@ejemplo.com"}');
    expect(bloque.textContent).toContain("Tu reserva");
    expect(bloque.textContent).toContain("Hola Luis, te movimos a la mesa 6.");
    expect(bloque.textContent).toContain('eventTasks.repliesGoTo {"email":"dueno@lamesa.mx"}');
    expect(host.querySelector("[data-aviso-hazlo]")!.textContent).toBe("eventTasks.applyAndSend");
  });

  it("after Hazlo a blocked change shows La fila cambió and Volver a mirar", async () => {
    const bloqueada = tarjeta({ status: "accepted", actions: [reg(cambio, { state: "blocked", result: "mesa 5" }), reg(mensaje)] });
    const c = cliente([tarjeta({ actions: [reg(cambio), reg(mensaje)] })], { respuesta: { status: "accepted", results: [] }, estado: 202, despues: [bloqueada] });
    const host = await pintar(c);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-aviso-hazlo]")!.click());
    const card = host.querySelector('[data-aviso="c1"]')!;
    expect(card.textContent).toContain("eventTasks.rowChanged");
    expect(card.textContent).toContain('eventTasks.rowNow {"now":"mesa 5"}');
    const mirar = card.querySelector<HTMLButtonElement>("[data-aviso-mirar]")!;
    expect(mirar.closest(".ch-aviso-botones")).not.toBeNull();
    c.pedir.mockImplementation(async (_r: string, init?: RequestInit) => (init?.method === "POST" ? Response.json({ status: "looking_again" }) : Response.json({ cards: [bloqueada] })));
    await act(async () => mirar.click());
    expect(enviados(c).at(-1)).toEqual({ action: "look_again" });
    expect(host.querySelector('[data-aviso="c1"]')!.textContent).toContain("eventTasks.lookingAgain");
    expect(host.querySelector("[data-aviso-mirar]")).toBeNull();
  });

  it("a blocked card Len looked at again says what it found, and keeps no buttons (real turn, 04/11)", async () => {
    const host = await pintar(cliente([tarjeta({ status: "accepted", actions: [reg(cambio, { state: "blocked", result: "mesa 3" })], lookedAgain: "Ya no choca: nada que hacer." })]));
    const card = host.querySelector('[data-aviso="c1"]')!;
    expect(card.textContent).toContain('eventTasks.lookedAgain {"answer":"Ya no choca: nada que hacer."}');
    expect(card.querySelector("[data-aviso-mirar]")).toBeNull();
    expect(card.textContent).not.toContain("eventTasks.done");
    expect(card.textContent).toContain("eventTasks.notDone");
  });

  it("an action a cut-off press left behind says so, and a reply held back by its change says why (final review I1, I2)", async () => {
    const host = await pintar(cliente([
      tarjeta({ status: "accepted", actions: [reg(cambio, { state: "failed", error: "interrupted", result: "mesa 4" }), reg(mensaje, { state: "failed", error: "change_not_done" })] }),
      tarjeta({ id: "c2", status: "accepted", actions: [reg(mensaje, { state: "failed", error: "expired" })] }),
    ]));
    const card = host.querySelector('[data-aviso="c1"]')!;
    expect(card.textContent).toContain("eventTasks.interrupted");
    expect(card.textContent).toContain('eventTasks.rowNow {"now":"mesa 4"}');
    expect(card.textContent).toContain("eventTasks.notSentChange");
    expect(host.querySelector('[data-aviso="c2"]')!.textContent).toContain("eventTasks.sendExpired");
  });

  it("a sending reply shows its state and Retirar", async () => {
    const enviando = tarjeta({ status: "accepted", actions: [reg(cambio, { state: "done", result: "mesa 4 → 6" }), reg(mensaje, { state: "sending", attempts: 2 })] });
    const c = cliente([enviando], { respuesta: { status: "withdrawn" } });
    const host = await pintar(c);
    const card = host.querySelector('[data-aviso="c1"]')!;
    expect(card.textContent).toContain('eventTasks.sending {"attempts":2}');
    expect(card.textContent).toContain('eventTasks.doneApplied {"result":"mesa 4 → 6"}');
    const retirar = card.querySelector<HTMLButtonElement>("[data-aviso-retirar]")!;
    expect(retirar.closest(".ch-aviso-botones")).not.toBeNull();
    await act(async () => retirar.click());
    expect(enviados(c)).toEqual([{ action: "withdraw_send", index: 1 }]);
  });

  it("a refused decision says so", async () => {
    const c = cliente([tarjeta()]);
    c.pedir.mockImplementation(async (_ruta: string, init?: RequestInit) =>
      init?.method === "POST" ? Response.json({ error: "forbidden" }, { status: 403 }) : Response.json({ cards: [tarjeta()] }),
    );
    const host = await pintar(c);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-aviso-hazlo]")!.click());
    expect(host.querySelector('[data-aviso="c1"] [role="alert"]')!.textContent).toBe("eventTasks.failed");
  });

  it("a push's card is brought into view and marked", async () => {
    const host = await pintar(cliente([tarjeta(), tarjeta({ id: "c2", status: "replaced" })]), "c1");
    const card = host.querySelector<HTMLElement>('[data-aviso="c1"]')!;
    expect(card.classList.contains("is-resaltado")).toBe(true);
    expect(card.scrollIntoView).toHaveBeenCalled();
  });

  it("without cards there is nothing", async () => {
    const host = await pintar(cliente([]));
    expect(host.innerHTML).toBe("");
  });
});
