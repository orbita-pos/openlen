// Len Watch in Len mobile's Gestión (spec local 2026-10-30-len-watch, §5.7): where the fix stands, its
// button, and the three switches — with the texts as keys (use-intl mocked) and the client faked.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { LenWatch } from "./len-watch";
vi.mock("use-intl", () => ({ useTranslations: () => (s: string) => s }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let host: HTMLDivElement;
afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); });

const SETTINGS = { autoFix: false, autoPublish: false, muted: false, locale: null };
const READY = { id: "i1", status: "fix_ready", reason: null, summary: "Arreglado.", shipsUnpublished: true, createdAt: "2026-10-30T12:00:00.000Z" };

function cliente(o: { incident?: unknown; isOwner?: boolean; approve?: { status: number; body: unknown } } = {}) {
  const llamadas: { ruta: string; metodo: string; cuerpo?: unknown }[] = [];
  const c: ClienteDeOpenLen = {
    avisarAlCerrar: vi.fn(),
    pedir: async (ruta, init) => {
      const metodo = init?.method ?? "GET";
      llamadas.push({ ruta, metodo, ...(init?.body ? { cuerpo: JSON.parse(String(init.body)) } : {}) });
      if (metodo === "GET") return Response.json({ enabled: true, isOwner: o.isOwner ?? true, settings: SETTINGS, incident: o.incident ?? null });
      if (metodo === "PUT") return Response.json({ settings: { ...SETTINGS, ...JSON.parse(String(init!.body)) } });
      if (ruta.endsWith("/approve")) return Response.json(o.approve?.body ?? {}, { status: o.approve?.status ?? 200 });
      return Response.json({ status: "fixing" }, { status: 202 });
    },
  };
  return { c, llamadas };
}

async function montar(c: ClienteDeOpenLen) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<LenWatch cliente={c} projectId="p" idioma="es" />));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
}
const boton = (nombre: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === nombre);

// Incidente real del 31/10: el POST contesta al momento y «Arreglar con Len» se podía volver a pulsar mientras la
// tarjeta aún miraba en qué estaba el arreglo.
it("🔴 tras «Arreglar con Len», el botón sigue apagado hasta que la tarjeta ha vuelto a mirar", async () => {
  const CAIDA = { ...READY, status: "open", summary: null, shipsUnpublished: false };
  let soltar!: () => void;
  const retenida = new Promise<void>((r) => (soltar = r));
  let lecturas = 0;
  const c: ClienteDeOpenLen = {
    avisarAlCerrar: vi.fn(),
    pedir: async (_ruta, init) => {
      if ((init?.method ?? "GET") !== "GET") return Response.json({ status: "fixing" }, { status: 202 });
      lecturas++;
      if (lecturas > 1) await retenida;
      return Response.json({ enabled: true, isOwner: true, settings: SETTINGS, incident: lecturas > 1 ? { ...CAIDA, status: "fixing" } : CAIDA });
    },
  };
  await montar(c);
  await act(async () => boton("fix")!.click());
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  expect(boton("fix")?.disabled).toBe(true);
  await act(async () => {
    soltar();
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(boton("fix")).toBeUndefined();
});

it("un arreglo listo: dice qué saldría, y un 428 manda a revisar", async () => {
  const { c, llamadas } = cliente({ incident: READY, approve: { status: 428, body: { error: "security_findings" } } });
  await montar(c);
  expect(host.textContent).toContain("ready");
  expect(host.textContent).toContain("shipsUnpublished");
  await act(async () => boton("approve")!.click());
  expect(llamadas.some((l) => l.metodo === "POST" && l.ruta === "/api/projects/p/len-watch/approve")).toBe(true);
  expect(host.textContent).toContain("review");
});

// Spec §5.5: Len's fix on its branch. «Publicar» publishes the DRAFT, so a gate on the branch is answered here.
it("🔴 el arreglo en su rama y la revisión encontró algo: lo dice aquí y «Publicar igual» aprueba con la huella", async () => {
  const fp = "a".repeat(64);
  const { c, llamadas } = cliente({ incident: READY, approve: { status: 428, body: { error: "security_findings", fingerprint: fp, blocking: [{ description: "Cualquiera puede leer las reservas" }], branch: true } } });
  await montar(c);
  await act(async () => boton("approve")!.click());
  expect(host.textContent).not.toContain("review");
  expect(host.textContent).toContain("findings");
  expect(host.textContent).toContain("Cualquiera puede leer las reservas");
  await act(async () => boton("publishAnyway")!.click());
  expect(llamadas.filter((l) => l.ruta.endsWith("/approve")).map((l) => l.cuerpo)).toEqual([{}, { acceptSecurityFingerprint: fp }]);
});

it("🔴 faltan secretos en producción: lo dice, y no manda a «Publicar»", async () => {
  const { c } = cliente({ incident: READY, approve: { status: 428, body: { error: "secrets_required", missing: ["STRIPE_SECRET_KEY"], branch: true } } });
  await montar(c);
  await act(async () => boton("approve")!.click());
  expect(host.textContent).not.toContain("review");
  expect(host.textContent).toContain("secretsMissing");
});

it("la revisión sigue en marcha tras esperar: que pruebes en un momento", async () => {
  const { c } = cliente({ incident: READY, approve: { status: 428, body: { error: "security_review_pending", branch: true } } });
  await montar(c);
  await act(async () => boton("approve")!.click());
  expect(host.textContent).toContain("reviewRunning");
});

it("otra puerta en la rama tampoco manda a «Publicar»: dice que no se pudo", async () => {
  const { c } = cliente({ incident: READY, approve: { status: 428, body: { error: "something_new", branch: true } } });
  await montar(c);
  await act(async () => boton("approve")!.click());
  expect(host.textContent).not.toContain("review");
  expect(host.textContent).toContain("failed");
});

it("el borrador cambió tras el arreglo: lo dice y «Publicar igual» lo confirma", async () => {
  const { c, llamadas } = cliente({ incident: READY, approve: { status: 409, body: { error: "changed_since_fix" } } });
  await montar(c);
  await act(async () => boton("approve")!.click());
  expect(host.textContent).toContain("changed");
  await act(async () => boton("publishAnyway")!.click());
  expect(llamadas.filter((l) => l.ruta.endsWith("/approve")).map((l) => l.cuerpo)).toEqual([{}, { confirmChanged: true }]);
});

it("🔴 el arreglo (cambia tablas) ya está en el borrador y el sitio sigue caído: dice que publiques, no «Arreglar con Len»", async () => {
  const { c } = cliente({ incident: { ...READY, status: "needs_owner", reason: "needs_tables", shipsUnpublished: false, fixBrought: true } });
  await montar(c);
  expect(host.textContent).toContain("publishBrought");
  expect(boton("fix")).toBeUndefined();
});

it("caído y sin nadie: «Arreglar con Len» pide el arreglo", async () => {
  const { c, llamadas } = cliente({ incident: { ...READY, status: "open", shipsUnpublished: false } });
  await montar(c);
  await act(async () => boton("fix")!.click());
  expect(llamadas.some((l) => l.metodo === "POST" && l.ruta === "/api/projects/p/len-watch/fix")).toBe(true);
});

it("publicar solo espera a arreglar solo; el cambio lleva el idioma", async () => {
  const { c, llamadas } = cliente();
  await montar(c);
  const cajas = () => [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  expect(cajas().map((b) => [b.checked, b.disabled])).toEqual([[true, false], [false, false], [false, true]]);
  await act(async () => cajas()[1]!.click());
  expect(llamadas.find((l) => l.metodo === "PUT")?.cuerpo).toEqual({ autoFix: true, locale: "es" });
  expect(cajas()[2]!.disabled).toBe(false);
});

it("quien no es el dueño no puede tocarlos", async () => {
  const { c } = cliente({ isOwner: false });
  await montar(c);
  expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((b) => b.disabled)).toBe(true);
  expect(host.textContent).toContain("ownerOnly");
});

// Spec §5.5: Len published a fix from its branch; the draft doesn't have it until the owner brings it in.
it("un arreglo por traer: «Traer el arreglo» lo pide, y si choca dice que lo trae Len", async () => {
  const llamadas: { ruta: string; metodo: string; cuerpo?: unknown }[] = [];
  const c: ClienteDeOpenLen = {
    avisarAlCerrar: vi.fn(),
    pedir: async (ruta, init) => {
      const metodo = init?.method ?? "GET";
      llamadas.push({ ruta, metodo, ...(init?.body ? { cuerpo: JSON.parse(String(init.body)) } : {}) });
      if (metodo === "GET") return Response.json({ enabled: true, isOwner: true, settings: SETTINGS, incident: null, pendingFix: { incidentId: "i1", branch: "len-watch/i1" } });
      return Response.json({ status: "handed_to_len" });
    },
  };
  await montar(c);
  expect(host.textContent).toContain("bringTitle");
  await act(async () => boton("bring")!.click());
  expect(llamadas.find((l) => l.metodo === "POST")).toEqual({ ruta: "/api/projects/p/len-watch/bring", metodo: "POST", cuerpo: { incidentId: "i1" } });
  expect(host.textContent).toContain("handedToLen");
});
