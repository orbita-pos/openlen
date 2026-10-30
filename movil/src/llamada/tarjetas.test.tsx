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
