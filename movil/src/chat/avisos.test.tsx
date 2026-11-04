// An event task's cards in the phone's chat (spec local 2026-11-03-len-que-avisa, §8): the web's card and buttons,
// posting to the same route; a decided card says how it ended.
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
  createdAt: "2026-11-03T10:00:00.000Z",
  ...o,
});

function cliente(cards: TarjetaDeAviso[]) {
  let actuales = cards;
  const pedir = vi.fn(async (ruta: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const accion = JSON.parse(String(init.body)).action as string;
      actuales = actuales.map((c) => (c.id === "c1" ? { ...c, status: accion === "accept" ? "accepted" : "dismissed", acceptedRowId: accion === "accept" ? "row-9" : null } : c));
      return Response.json({ status: accion === "accept" ? "accepted" : "dismissed" }, { status: accion === "accept" ? 202 : 200 });
    }
    return Response.json({ cards: actuales });
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

  it("Ahora no posts dismiss and the card says Descartada", async () => {
    const c = cliente([tarjeta()]);
    const host = await pintar(c);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-aviso-ahora-no]")!.click());
    expect(JSON.parse(String(c.pedir.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body))).toEqual({ action: "dismiss" });
    expect(host.querySelector('[data-aviso="c1"]')!.textContent).toContain("eventTasks.dismissed");
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
