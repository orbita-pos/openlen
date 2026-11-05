// THE «CREAR» CARDS ON THE PHONE (spec local 2026-11-04-herramientas-hechas-por-len, §4.10, §4.14): Len's proposals of
// a tool in this project's chat, pressable from the phone, over the conversation like the event cards. Each phase with
// the web's buttons and words; a press goes to the same route; the reading speeds up while one is being made.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("use-intl", () => ({ useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k) }));

import { TarjetasDeHerramientas } from "./tool-cards";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const card = (phase: string, o: Record<string, unknown> = {}) => ({
  id: "c1",
  chatRowId: "row-1",
  title: "Reservas de hoy",
  brief: "Ver y confirmar las reservas de hoy.",
  initialContent: null,
  placement: "project",
  customLocation: null,
  phase,
  toolProjectId: "t1",
  installationId: phase === "installed" ? "i1" : null,
  error: null,
  review: null,
  ...o,
});

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => localStorage.clear());
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  vi.useRealTimers();
});

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

async function paint(cards: unknown[] | Response, o: { press?: (body: Record<string, unknown>) => Response; onAbrirHerramienta?: (id: string) => void; onAbrirProyecto?: (id: string) => void; onHerramientasCambiaron?: () => void } = {}) {
  const bodies: Record<string, unknown>[] = [];
  let current = cards;
  const pedir = vi.fn(async (ruta: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      return o.press ? o.press(body) : Response.json({ status: "accepted" }, { status: 202 });
    }
    return current instanceof Response ? current.clone() : Response.json({ cards: current, capCredits: 25 });
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <TarjetasDeHerramientas
        cliente={{ pedir, avisarAlCerrar: vi.fn() }}
        projectId="p1"
        abierto
        idioma="es"
        onAbrirHerramienta={o.onAbrirHerramienta ?? vi.fn()}
        onAbrirProyecto={o.onAbrirProyecto ?? vi.fn()}
        onHerramientasCambiaron={o.onHerramientasCambiaron ?? vi.fn()}
      />,
    );
    await flush();
  });
  const buttons = () => [...host.querySelectorAll<HTMLButtonElement>("button")].map((b) => b.textContent);
  const press = async (text: string) =>
    act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!.click();
      await flush();
    });
  return { pedir, bodies, buttons, press, setCards: (c: unknown[]) => (current = c) };
}

describe("TarjetasDeHerramientas", () => {
  it("reads this project's cards", async () => {
    const s = await paint([card("proposed")]);
    expect(s.pedir).toHaveBeenCalledWith("/api/tool-cards?projectId=p1");
    expect(host.textContent).toContain("Reservas de hoy");
  });

  it("proposed: the place, the cost notice and «Crear», which sends the chosen place in the person's language", async () => {
    const s = await paint([card("proposed")]);
    expect(host.querySelector("select")?.value).toBe("project");
    expect(host.textContent).toContain('toolCard.notice {"cap":25}');
    await s.press("toolCard.create");
    expect(s.pedir).toHaveBeenCalledWith("/api/tool-cards/c1", expect.objectContaining({ method: "POST" }));
    expect(s.bodies[0]).toMatchObject({ verb: "create", payload: { placement: "project" }, locale: "es" });
    expect(typeof s.bodies[0]!.timeZone).toBe("string");
  });

  it("«Escribe dónde»: empty can't be sent; with words, they are the place", async () => {
    const s = await paint([card("proposed")]);
    await act(async () => {
      const select = host.querySelector("select")!;
      select.value = "custom";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const crear = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "toolCard.create")!;
    expect(crear().disabled).toBe(true);
    await act(async () => {
      const area = host.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, "junto al chat");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await s.press("toolCard.create");
    expect(s.bodies[0]).toMatchObject({ verb: "create", payload: { customLocation: "junto al chat" } });
  });

  it("«Ahora no» dismisses", async () => {
    const s = await paint([card("proposed")]);
    await s.press("toolCard.notNow");
    expect(s.bodies[0]).toMatchObject({ verb: "dismiss" });
  });

  it("each phase has the web's buttons", async () => {
    const phases: Record<string, string[]> = {
      creating: ["toolCard.cancel"],
      installing: [],
      installed: ["toolCard.open", "toolCard.undo"],
      removed: ["toolCard.restore"],
      failed: ["toolCard.retry"],
      cancelled: ["toolCard.retry"],
      interrupted: ["toolCard.retry"],
      replaced: [],
    };
    for (const [phase, expected] of Object.entries(phases)) {
      const s = await paint([card(phase)]);
      expect([phase, s.buttons().filter((b) => b?.startsWith("toolCard."))]).toEqual([phase, expected]);
      act(() => root!.unmount());
      root = null;
      host.remove();
    }
  });

  it("needs review: the findings, «Instalar igual» and «Abrir proyecto»", async () => {
    const onAbrirProyecto = vi.fn();
    const s = await paint([card("needs_review", { review: { kind: "security_findings", fingerprint: "fp", findings: ["Una tabla sin RLS"] } })], { onAbrirProyecto });
    expect(host.textContent).toContain("toolCard.needsReview");
    expect(host.textContent).toContain("Una tabla sin RLS");
    await s.press("toolCard.openProject");
    expect(onAbrirProyecto).toHaveBeenCalledWith("t1");
    await s.press("toolCard.installAnyway");
    expect(s.bodies[0]).toMatchObject({ verb: "install_anyway" });
  });

  it("dismissed: one line, no buttons", async () => {
    const s = await paint([card("dismissed")]);
    expect(host.textContent).toContain("toolCard.dismissed");
    expect(s.buttons()).toEqual([]);
  });

  it("installed: «Abrir» opens the tool", async () => {
    const onAbrirHerramienta = vi.fn();
    const s = await paint([card("installed")], { onAbrirHerramienta });
    await s.press("toolCard.open");
    expect(onAbrirHerramienta).toHaveBeenCalledWith("i1");
  });

  it("a card that becomes installed tells the app its tools changed", async () => {
    vi.useFakeTimers();
    const onHerramientasCambiaron = vi.fn();
    const s = await paint([card("installing")], { onHerramientasCambiaron });
    s.setCards([card("installed")]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(onHerramientasCambiaron).toHaveBeenCalled();
  });

  it("the reading speeds up while one is being made: every 5 s, else every 60 s", async () => {
    vi.useFakeTimers();
    const working = await paint([card("creating")]);
    const before = working.pedir.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(working.pedir.mock.calls.length).toBeGreaterThan(before);
    act(() => root!.unmount());
    root = null;
    host.remove();

    const idle = await paint([card("proposed")]);
    const at = idle.pedir.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(idle.pedir.mock.calls.length).toBe(at);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(idle.pedir.mock.calls.length).toBeGreaterThan(at);
  });

  it("the cost notice, once closed, stays closed; «i» opens it again", async () => {
    await paint([card("proposed")]);
    await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='toolCard.closeNotice']")!.click());
    expect(host.textContent).not.toContain("toolCard.notice");
    act(() => root!.unmount());
    root = null;
    host.remove();
    await paint([card("proposed")]);
    expect(host.textContent).not.toContain("toolCard.notice");
    await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='toolCard.showNotice']")!.click());
    expect(host.textContent).toContain("toolCard.notice");
  });

  it("a press refused for the plan says so; refused otherwise, its reason, and the cards are read again", async () => {
    const plan = await paint([card("proposed")], { press: () => Response.json({ status: "refused", reason: "plan_required" }, { status: 402 }) });
    await plan.press("toolCard.create");
    expect(host.textContent).toContain("toolCard.planRequired");
    act(() => root!.unmount());
    root = null;
    host.remove();

    const other = await paint([card("proposed")], { press: () => Response.json({ status: "refused", reason: "busy" }, { status: 409 }) });
    const reads = other.pedir.mock.calls.filter((c) => !c[1]).length;
    await other.press("toolCard.create");
    expect(host.textContent).toContain('toolCard.refused {"reason":"busy"}');
    expect(other.pedir.mock.calls.filter((c) => !c[1]).length).toBeGreaterThan(reads);
  });

  it("the cards switched off on the server: nothing", async () => {
    await paint(Response.json({ error: "tools_off" }, { status: 404 }));
    expect(host.innerHTML).toBe("");
  });
});
