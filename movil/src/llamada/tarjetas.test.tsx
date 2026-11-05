import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TarjetaDeLaApp } from "./tarjetas";
vi.mock("use-intl", () => ({ useTranslations: () => (s: string) => s }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const iniciar = () => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); };
it("una tarjeta de visitas muestra error recuperable en vez de desaparecer", async () => {
 iniciar(); let falla = true;
 const cliente = { avisarAlCerrar: vi.fn(), pedir: vi.fn(async () => falla ? new Response(null, {status:503}) : Response.json({vistas:23,personas:17,hoy:2,porDia:[],origen:null})) };
 await act(async () => root.render(<TarjetaDeLaApp x={{tipo:"visitas"}} cliente={cliente} projectId="p1" idioma="es"/>));
 expect(host.querySelector('[role="alert"]')?.textContent).toContain('error');
 falla = false; await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
 expect(host.textContent).toContain('23'); expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("el borrador queda protegido mientras se envía", async () => {
 iniciar(); let completar!: (r: Response) => void;
 const cliente = { avisarAlCerrar: vi.fn(), pedir: vi.fn(() => new Promise<Response>(r => { completar = r; })) };
 await act(async () => root.render(<TarjetaDeLaApp x={{tipo:"respuesta",respuesta:{action:"responder",para:"chat",correo:null,whatsapp:null,id:"r1",texto:"Respuesta que se envía",con:"Cliente",botones:["enviar"]}}} cliente={cliente} projectId="p1" idioma="es"/>));
 await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
 try { expect(host.querySelector('textarea')!.disabled).toBe(true); }
 finally { await act(async () => completar(new Response(null,{status:200}))); }
 expect(host.querySelector('textarea')!.value).toBe('Respuesta que se envía');
});
it("fallar al copiar da una explicación visible", async () => {
 iniciar(); vi.stubGlobal('navigator',{clipboard:{writeText:vi.fn().mockRejectedValue(new Error('denegado'))}});
 const cliente = { pedir:vi.fn(), avisarAlCerrar:vi.fn() };
 await act(async () => root.render(<TarjetaDeLaApp x={{tipo:"respuesta",respuesta:{action:"responder",para:"chat",correo:null,whatsapp:null,id:"r1",texto:"Respuesta",con:"Cliente",botones:["copiar"]}}} cliente={cliente} projectId="p1" idioma="es"/>));
 await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
 expect(host.querySelector('[role="alert"]')?.textContent).toContain('error');
});

// Herramientas, fase 5 (spec local 2026-11-04-herramientas-hechas-por-len, §4.2, §4.14): el «Instalar» que deja el
// `publish` de Len en una herramienta se pulsa desde el teléfono. La revisión de seguridad que sigue en marcha la
// espera el servidor (`waitWhenPending`); lo que encuentre, y lo que borre datos, sólo lo acepta el toque de la persona.
const instalar = (placement: "rail" | "project" = "project") => ({ tipo: "instalar" as const, confirm: { title: "Reservas de hoy", placement } });
const pedidos = (respuestas: Response[]) => {
  const cuerpos: Record<string, unknown>[] = [];
  const pedir = vi.fn(async (_ruta: string, init?: RequestInit) => {
    cuerpos.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return respuestas.shift() ?? Response.json({ installation: { id: "i1" } });
  });
  return { cliente: { pedir, avisarAlCerrar: vi.fn() }, pedir, cuerpos };
};
const pulsar = async (texto: string) => act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === texto)!.click());

it("«Instalar» instala con el cliente del teléfono y espera la revisión en el servidor", async () => {
  iniciar();
  const s = pedidos([Response.json({ installation: { id: "i1" } })]);
  await act(async () => root.render(<TarjetaDeLaApp x={instalar()} cliente={s.cliente} projectId="p1" idioma="es" />));
  expect(host.textContent).toContain("installCard.title");
  await pulsar("installCard.install");
  expect(s.pedir).toHaveBeenCalledWith("/api/projects/p1/install", expect.objectContaining({ method: "POST" }));
  expect(s.cuerpos[0]).toEqual({ locale: "es", waitWhenPending: true });
  expect(host.textContent).toContain("instaladaProyecto");
  expect([...host.querySelectorAll("button")].some((b) => b.textContent === "installCard.install")).toBe(false);
});

it("lo que encuentra la revisión: los hallazgos y «Instalar igual», que manda la huella", async () => {
  iniciar();
  const s = pedidos([Response.json({ error: "security_findings", fingerprint: "fp-1", blocking: [{ category: "rls", description: "Una tabla sin RLS" }] }, { status: 428 })]);
  await act(async () => root.render(<TarjetaDeLaApp x={instalar("rail")} cliente={s.cliente} projectId="p1" idioma="es" />));
  await pulsar("installCard.install");
  expect(host.textContent).toContain("installCard.findings");
  expect(host.textContent).toContain("Una tabla sin RLS");
  await pulsar("installCard.installAnyway");
  expect(s.cuerpos[1]).toEqual({ locale: "es", waitWhenPending: true, acceptSecurityFingerprint: "fp-1" });
  expect(host.textContent).toContain("instaladaRail");
});

it("si borra datos reales, «Instalar igual» manda la huella de los cambios", async () => {
  iniciar();
  const s = pedidos([Response.json({ error: "confirmation_required", fingerprint: "dfp", destructive: [] }, { status: 428 })]);
  await act(async () => root.render(<TarjetaDeLaApp x={instalar()} cliente={s.cliente} projectId="p1" idioma="es" />));
  await pulsar("installCard.install");
  expect(host.textContent).toContain("installCard.destructive");
  await pulsar("installCard.installAnyway");
  expect(s.cuerpos[1]).toEqual({ locale: "es", waitWhenPending: true, confirmFingerprint: "dfp" });
});

it("la revisión sigue en marcha pasado lo que espera el servidor: lo dice y deja volver a intentar", async () => {
  iniciar();
  // Se pregunta otra vez hasta tres veces (y cada vez el servidor vuelve a esperar), como al publicar.
  const pendiente = () => Response.json({ error: "security_review_pending", fingerprint: "fp" }, { status: 428 });
  const s = pedidos([pendiente(), pendiente(), pendiente(), pendiente()]);
  await act(async () => root.render(<TarjetaDeLaApp x={instalar()} cliente={s.cliente} projectId="p1" idioma="es" />));
  await pulsar("installCard.install");
  expect(host.textContent).toContain("revisionSigue");
  expect(s.pedir).toHaveBeenCalledTimes(4);
  await pulsar("volverAIntentar");
  expect(s.pedir).toHaveBeenCalledTimes(5);
  expect(host.textContent).toContain("instaladaProyecto");
});

it("otro fallo: lo dice, y se puede volver a pulsar", async () => {
  iniciar();
  const s = pedidos([Response.json({ error: "app_does_not_compile" }, { status: 422 })]);
  await act(async () => root.render(<TarjetaDeLaApp x={instalar()} cliente={s.cliente} projectId="p1" idioma="es" />));
  await pulsar("installCard.install");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("installCard.failed");
  expect([...host.querySelectorAll("button")].some((b) => b.textContent === "installCard.install")).toBe(true);
});
