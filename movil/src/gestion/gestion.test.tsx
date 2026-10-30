import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Gestion } from "./gestion";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
vi.mock("use-intl", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("../atras", () => ({ useAtras: () => {} }));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn() } }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
afterEach(() => { if(root) act(() => root.unmount()); host?.remove(); vi.unstubAllGlobals(); });
const project = { id: "p", title: "Pan", subdomain: "pan", publishedAt: null, deployUrl: "https://pan.openlen.app", chatHistory: [] };
async function montar(c: ClienteDeOpenLen, props = {}) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Gestion cliente={c} projectId="p" idioma="es" trabajando={false} turnoId={null} onCerrar={vi.fn()} onCambio={vi.fn()} onEncargo={vi.fn()} {...props} />));
}
const boton = (nombre: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === nombre)!;
it("no comparte borradores y muestra visitas reales sólo al solicitarlas", async () => {
  const rutas: string[] = [];
  await montar({ avisarAlCerrar: vi.fn(), pedir: async r => { rutas.push(r); return Response.json(r.includes("visitas") ? { vistas: 17, personas: 11, hoy: 3, porDia: [], origen: null } : { project }); } });
  expect(boton("compartir").disabled).toBe(true);
  expect(rutas.some(r => r.includes("visitas"))).toBe(false);
  await act(async () => boton("numeros").click());
  expect(host.textContent).toContain("17");
  expect(host.textContent).toContain("11");
});
it("el bloqueo de seguridad se ve y jamás se fuerza sin confirmación", async () => {
  const posts: unknown[] = [];
  await montar({ avisarAlCerrar: vi.fn(), pedir: async (r, init) => {
    if (r.endsWith("/publish")) { posts.push(JSON.parse(String(init?.body))); return Response.json({ error: "security_findings", fingerprint: "a".repeat(64), blocking: [{ description: "Acceso a datos privados" }] }, { status: 428 }); }
    return Response.json({ project });
  } });
  await act(async () => host.querySelector<HTMLButtonElement>(".gestion-principal")!.click());
  expect(host.textContent).toContain("Acceso a datos privados");
  expect(host.textContent).not.toContain("security_findings");
  expect(posts).toHaveLength(1);
  expect(posts[0]).not.toHaveProperty("acceptSecurityFingerprint");
  expect(boton("publicarIgual").disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => boton("publicarIgual").click());
  expect(posts[1]).toHaveProperty("acceptSecurityFingerprint", "a".repeat(64));
});
it("reanuda el objetivo real y no crea otro encargo", async () => {
  const onEncargo = vi.fn();
  const goal = { id: "g", phase: "paused", objective: "Corregir horarios", roundsStarted: 2, maxGoalRounds: 256, activation: "disarmed" };
  await montar({ avisarAlCerrar: vi.fn(), pedir: async () => Response.json({ project: { ...project, chatHistory: [{ goal }] } }) }, { onEncargo });
  await act(async () => boton("encargos").click());
  expect(host.textContent).toContain("Corregir horarios");
  await act(async () => boton("reanudar").click());
  expect(onEncargo).toHaveBeenCalledWith("Corregir horarios", "resume");
});
it("una respuesta del proyecto anterior no reemplaza al nuevo", async () => {
  let completar!: (r: Response) => void;
  const c = { avisarAlCerrar: vi.fn(), pedir: async (r: string) => r.endsWith("/p") ? new Promise<Response>(resolve => { completar = resolve; }) : Response.json({ project: { ...project, id: "nuevo", title: "Nuevo" } }) };
  await montar(c);
  await act(async () => root.render(<Gestion cliente={c} projectId="nuevo" idioma="es" trabajando={false} turnoId={null} onCerrar={vi.fn()} onCambio={vi.fn()} onEncargo={vi.fn()} />));
  await act(async () => completar(Response.json({ project })));
  expect(host.textContent).toContain("Nuevo");
  expect(host.textContent).not.toContain("Pan");
});
it("comparte sólo la dirección publicada que devolvió el servidor", async () => {
  const share = vi.fn(async () => {});
  vi.stubGlobal("navigator", { share });
  await montar({ avisarAlCerrar: vi.fn(), pedir: async () => Response.json({ project: { ...project, publishedAt: "2026-10-26", deployUrl: "https://real.example/site" } }) });
  await act(async () => boton("compartir").click());
  expect(share).toHaveBeenCalledWith({ title: "Pan", url: "https://real.example/site" });
});
it("no presenta una falla de visitas como cero visitas", async () => {
  await montar({ avisarAlCerrar: vi.fn(), pedir: async r => r.includes("visitas") ? new Response("proxy failed", { status: 503 }) : Response.json({ project }) });
  await act(async () => boton("numeros").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("error");
  expect(host.querySelector('[role="alert"]')?.textContent).not.toContain("HTTP 503");
  expect(host.querySelector(".gestion-numeros")).toBeNull();
});
it("no permite quitar un encargo mientras sigue trabajando y pausa el turno exacto", async () => {
  const peticiones: unknown[] = [];
  const goal = { id: "g", phase: "active", objective: "Corregir horarios", roundsStarted: 2, maxGoalRounds: 256, activation: "armed" };
  await montar({ avisarAlCerrar: vi.fn(), pedir: async (r, init) => {
    if (r.endsWith("cancelar")) { peticiones.push(JSON.parse(String(init?.body))); return Response.json({ ok: true }); }
    return Response.json({ project: { ...project, chatHistory: [{ goal }] } });
  } }, { trabajando: true, turnoId: "turno-vivo" });
  await act(async () => boton("encargos").click());
  expect(boton("quitar").disabled).toBe(true);
  await act(async () => boton("pausar").click());
  expect(peticiones).toEqual([{ turnoId: "turno-vivo" }]);
  expect(host.textContent).toContain("pausando");
});
it("la confirmación destructiva muestra columna y cantidad afectada", async () => {
  await montar({ avisarAlCerrar: vi.fn(), pedir: async r => r.endsWith("/publish")
    ? Response.json({ error: "confirmation_required", fingerprint: "a".repeat(64), destructive: [{ kind: "drop_column", table: "orders", column: "phone", count: 29 }] }, { status: 428 })
    : Response.json({ project }) });
  await act(async () => host.querySelector<HTMLButtonElement>(".gestion-principal")!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("phone");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("29");
});
// Len Watch (spec local 2026-10-30-len-watch, §5.5): the fix Len published isn't in the draft yet.
it("el arreglo de Len Watch que falta en el borrador: «Traer el arreglo» lo trae y publica otra vez", async () => {
  const rutas: { r: string; body: unknown }[] = [];
  let primera = true;
  await montar({ avisarAlCerrar: vi.fn(), pedir: async (r, init) => {
    if (init?.body) rutas.push({ r, body: JSON.parse(String(init.body)) });
    if (r.endsWith("/publish") && primera) { primera = false; return Response.json({ error: "len_watch_fix_pending", incidentId: "i1", branch: "len-watch/i1" }, { status: 428 }); }
    if (r.endsWith("/len-watch/bring")) return Response.json({ status: "brought" });
    if (r.endsWith("/publish")) return Response.json({ url: "https://pan.openlen.app", publishedAt: "2026-10-30T12:00:00Z" });
    return Response.json({ project });
  } });
  await act(async () => host.querySelector<HTMLButtonElement>(".gestion-principal")!.click());
  expect(host.textContent).toContain("arregloPendiente");
  await act(async () => boton("traerArreglo").click());
  expect(rutas.map(x => x.r)).toEqual(["/api/projects/p/publish", "/api/projects/p/len-watch/bring", "/api/projects/p/publish"]);
  expect(rutas[1]!.body).toEqual({ incidentId: "i1" });
  expect(rutas[2]!.body).not.toHaveProperty("acceptLenWatchFix");
});
