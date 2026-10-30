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

it("un arreglo listo: dice qué saldría, y un 428 manda a revisar", async () => {
  const { c, llamadas } = cliente({ incident: READY, approve: { status: 428, body: { error: "security_findings" } } });
  await montar(c);
  expect(host.textContent).toContain("ready");
  expect(host.textContent).toContain("shipsUnpublished");
  await act(async () => boton("approve")!.click());
  expect(llamadas.some((l) => l.metodo === "POST" && l.ruta === "/api/projects/p/len-watch/approve")).toBe(true);
  expect(host.textContent).toContain("review");
});

it("el borrador cambió tras el arreglo: lo dice y «Publicar igual» lo confirma", async () => {
  const { c, llamadas } = cliente({ incident: READY, approve: { status: 409, body: { error: "changed_since_fix" } } });
  await montar(c);
  await act(async () => boton("approve")!.click());
  expect(host.textContent).toContain("changed");
  await act(async () => boton("publishAnyway")!.click());
  expect(llamadas.filter((l) => l.ruta.endsWith("/approve")).map((l) => l.cuerpo)).toEqual([{}, { confirmChanged: true }]);
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
