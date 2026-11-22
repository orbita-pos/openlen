import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PantallaChat } from "./chat";
import type { Chat } from "./use-chat";
import type { ElementoDelHilo } from "./hilo";
import { readFileSync } from "node:fs";
vi.mock("use-intl", async (original) => {
 const real = await original<typeof import("use-intl")>();
 const es = (await import("@/messages/es/movil.json")).default;
 const t = real.createTranslator({ locale: "es", messages: { movil: es } });
 return { ...real, useTranslations: (ns: string) => (s: string, v?: Record<string, string | number>) => ns === "movil.chat.subagentes" || s.startsWith("subagentes.") || s === "deLen" ? t(`${ns}.${s}` as never, v as never) : s };
});
vi.mock("../cara", () => ({ Cara: () => null }));
vi.mock("../atras", () => ({ useAtras: () => {} }));
vi.mock("../deslizar", () => ({ useDeslizar: () => null }));
vi.mock("./use-nota", () => ({ useNota: () => ({ niveles: [], segundos: 0 }) }));
const tarjetaProps: { ultimo: Record<string, unknown> | null } = { ultimo: null };
vi.mock("../llamada/tarjetas", () => ({ TarjetaDeLaApp: (p: Record<string, unknown>) => { tarjetaProps.ultimo = p; return null; } }));
// An event task's cards poll their own route; they have their own test (avisos.test.tsx).
const tarjetasDelProyecto = vi.hoisted(() => ({ avisos: null as Record<string, unknown> | null, herramientas: null as Record<string, unknown> | null }));
vi.mock("./avisos", () => ({ AvisosDeLen: (p: Record<string, unknown>) => { tarjetasDelProyecto.avisos = p; return null; } }));
vi.mock("../herramientas/tool-cards", () => ({ TarjetasDeHerramientas: (p: Record<string, unknown>) => { tarjetasDelProyecto.herramientas = p; return null; } }));
// Her Len cards' state is the main screen's (it feeds her sheet too): here, only that her chat shows them.
const lenCards = vi.hoisted(() => ({ card: [] as Record<string, unknown>[] }));
vi.mock("../asistente/len-request-card", () => ({ LenRequestCard: (p: Record<string, unknown>) => { lenCards.card.push(p); return <div data-len-card={(p.lenRef as { filaId: string }).filaId} />; } }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const cerrar = vi.fn();
const cliente = { pedir: vi.fn(), avisarAlCerrar: vi.fn() };
const mensaje = (estado: "ok" | "enviando" | "noSeSubio" = "ok"): ElementoDelHilo => ({ tipo: "tu", clave: "yo", t: 1, texto: "Hola", estado });
const respuesta = (texto = "Respuesta"): ElementoDelHilo => ({ tipo: "len", clave: "len", t: 2, texto });
beforeEach(() => {
 vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
 cerrar.mockClear();
 cliente.pedir.mockReset();
 host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function pintar(elementos: ElementoDelHilo[], trabajando = false, turnoId: string | null = null, abierto = true, enfocar?: { clave: string | null; alEnfocar: () => void }) {
 const chat = { elementos, trabajando, turnoId, pregunta: false, avance: null, progreso: [], mandar: vi.fn(), reintentar: vi.fn(), borrar: vi.fn() } as unknown as Chat;
 act(() => root.render(<PantallaChat abierto={abierto} chat={chat} cliente={cliente} projectId="p1" idioma="es" conPip={false} onCerrar={cerrar} onLlamar={vi.fn()} onVerPagina={vi.fn()} enfocar={enfocar?.clave} onEnfocado={enfocar?.alEnfocar} />));
 return host.querySelector<HTMLDivElement>(".ch-log")!;
}
// Len móvil is her app (spec local 2026-11-16-movil-es-tu-asistente, §5.5): the event and tool cards of the project on
// the phone's screen show in HER chat, which lives in her home project.
const tarjetasVistas = (): { avisos: Record<string, unknown> | null; herramientas: Record<string, unknown> | null } => tarjetasDelProyecto;
it("her chat shows the event and tool cards of the project on screen", () => {
 tarjetasDelProyecto.avisos = null;
 tarjetasDelProyecto.herramientas = null;
 const chat = { elementos: [], trabajando: false, turnoId: null, pregunta: false, avance: null, progreso: [], mandar: vi.fn(), reintentar: vi.fn(), borrar: vi.fn() } as unknown as Chat;
 act(() => root.render(<PantallaChat abierto chat={chat} cliente={cliente} projectId="p1" cardsProjectId="p2" idioma="es" conPip={false} onCerrar={cerrar} onLlamar={vi.fn()} onVerPagina={vi.fn()} asistente={{ name: "Lucía", color: "#3b82f6" }} />));
 expect(tarjetasVistas().avisos?.projectId).toBe("p2");
 expect(tarjetasVistas().herramientas?.projectId).toBe("p2");
});

it("🔴 her chat shows a Len card for each request she passed, following its row", () => {
 lenCards.card = [];
 const onCompare = vi.fn();
 const chat = { elementos: [{ clave: "t1:lenPedidos", t: 1, tipo: "lenPedidos", refs: [{ filaId: "f1", projectId: "p2" }] }], trabajando: false, turnoId: null, pregunta: false, avance: null, progreso: [], mandar: vi.fn(), reintentar: vi.fn(), borrar: vi.fn() } as unknown as Chat;
 act(() => root.render(<PantallaChat abierto chat={chat} cliente={cliente} projectId="p1" cardsProjectId="p2" idioma="es" conPip={false} onCerrar={cerrar} onLlamar={vi.fn()} onVerPagina={vi.fn()} asistente={{ name: "Lucía", color: "#3b82f6" }}
   lenCards={{ byFila: new Map([["f1", { filaId: "f1", status: "done" as const }]]), onStop: vi.fn(), projectTitle: (id) => (id === "p2" ? "Café" : ""), onCompare, onPublish: vi.fn() }} />));
 expect(host.querySelector('[data-len-card="f1"]')).not.toBeNull();
 expect(lenCards.card[0]).toMatchObject({ projectTitle: "Café", name: "Lucía", view: { filaId: "f1", status: "done" } });
 act(() => (lenCards.card[0]!.onCompare as () => void)());
 expect(onCompare).toHaveBeenCalledWith({ filaId: "f1", projectId: "p2" });
});

// Delivery 4's deferred minor M2: with no pages, an agent that wrote a file in your space ended her turn with «Ver en tu
// página», and tapping it only closed the chat. With no page to look at, the card isn't offered.
it("🔴 with no page to look at, a turn that changed something doesn't offer «Ver en tu página»", () => {
 const chat = { elementos: [mensaje(), respuesta(), { tipo: "verEnTuPagina", clave: "t1:ver", t: 3 }], trabajando: false, turnoId: null, pregunta: false, avance: null, progreso: [], mandar: vi.fn(), reintentar: vi.fn(), borrar: vi.fn() } as unknown as Chat;
 act(() => root.render(<PantallaChat abierto chat={chat} cliente={cliente} projectId="space" idioma="es" conPip={false} onCerrar={cerrar} onLlamar={vi.fn()} asistente={{ name: "Chef Rosa", color: "#3b82f6" }} />));
 expect(host.querySelector('[data-clave="t1:ver"]')).toBeNull();
 expect(host.textContent).not.toContain("verEnTuPagina");
 expect(host.textContent).toContain("Respuesta");
});

it("with a page, the same turn offers it", () => {
 const onVerPagina = vi.fn();
 const chat = { elementos: [mensaje(), respuesta(), { tipo: "verEnTuPagina", clave: "t1:ver", t: 3 }], trabajando: false, turnoId: null, pregunta: false, avance: null, progreso: [], mandar: vi.fn(), reintentar: vi.fn(), borrar: vi.fn() } as unknown as Chat;
 act(() => root.render(<PantallaChat abierto chat={chat} cliente={cliente} projectId="p1" idioma="es" conPip={false} onCerrar={cerrar} onLlamar={vi.fn()} onVerPagina={onVerPagina} />));
 act(() => host.querySelector<HTMLButtonElement>('[data-clave="t1:ver"] button')!.click());
 expect(onVerPagina).toHaveBeenCalled();
});

it("her chat with no project on screen shows no project cards", () => {
 tarjetasDelProyecto.avisos = null;
 const chat = { elementos: [], trabajando: false, turnoId: null, pregunta: false, avance: null, progreso: [], mandar: vi.fn(), reintentar: vi.fn(), borrar: vi.fn() } as unknown as Chat;
 act(() => root.render(<PantallaChat abierto chat={chat} cliente={cliente} projectId="p1" idioma="es" conPip={false} onCerrar={cerrar} onLlamar={vi.fn()} onVerPagina={vi.fn()} asistente={{ name: "Lucía", color: "#3b82f6" }} />));
 expect(tarjetasVistas().avisos).toBeNull();
});

// Herramientas, fase 5 (§4.4, §4.14): lo que manda una herramienta con `sendPrompt` llena el cuadro, como el
// `pendingDraft` de la web; lo envía la persona, nunca la app.
it("el borrador de una herramienta sustituye el texto del cuadro y no se envía nada", () => {
 const chat = { elementos: [], trabajando: false, turnoId: null, pregunta: false, avance: null, progreso: [], mandar: vi.fn(), reintentar: vi.fn(), borrar: vi.fn() } as unknown as Chat;
 const dibujar = (borrador: { texto: string; n: number } | null) => act(() => root.render(<PantallaChat abierto chat={chat} cliente={cliente} projectId="p1" idioma="es" conPip={false} onCerrar={cerrar} onLlamar={vi.fn()} onVerPagina={vi.fn()} borrador={borrador} />));
 dibujar(null);
 const campo = host.querySelector<HTMLTextAreaElement>("textarea")!;
 act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(campo, "lo que había"); campo.dispatchEvent(new Event("input", { bubbles: true })); });
 dibujar({ texto: "> Confirma a Ana\n\n— Reservas\n", n: 1 });
 expect(campo.value).toBe("> Confirma a Ana\n\n— Reservas\n");
 expect((chat as unknown as { mandar: ReturnType<typeof vi.fn> }).mandar).not.toHaveBeenCalled();
 expect(cliente.pedir).not.toHaveBeenCalled();
});

// Final review, Important 1: «Instalar» que sale bien en el chat llega a la app, que relee las herramientas.
it("una instalación desde una tarjeta del chat avisa de que cambiaron las herramientas", () => {
 const onHerramientasCambiaron = vi.fn();
 const chat = { elementos: [{ clave: "c1", t: 1, tipo: "tarjeta", tarjeta: { tipo: "instalar", confirm: { title: "Reservas", placement: "project" } } }], trabajando: false, turnoId: null, pregunta: false, avance: null, progreso: [], mandar: vi.fn(), reintentar: vi.fn(), borrar: vi.fn() } as unknown as Chat;
 act(() => root.render(<PantallaChat abierto chat={chat} cliente={cliente} projectId="p1" idioma="es" conPip={false} onCerrar={cerrar} onLlamar={vi.fn()} onVerPagina={vi.fn()} onHerramientasCambiaron={onHerramientasCambiaron} />));
 (tarjetaProps.ultimo?.onInstalada as () => void)();
 expect(onHerramientasCambiaron).toHaveBeenCalledTimes(1);
});

it("no muestra leído para un mensaje pendiente ni una subida fallida", () => {
 pintar([mensaje("enviando")], true);
 expect(host.textContent).not.toContain("leido"); expect(host.textContent).toContain("enviando");
 pintar([mensaje("noSeSubio")], true, "turno"); expect(host.textContent).not.toContain("leido");
});
it("no marca leído sólo por tener un turno sin confirmación de recepción", () => {
 pintar([mensaje()], true, null); expect(host.textContent).not.toContain("leido");
 pintar([mensaje()], true, "turno"); expect(host.textContent).toContain("leido");
});
it("seguir al final también funciona cuando crece el mismo párrafo", () => {
 const el = pintar([mensaje(), respuesta()], true, "turno");
 let alto = 600; Object.defineProperties(el, { clientHeight: { value: 200 }, scrollHeight: { get: () => alto } });
 el.scrollTop = 400; act(() => el.dispatchEvent(new Event("scroll")));
 alto = 1000; pintar([mensaje(), respuesta("Respuesta que crece dentro de la misma burbuja")], true, "turno");
 expect(el.scrollTop).toBeGreaterThanOrEqual(800);
});
it("respetar lectura antigua y volver al final con un control visible", () => {
 const el = pintar([mensaje(), respuesta()]);
 Object.defineProperties(el, { clientHeight: { value: 200 }, scrollHeight: { value: 1000 } });
 el.scrollTop = 0; act(() => el.dispatchEvent(new Event("scroll")));
 pintar([mensaje(), respuesta(), { ...respuesta("Otra respuesta"), clave: "len2" }]);
 expect(el.scrollTop).toBe(0);
 const boton = host.querySelector<HTMLButtonElement>('.ch-volver-final'); expect(boton).not.toBeNull();
 act(() => boton!.click()); expect(el.scrollTop).toBeGreaterThanOrEqual(800);
});

it("desde Entregado lleva a la vista el turno que entregó el archivo, cuando llega, y deja de seguir el final", () => {
 const vistos: Element[] = [];
 Element.prototype.scrollIntoView = function (this: Element) { vistos.push(this); };
 const alEnfocar = vi.fn();
 const objetivo = { ...respuesta("El PDF"), clave: "t9:entregado" };
 const el = pintar([mensaje()], false, null, true, { clave: "t9:entregado", alEnfocar });
 expect(alEnfocar).not.toHaveBeenCalled();
 pintar([mensaje(), objetivo, { ...respuesta("Luego"), clave: "t10:len:0" }], false, null, true, { clave: "t9:entregado", alEnfocar });
 expect(vistos.map(v => v.getAttribute("data-clave"))).toEqual(["t9:entregado"]);
 expect(alEnfocar).toHaveBeenCalledOnce();
 Object.defineProperties(el, { clientHeight: { value: 200 }, scrollHeight: { value: 1000 } });
 el.scrollTop = 100;
 pintar([mensaje(), objetivo, { ...respuesta("Luego"), clave: "t10:len:0" }, { ...respuesta("Más"), clave: "t11:len:0" }], false, null, true, { clave: null, alEnfocar });
 expect(el.scrollTop).toBe(100);
 delete (Element.prototype as Partial<Element>).scrollIntoView;
});

it("el chat contiene el foco y Escape vuelve a la página", () => {
 pintar([mensaje(), respuesta()]);
 const panel = host.querySelector<HTMLElement>('.lm-layer.lm-chat')!;
 expect(panel.contains(document.activeElement)).toBe(true);
 const botones = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
 botones.at(-1)!.focus();
 act(() => botones.at(-1)!.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));
 expect(document.activeElement).toBe(botones[0]);
 act(() => panel.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
 expect(cerrar).toHaveBeenCalledOnce();
 pintar([mensaje()], false, null, false); expect(panel.hasAttribute('inert')).toBe(true);
});

it("la nota transcrita indica que aún se está enviando", () => {
 pintar([{tipo:"voz",clave:"nota",t:1,url:"blob:nota",barras:[],segundos:4,transcripcion:"Cambia el horario",estado:"enviando"}], true);
 expect(host.textContent).toContain('enviando'); expect(host.textContent).not.toContain('leido');
});

const hijos: ElementoDelHilo = { tipo: "subagentes", clave: "f1:subagentes", t: 2, fila: "f1", refs: [{ id: "r1", preset: "len-design" }, { id: "r2", preset: "general-purpose" }] };
const run = (id: string, status = "running", worktree: unknown = null) => ({ id, preset: id === "r1" ? "len-design" : "general-purpose", description: id === "r1" ? "Arregla portada" : "Arregla pie", status, toolUses: 3, durationMs: 4200, worktree, finalText: "SECRET", actions: [{ tool: "Read", summary: "SECRET STEP" }] });
const responder = (runs: unknown[]) => new Response(JSON.stringify({ runs }));
const vaciar = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };

it("one line per child under its turn, without steps or closing message", async () => {
 vi.useFakeTimers();
 cliente.pedir.mockImplementation(async () => responder([run("r1"), run("r2", "completed")]));
 pintar([respuesta(), hijos]); await vaciar();
 const lineas = host.querySelectorAll("[data-subagente]");
 expect(lineas).toHaveLength(2);
 expect(lineas[0]?.textContent).toContain("Arregla portada"); expect(lineas[0]?.textContent).toContain("len-design");
 expect(lineas[0]?.textContent).toContain("trabajando"); expect(lineas[0]?.textContent).toContain("3 pasos"); expect(lineas[0]?.textContent).toContain("0:04");
 expect(lineas[1]?.textContent).toContain("terminado"); expect(lineas[1]?.textContent).not.toContain("general-purpose");
 expect(host.textContent).not.toContain("SECRET");
});

it("the ■ stops a working child and re-reads", async () => {
 vi.useFakeTimers();
 cliente.pedir.mockImplementation(async (url: string) => url.endsWith("/stop") ? new Response(JSON.stringify({ stopped: true })) : responder([run("r1"), run("r2", "completed")]));
 pintar([hijos]); await vaciar();
 const botones = host.querySelectorAll<HTMLButtonElement>('button[aria-label="Parar este subagente"]');
 expect(botones).toHaveLength(1);
 await act(async () => botones[0]!.click()); await vaciar();
 expect(cliente.pedir).toHaveBeenCalledWith("/api/agent/subagents/r1/stop", { method: "POST" });
 expect(cliente.pedir.mock.calls.filter(c => !c[0].endsWith("/stop"))).toHaveLength(2);
});

it("with the turn closed and children working, the status line counts them", async () => {
 vi.useFakeTimers(); cliente.pedir.mockImplementation(async () => responder([run("r1"), run("r2")]));
 pintar([hijos]); await vaciar(); expect(host.querySelector(".ch-st")?.textContent).toBe("2 subagentes trabajando");
});

it("it stops polling when none works, also after a saved closed turn", async () => {
 vi.useFakeTimers();
 cliente.pedir.mockImplementationOnce(async () => responder([run("r1"), run("r2", "completed")]))
  .mockImplementation(async () => responder([run("r1", "completed"), run("r2", "completed")]));
 pintar([hijos]); await vaciar();
 await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
 expect(cliente.pedir).toHaveBeenCalledTimes(2);
 await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
 expect(cliente.pedir).toHaveBeenCalledTimes(2);
 expect(host.querySelector(".ch-st")?.textContent).toBe("");
});

it("an isolated child says en su copia, then what it brought", async () => {
 vi.useFakeTimers(); cliente.pedir.mockImplementationOnce(async () => responder([run("r1", "running", { state: "working" })]))
  .mockImplementation(async () => responder([run("r1", "completed", { state: "brought", files: ["/a", "/b"] })]));
 pintar([hijos]); await vaciar(); expect(host.textContent).toContain("en su copia");
 await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
 expect(host.textContent).toContain("trajo 2 ficheros"); expect(host.textContent).not.toContain("en su copia");
});

it("the turn that woke Len says Resultados de los subagentes", () => {
 pintar([{ tipo: "origen", clave: "f2:origen", t: 3, origen: "subagentes" }, respuesta()]);
 expect(host.textContent).toContain("Resultados de los subagentes");
});

it("🔴 Len's message to this agent says «De Len · <page>» before his words", () => {
 pintar([{ tipo: "origen", clave: "f3:origen", t: 3, origen: "len", proyecto: "Presupuesto" }, { tipo: "tu", clave: "f3:tu", t: 3, texto: "¿Puedes revisarlo?", estado: "ok" }, respuesta()]);
 const filas = [...host.querySelectorAll(".ch-log .ch-day, .ch-log .ch-row")].map((f) => f.textContent ?? "");
 expect(filas[0]).toBe("De Len · Presupuesto");
 expect(filas[1]).toContain("¿Puedes revisarlo?");
});

it("🔴 «De Len · <page>» exists in all 10 locales, with the web's words", () => {
 for (const l of ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"]) {
  const movil = JSON.parse(readFileSync(`messages/${l}/movil.json`, "utf8")).chat.deLen;
  const web = JSON.parse(readFileSync(`messages/${l}/panelsChat.json`, "utf8")).turn.fromLen;
  expect(web).toContain("{project}");
  expect(web).toContain("Len");
  expect(movil).toBe(web);
 }
});

it("the new keys exist in all 10 locales, with the web's words", () => {
 for (const l of ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"]) {
  const movil = JSON.parse(readFileSync(`messages/${l}/movil.json`, "utf8")).chat.subagentes;
  const web = JSON.parse(readFileSync(`messages/${l}/panelsChat.json`, "utf8"));
  expect(movil).toMatchObject({ status: web.subagent.status, steps: web.subagent.steps, stop: web.subagent.stop, trabajando: web.subagent.liveBar, worktree: web.subagent.worktree, origen: web.turn.fromSubagents });
 }
});

it("🔴 a visual item renders in the phone chat and forwards sendPrompt and updateModelContext to chat", async () => {
 cliente.pedir.mockResolvedValue(Response.json({ url: "https://lienzo-visuals.openlen.app/" }));
 const mandar = vi.fn();
 const reportVisualState = vi.fn();
 const visual = {
  clave: "visual:widget_aaaa1111",
  t: 2,
  tipo: "visual",
  widgetId: "widget_aaaa1111",
  widget: { title: "Gasto", loadingMessages: [], code: "<svg/>" },
  final: true,
 } as unknown as ElementoDelHilo;
 const chat = { elementos: [mensaje(), visual], trabajando: false, turnoId: null, pregunta: false, avance: null, progreso: [], mandar, reportVisualState, reintentar: vi.fn(), borrar: vi.fn() } as unknown as Chat;
 await act(async () => {
  root.render(<PantallaChat abierto chat={chat} cliente={cliente} projectId="p1" idioma="es" conPip={false} onCerrar={cerrar} onLlamar={vi.fn()} onVerPagina={vi.fn()} />);
 });
 const row = host.querySelector('[data-clave="visual:widget_aaaa1111"]');
 expect(row).not.toBeNull();
 expect(row!.classList.contains("is-visual")).toBe(true);
 const iframe = row!.querySelector("iframe")!;
 expect(iframe).not.toBeNull();
 act(() => {
  window.dispatchEvent(new MessageEvent("message", { data: { kind: "ol-visual:context", text: "3 of 5" }, origin: "https://lienzo-visuals.openlen.app", source: iframe.contentWindow }));
 });
 expect(reportVisualState).toHaveBeenCalledWith("widget_aaaa1111", "3 of 5");
 vi.spyOn(document, "activeElement", "get").mockReturnValue(iframe);
 act(() => { window.dispatchEvent(new Event("blur")); });
 act(() => {
  window.dispatchEvent(new MessageEvent("message", { data: { kind: "ol-visual:prompt", text: "Listo" }, origin: "https://lienzo-visuals.openlen.app", source: iframe.contentWindow }));
 });
 expect(mandar).toHaveBeenCalledWith("Listo");
});
