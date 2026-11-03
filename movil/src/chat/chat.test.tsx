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
 return { ...real, useTranslations: (ns: string) => (s: string, v?: Record<string, string | number>) => ns === "movil.chat.subagentes" || s.startsWith("subagentes.") ? t(`${ns}.${s}` as never, v as never) : s };
});
vi.mock("../cara", () => ({ Cara: () => null }));
vi.mock("../atras", () => ({ useAtras: () => {} }));
vi.mock("../deslizar", () => ({ useDeslizar: () => null }));
vi.mock("./use-nota", () => ({ useNota: () => ({ niveles: [], segundos: 0 }) }));
vi.mock("../llamada/tarjetas", () => ({ TarjetaDeLaApp: () => null }));
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

it("the new keys exist in all 10 locales, with the web's words", () => {
 for (const l of ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"]) {
  const movil = JSON.parse(readFileSync(`messages/${l}/movil.json`, "utf8")).chat.subagentes;
  const web = JSON.parse(readFileSync(`messages/${l}/panelsChat.json`, "utf8"));
  expect(movil).toMatchObject({ status: web.subagent.status, steps: web.subagent.steps, stop: web.subagent.stop, trabajando: web.subagent.liveBar, worktree: web.subagent.worktree, origen: web.turn.fromSubagents });
 }
});
