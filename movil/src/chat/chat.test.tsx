import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PantallaChat } from "./chat";
import type { Chat } from "./use-chat";
import type { ElementoDelHilo } from "./hilo";
vi.mock("use-intl", () => ({ useTranslations: () => (s: string) => s }));
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
 host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function pintar(elementos: ElementoDelHilo[], trabajando = false, turnoId: string | null = null, abierto = true) {
 const chat = { elementos, trabajando, turnoId, pregunta: false, avance: null, progreso: [], mandar: vi.fn(), reintentar: vi.fn(), borrar: vi.fn() } as unknown as Chat;
 act(() => root.render(<PantallaChat abierto={abierto} chat={chat} cliente={cliente} projectId="p1" idioma="es" conPip={false} onCerrar={cerrar} onLlamar={vi.fn()} onVerPagina={vi.fn()} />));
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
