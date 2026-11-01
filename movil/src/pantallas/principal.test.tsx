import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PantallaPrincipal } from "./principal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("use-intl", () => ({ useTranslations: () => (s: string) => s }));
const aviso = vi.hoisted(() => ({ abrir: null as null | ((id: string) => void) }));
vi.mock("../avisos/use-avisos", () => ({ useAvisos: (o: { onAbrirProyecto: (id: string) => void }) => { aviso.abrir = o.onAbrirProyecto; return { estado:"noDisponible" }; } }));
vi.mock("../cara", () => ({ Cara: () => null }));
vi.mock("../hoja-deslizable", () => ({ useHojaDeslizable: () => null }));
vi.mock("../atras", () => ({ useAtras: () => {} }));
vi.mock("../llamada/llamada", () => ({ Llamada: ({ projectId }: { projectId: string }) => <div data-llamada={projectId} /> }));
vi.mock("../chat/chat", () => ({ PantallaChat: () => null }));
vi.mock("../chat/use-chat", () => ({ useChat: () => ({ trabajando: false }) }));

let root: Root;
let host: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  localStorage.clear();
});

describe("recuperar la carga de proyectos", () => {
  it.each(["http", "json", "detalle"])("permite reintentar tras fallo de %s", async (fallo) => {
    let falla = true;
    const proyecto = { id: "p1", title: "Mi página", subdomain: null, publishedAt: null, updatedAt: "2026-10-25", chatHistory: [] };
    const pedir = vi.fn(async (ruta: string) => {
      if (ruta === "/api/projects") {
        if (falla && fallo === "http") return new Response("error", { status: 500 });
        if (falla && fallo === "json") return new Response("no es JSON");
        return Response.json({ projects: [proyecto] });
      }
      if (ruta.endsWith("/preview")) return Response.json({ token: "vista", enabled: true });
      if (falla && fallo === "detalle") return new Response("error", { status: 500 });
      return Response.json({ project: proyecto });
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />);
    });
    expect(host.textContent).toContain("reintentar");
    falla = false;
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(host.textContent).toContain("Mi página");
    expect(host.textContent).not.toContain("reintentar");
  });
});

it("la espera de la lista siempre muestra un estado visible", async () => {
 const pedir = vi.fn(() => new Promise<Response>(() => {}));
 host = document.createElement("div"); document.body.append(host); root = createRoot(host);
 await act(async () => root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />));
 expect(host.querySelector('[role="status"]')).not.toBeNull();
});
it("una vista previa fallida permite reintentar sin recargar la lista", async () => {
 let falla = true;
 const proyecto = { id: "p1", title: "Página", subdomain: null, publishedAt: null, updatedAt: "2026-10-29", chatHistory: [] };
 const pedir = vi.fn(async (ruta: string) => ruta === "/api/projects" ? Response.json({ projects: [proyecto] }) : ruta.endsWith("/preview") ? (falla ? new Response(null, { status:503 }) : Response.json({ enabled:true, token:"vista" })) : Response.json({ project:proyecto }));
 host = document.createElement("div"); document.body.append(host); root = createRoot(host);
 await act(async () => root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />));
 const boton = host.querySelector<HTMLButtonElement>('.app-vista-estado button'); expect(boton).not.toBeNull();
 falla = false; await act(async () => boton!.click());
 expect(host.querySelector('iframe.app-vista')).not.toBeNull();
 expect(pedir.mock.calls.filter(([ruta]) => ruta === "/api/projects")).toHaveLength(1);
});

it("cambiar de página no arrastra una llamada ni la reinicia en el proyecto nuevo", async () => {
 let completar!: (r: Response) => void;
 const uno = { id:"p1", title:"Página uno", subdomain:null, publishedAt:null, updatedAt:"2026-10-29", chatHistory:[] };
 const dos = { ...uno, id:"p2", title:"Página dos" };
 const pedir = vi.fn(async (ruta: string) => ruta === "/api/projects" ? Response.json({projects:[uno,dos]}) : ruta.endsWith("/preview") ? Response.json({enabled:true,token:"vista"}) : ruta.endsWith("/p2") ? new Promise<Response>(r => { completar = r; }) : Response.json({project:uno}));
 host = document.createElement("div"); document.body.append(host); root = createRoot(host);
 await act(async () => root.render(<PantallaPrincipal cliente={{pedir,avisarAlCerrar:vi.fn()}} idioma="es" onSalir={vi.fn()}/>));
 const llamar = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'llamar')!;
 await act(async () => llamar.click()); expect(host.querySelector('[data-llamada="p1"]')).not.toBeNull();
 await act(async () => host.querySelector<HTMLButtonElement>('.lm-bar-t')!.click());
 await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.app-selector button')].find(b => b.textContent === 'Página dos')!.click());
 expect(host.querySelector('[data-llamada]')).toBeNull(); expect(host.querySelector('[role="status"]')).not.toBeNull();
 await act(async () => completar(Response.json({project:dos})));
 expect(host.textContent).toContain('Página dos'); expect(host.querySelector('[data-llamada]')).toBeNull();
});

it.each([200, 503])("releer la lista por un aviso de la misma página conserva la llamada montada (%s)", async (status) => {
 const proyecto = { id:"p1", title:"Página", subdomain:null, publishedAt:null, updatedAt:"2026-10-29", chatHistory:[] };
 let lectura = 0, completar!: (r: Response) => void;
 const pedir = vi.fn(async (ruta: string) => ruta === "/api/projects" ? Response.json({projects:[proyecto]}) : ruta.endsWith("/preview") ? Response.json({enabled:true,token:"vista"}) : (++lectura === 1 ? Response.json({project:proyecto}) : new Promise<Response>(r => { completar = r; })));
 host = document.createElement('div'); document.body.append(host); root = createRoot(host);
 await act(async () => root.render(<PantallaPrincipal cliente={{pedir,avisarAlCerrar:vi.fn()}} idioma="es" onSalir={vi.fn()}/>));
 await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'llamar')!.click());
 const llamada = host.querySelector('[data-llamada="p1"]');
 await act(async () => aviso.abrir!('p1'));
 expect(host.querySelector('[data-llamada="p1"]')).toBe(llamada);
 await act(async () => completar(status === 200 ? Response.json({project:proyecto}) : new Response(null, {status})));
 expect(host.querySelector('[data-llamada="p1"]')).toBe(llamada);
});

it("sin páginas ofrece actualizar y descubre las creadas al volver a la app", async () => {
 let disponibles = false;
 const proyecto = {id:"p1",title:"Mi primera página",subdomain:null,publishedAt:null,updatedAt:"2026-10-29",chatHistory:[]};
 const pedir = vi.fn(async (ruta: string) => ruta === "/api/projects" ? Response.json({projects:disponibles?[proyecto]:[]}) : ruta.endsWith("/preview") ? Response.json({enabled:true,token:"vista"}) : Response.json({project:proyecto}));
 host = document.createElement('div'); document.body.append(host); root = createRoot(host);
 await act(async () => root.render(<PantallaPrincipal cliente={{pedir,avisarAlCerrar:vi.fn()}} idioma="es" onSalir={vi.fn()}/>));
 expect([...host.querySelectorAll('button')].some(b => b.textContent === 'actualizarPaginas')).toBe(true);
 disponibles = true;
 const visibilidad = vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
 try { await act(async () => document.dispatchEvent(new Event('visibilitychange'))); }
 finally { visibilidad.mockRestore(); }
 expect(host.textContent).toContain('Mi primera página');
});

// «Entregado» and «Tareas» (spec local 2026-10-31-len-movil, §5.3–5.4): two entries in the selector, above the projects.
it("the selector opens Delivered and Tasks", async () => {
 const proyecto = { id:"p1", title:"Página", subdomain:null, publishedAt:null, updatedAt:"2026-10-29", chatHistory:[] };
 const pedir = vi.fn(async (ruta: string) => ruta === "/api/projects" ? Response.json({projects:[proyecto]}) : ruta.endsWith("/preview") ? Response.json({enabled:true,token:"vista"}) : ruta === "/api/movil/tasks" ? Response.json({needsYou:[],working:[],scheduled:[],resolved:[]}) : ruta.startsWith("/api/movil/delivered") ? Response.json({items:[]}) : Response.json({project:proyecto}));
 host = document.createElement("div"); document.body.append(host); root = createRoot(host);
 await act(async () => root.render(<PantallaPrincipal cliente={{pedir,avisarAlCerrar:vi.fn()}} idioma="es" onSalir={vi.fn()}/>));
 await act(async () => host.querySelector<HTMLButtonElement>(".lm-bar-t")!.click());
 const botones = [...host.querySelectorAll<HTMLButtonElement>(".app-selector button")].map(b => b.textContent);
 expect(botones.indexOf("entregado")).toBeGreaterThanOrEqual(0);
 expect(botones.indexOf("tareas")).toBeLessThan(botones.indexOf("Página"));
 await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".app-selector button")].find(b => b.textContent === "tareas")!.click());
 expect(host.querySelector("#tareas-titulo")).not.toBeNull();
 expect(pedir).toHaveBeenCalledWith("/api/movil/tasks");
});
