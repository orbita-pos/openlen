import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../sesion/plataforma", () => ({ plataforma: { abrirNavegador: vi.fn(), alVolverAlPrimerPlano: vi.fn(() => () => {}) } }));
import { TarjetaDeLaApp } from "./tarjetas";
import { plataforma } from "../sesion/plataforma";
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

// Final review, Important 1: a tool installed from the phone shows at once (the app reads the person's tools again).
it("una instalación que sale bien avisa a la app", async () => {
  iniciar();
  const onInstalada = vi.fn();
  const s = pedidos([Response.json({ installation: { id: "i1" } })]);
  await act(async () => root.render(<TarjetaDeLaApp x={instalar()} cliente={s.cliente} projectId="p1" idioma="es" onInstalada={onInstalada} />));
  await pulsar("installCard.install");
  expect(onInstalada).toHaveBeenCalledTimes(1);
});

// Final review, Important (Minor 1 re-graded): while it installs the card says so, and while the review runs, that.
it("mientras instala lo dice, y mientras la revisión sigue en marcha, eso", async () => {
  iniciar();
  let segunda!: (r: Response) => void;
  let n = 0;
  const pedir = vi.fn(async () => (++n === 1 ? Response.json({ error: "security_review_pending", fingerprint: "fp" }, { status: 428 }) : new Promise<Response>((r) => { segunda = r; })));
  await act(async () => root.render(<TarjetaDeLaApp x={instalar()} cliente={{ pedir, avisarAlCerrar: vi.fn() }} projectId="p1" idioma="es" />));
  await pulsar("installCard.install");
  expect(host.querySelector('[role="status"]')?.textContent).toContain("revisionSigue");
  await act(async () => segunda(Response.json({ installation: { id: "i1" } })));
  expect(host.textContent).toContain("instaladaProyecto");
});

it("mientras instala, sin revisión de por medio, dice «Instalando…»", async () => {
  iniciar();
  let resolver!: (r: Response) => void;
  const pedir = vi.fn(() => new Promise<Response>((r) => { resolver = r; }));
  await act(async () => root.render(<TarjetaDeLaApp x={instalar()} cliente={{ pedir, avisarAlCerrar: vi.fn() }} projectId="p1" idioma="es" />));
  await pulsar("installCard.install");
  expect(host.querySelector('[role="status"]')?.textContent).toContain("toolCard.installing");
  await act(async () => resolver(Response.json({ installation: { id: "i1" } })));
});

// OAuth de los conectores MCP en el teléfono (spec local 2026-11-17-oauth-de-conectores-mcp, §10.1): el toque pide la URL
// con la llave de la app y la abre en el navegador del sistema; al volver al primer plano (lo dice Capacitor, no el foco de
// una ventana), pide el estado del servidor (`GET /api/mcp-connectors`) y pasa a «Conectado».
const OAUTH_CARD = {
  server: "cal",
  host: "calendarmcp.googleapis.com",
  headerNames: [],
  credentials: [],
  fingerprint: "fp-cal",
  version: 0,
  oauth: { issuerHost: "accounts.google.com" as string | null, reason: "first" as const },
};
const conectar = (card: unknown, pedir: ReturnType<typeof vi.fn>) =>
  act(async () => root.render(<TarjetaDeLaApp x={{ tipo: "conectarMcp", card } as never} cliente={{ pedir, avisarAlCerrar: vi.fn() } as never} projectId="p1" idioma="es" />));
/** Captura lo que la tarjeta registra para enterarse de que la app volvió al primer plano. */
const alVolver = () => {
  let volver: (() => void) | null = null;
  let quitado = 0;
  vi.mocked(plataforma.alVolverAlPrimerPlano).mockImplementation((fn: () => void) => {
    volver = fn;
    return () => void quitado++;
  });
  return { volver: () => volver?.(), registrado: () => volver !== null, quitado: () => quitado };
};
const servidores = (...s: { name: string; status: string }[]) => Response.json({ available: true, version: 1, servers: s, credentials: [] });

it("«Conectar» un conector MCP abre la URL en el navegador del sistema y al volver a la app dice «Conectado»", async () => {
  iniciar();
  const abrirSpy = vi.spyOn(plataforma, "abrirNavegador").mockResolvedValue();
  const foco = alVolver();
  const pedir = vi.fn(async (ruta: string, init?: RequestInit) => {
    if (ruta === "/api/mcp-connectors/cal/oauth" && init?.method === "POST") {
      return Response.json({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=s1" });
    }
    if (ruta === "/api/mcp-connectors") return servidores({ name: "cal", status: "connected" });
    return new Response(null, { status: 404 });
  });
  await conectar(OAUTH_CARD, pedir);
  await pulsar("mcpApproval.connect");
  expect(pedir).toHaveBeenCalledWith("/api/mcp-connectors/cal/oauth", expect.objectContaining({ method: "POST" }));
  expect(abrirSpy).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?state=s1");

  // El foco de una ventana no es «volví a la app»: sólo lo que dice Capacitor.
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(pedir).not.toHaveBeenCalledWith("/api/mcp-connectors");

  await act(async () => foco.volver());
  expect(pedir).toHaveBeenCalledWith("/api/mcp-connectors");
  expect(host.textContent).toContain("mcpApproval.oauthConnected");
  // Ya conectado, deja de oír.
  expect(foco.quitado()).toBeGreaterThan(0);
});

it("mientras espera a que termines de iniciar sesión, lo dice", async () => {
  iniciar();
  vi.spyOn(plataforma, "abrirNavegador").mockResolvedValue();
  const foco = alVolver();
  const pedir = vi.fn(async (ruta: string) => (ruta === "/api/mcp-connectors" ? servidores({ name: "cal", status: "needs-auth" }) : Response.json({ authorizationUrl: "https://accounts.google.com/auth" })));
  await conectar(OAUTH_CARD, pedir);
  expect(foco.registrado()).toBe(false);
  expect(host.textContent).not.toContain("esperandoInicioDeSesion");
  await pulsar("mcpApproval.connect");
  expect(host.textContent).toContain("esperandoInicioDeSesion");
  // Volvió sin haber terminado: sigue esperando.
  await act(async () => foco.volver());
  expect(host.textContent).toContain("esperandoInicioDeSesion");
  expect(host.textContent).not.toContain("mcpApproval.oauthConnected");
});

it("🔴 una tarjeta que pide aprobación (un servidor que escribió Len) no tiene botón en el teléfono: se aprueba en la web", async () => {
  iniciar();
  const pedir = vi.fn();
  await conectar({ ...OAUTH_CARD, version: 7, credentials: [{ name: "KEY", set: false, destinationHosts: ["calendarmcp.googleapis.com"], otherHosts: [], firstTime: false }] }, pedir);
  expect(host.querySelector("button")).toBeNull();
  expect(host.textContent).toContain("aprobarEnLaWeb");
  expect(host.textContent).toContain("mcpApproval.title");
  expect(pedir).not.toHaveBeenCalled();
});

it("las tarjetas de iniciar sesión (versión 0) y las del directorio conservan su botón", async () => {
  iniciar();
  await conectar(OAUTH_CARD, vi.fn());
  expect(host.textContent).not.toContain("aprobarEnLaWeb");
  expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["mcpApproval.connect"]);
  act(() => root.unmount());
  host.remove();
  iniciar();
  await conectar({ ...OAUTH_CARD, version: 3, suggest: { id: "google-calendar", name: "Google Calendar", host: "calendarmcp.googleapis.com" } }, vi.fn());
  expect(host.textContent).not.toContain("aprobarEnLaWeb");
  expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["mcpApproval.connect"]);
});

it("🔴 con el directorio, busca el servidor con el nombre que éste devolvió (google-calendar-2), no el de la tarjeta", async () => {
  iniciar();
  vi.spyOn(plataforma, "abrirNavegador").mockResolvedValue();
  const foco = alVolver();
  let conectado = false;
  const pedir = vi.fn(async (ruta: string, init?: RequestInit) => {
    if (ruta === "/api/mcp-connectors/directory/google-calendar" && init?.method === "POST") {
      return Response.json({ server: "google-calendar-2", authorizationUrl: "https://accounts.google.com/auth" });
    }
    if (ruta === "/api/mcp-connectors") {
      return servidores({ name: "google-calendar", status: "needs-auth" }, { name: "google-calendar-2", status: conectado ? "connected" : "needs-auth" });
    }
    return new Response(null, { status: 404 });
  });
  await conectar({ ...OAUTH_CARD, server: "google-calendar", version: 2, suggest: { id: "google-calendar", name: "Google Calendar", host: "calendarmcp.googleapis.com" } }, pedir);
  await pulsar("mcpApproval.connect");
  await act(async () => foco.volver());
  expect(host.textContent).not.toContain("mcpApproval.oauthConnected");
  conectado = true;
  await act(async () => foco.volver());
  expect(host.textContent).toContain("mcpApproval.oauthConnected");
});

it("sin un host conocido de inicio de sesión dice «la página del propio servidor», nunca «null» ni el host del MCP", async () => {
  iniciar();
  await conectar({ ...OAUTH_CARD, oauth: { issuerHost: null, reason: "first" as const } }, vi.fn());
  expect(host.textContent).toContain("mcpApproval.signInOnServerPage");
  expect(host.textContent).not.toContain("signInAt");
  expect(host.textContent).not.toContain("null");
});

it("🔴 un fallo se dice con una frase, nunca con el código, y deja «Reintentar»", async () => {
  iniciar();
  const pedir = vi.fn(async () => Response.json({ error: "no_client", detail: "set oauth.clientId in mcp.json" }, { status: 422 }));
  await conectar(OAUTH_CARD, pedir);
  await pulsar("mcpApproval.connect");
  const alerta = host.querySelector('[role="alert"]')?.textContent ?? "";
  expect(alerta).toContain("mcpApproval.errors.noClient");
  expect(alerta).toContain("set oauth.clientId in mcp.json");
  expect(alerta).not.toContain("no_client");
  expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["mcpApproval.tryAgain"]);
  // Un código que nadie conoce es la frase genérica.
  pedir.mockResolvedValueOnce(Response.json({ error: "raro_123" }, { status: 500 }));
  await pulsar("mcpApproval.tryAgain");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("mcpApproval.errors.failed");
  expect(host.textContent).not.toContain("raro_123");
});

// Revisión final F3 (spec §10.2): el toque le dice al servidor el host de inicio de sesión que nombró la tarjeta; si ahora
// es otro, lo dice con una frase y el siguiente toque se compara con el nuevo.
it("🔴 la página de inicio de sesión cambió: lo dice y el siguiente toque manda el host nuevo", async () => {
  iniciar();
  vi.spyOn(plataforma, "abrirNavegador").mockResolvedValue();
  const cuerpos: unknown[] = [];
  const pedir = vi.fn(async (_ruta: string, init?: RequestInit) => {
    cuerpos.push(JSON.parse(String(init?.body ?? "null")));
    return cuerpos.length === 1
      ? Response.json({ error: "issuer_changed", issuerHost: "login.example.org" }, { status: 409 })
      : Response.json({ authorizationUrl: "https://login.example.org/authorize" });
  });
  await conectar(OAUTH_CARD, pedir);
  await pulsar("mcpApproval.connect");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("mcpApproval.errors.issuerChanged");
  expect(host.textContent).not.toContain("issuer_changed");
  await pulsar("mcpApproval.tryAgain");
  expect(cuerpos).toEqual([{ issuerHost: "accounts.google.com" }, { issuerHost: "login.example.org" }]);
  expect(plataforma.abrirNavegador).toHaveBeenCalledWith("https://login.example.org/authorize");
});
