import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { tintOf } from "@/lib/figure/tint";
import { BASE } from "../config";
import { plataforma } from "../sesion/plataforma";
import { PantallaPrincipal } from "./principal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("use-intl", () => ({ useTranslations: () => (s: string) => s }));
const aviso = vi.hoisted(() => ({ abrir: null as null | ((id: string) => void), entregado: null as null | ((id: string, url: string) => void), asistente: null as null | ((id: string, donde: { parte: string; tarjeta: string | null }) => void) }));
vi.mock("../avisos/use-avisos", () => ({ useAvisos: (o: { onAbrirProyecto: (id: string) => void; onAbrirEntregado?: (id: string, url: string) => void; onAbrirAsistente?: (id: string, donde: { parte: string; tarjeta: string | null }) => void }) => { aviso.abrir = o.onAbrirProyecto; aviso.entregado = o.onAbrirEntregado ?? null; aviso.asistente = o.onAbrirAsistente ?? null; return { estado:"noDisponible" }; } }));
// Her tab (phase 5) is tested on its own (../asistente/assistant-tab.test.tsx): here, only that it opens, and on what.
const montajes = vi.hoisted(() => ({ n: 0 }));
vi.mock("../asistente/assistant-tab", async () => { const { useEffect } = await import("react"); return { AssistantTab: (p: { asistente: { id: string }; parte?: string; tarjeta?: string | null; onHablar: () => void; onVerLen: (projectId: string) => void }) => <div data-assistant-tab={p.asistente.id} data-parte={p.parte ?? ""} data-tarjeta={p.tarjeta ?? ""}><button data-tab-hablar="" onClick={p.onHablar} /><button data-tab-ver-len="" onClick={() => p.onVerLen("p1")} /><Montado /></div> }; function Montado() { useEffect(() => { montajes.n++; }, []); return null; } });
vi.mock("../viewer/phone-viewer", () => ({ PhoneViewer: ({ file }: { file: { name: string; preview?: string } }) => <div data-viewer={file.name} data-preview={file.preview ?? ""} /> }));
vi.mock("../cara", () => ({ Cara: () => null }));
// The welcome creator has its own test (../asistente/welcome-creator.test.tsx): here, when it shows and on what.
const bienvenida = vi.hoisted(() => ({ props: null as null | { projectId: string; onCreated: (id: string) => void; onNotNow: () => void } }));
vi.mock("../asistente/welcome-creator", () => ({ WelcomeCreator: (p: { projectId: string; onCreated: (id: string) => void; onNotNow: () => void }) => { bienvenida.props = p; return <div data-welcome={p.projectId} />; } }));
// What Len did has its own test (../asistente/len-turn-view.test.tsx): here, which row opens.
vi.mock("../asistente/len-turn-view", () => ({ LenTurnView: (p: { fila: string; projectTitle: string; onAnswer?: (text: string) => void }) => <div data-len-turn={p.fila} data-len-turn-project={p.projectTitle}>{p.onAnswer && <button data-len-turn-answer="" onClick={() => p.onAnswer!("Azul")} />}</div> }));
// Delivered has its own test: here, where «Ver en el chat» leads.
const entregado = vi.hoisted(() => ({ irAlChat: null as null | ((projectId: string, turno: string) => void) }));
vi.mock("../overview/delivered-tab", () => ({ DeliveredTab: (p: { onIrAlChat: (projectId: string, turno: string) => void }) => { entregado.irAlChat = p.onIrAlChat; return <div data-delivered-tab="" />; } }));
const hoja = vi.hoisted(() => ({ alMedir: null as null | ((visibleEncogida: number) => void) }));
vi.mock("../hoja-deslizable", () => ({ useHojaDeslizable: (o: { alMedir?: (v: number) => void }) => { hoja.alMedir = o.alMedir ?? null; return null; } }));
vi.mock("../atras", () => ({ useAtras: () => {} }));
vi.mock("../llamada/llamada", () => ({ Llamada: ({ projectId }: { projectId: string }) => <div data-llamada={projectId} /> }));
const chatProps: { ultimo: Record<string, unknown> | null; ella: Record<string, unknown> | null; len: Record<string, unknown> | null } = { ultimo: null, ella: null, len: null };
vi.mock("../chat/chat", () => ({ PantallaChat: (p: Record<string, unknown>) => { chatProps.ultimo = p; if (p.asistente) chatProps.ella = p; else chatProps.len = p; return null; } }));
// The tool's screen is its own test's (tool-screen.test.tsx): here, which tool opened, where, and its `sendPrompt`.
vi.mock("../herramientas/tool-screen", () => ({
  PantallaHerramienta: ({ tool, proyecto, onPrompt, onCerrar }: { tool: { id: string }; proyecto: { id: string } | null; onPrompt: ((d: string) => void) | null; onCerrar: () => void }) => (
    <div data-herr-abierta={tool.id} data-proyecto={proyecto?.id ?? ""}>{onPrompt && <button data-herr-prompt="" onClick={() => onPrompt("> hola\n\n— Reservas\n")} />}<button data-herr-cerrar="" onClick={onCerrar} /></div>
  ),
}));
// Len's hook watches the project on screen; hers talks to her (spec local 2026-11-16-movil-es-tu-asistente, §5.3).
const chats = vi.hoisted(() => ({ lenTrabajando: false, lenPregunta: false, mandarALen: null as null | ((t: string) => void), deElla: null as Record<string, unknown> | null, elementosDeElla: [] as unknown[], abiertaCon: [] as string[] }));
vi.mock("../chat/use-chat", () => ({
  useChat: (o: Record<string, unknown>) => {
    if (o.assistantId) chats.deElla = o;
    return {
      trabajando: o.assistantId ? false : chats.lenTrabajando,
      progreso: [],
      ...(o.assistantId ? { elementos: chats.elementosDeElla, abrirCon: (t: string) => void chats.abiertaCon.push(t) } : { pregunta: chats.lenPregunta, mandar: (t: string) => chats.mandarALen?.(t) }),
    };
  },
}));

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
it("con la hoja encogida la página acaba encima de ella (se ve hasta su pie); abierta, vuelve a todo el alto", async () => {
 vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
 try {
  const proyecto = { id: "p1", title: "Página", subdomain: null, publishedAt: null, updatedAt: "2026-11-01", chatHistory: [] };
  const pedir = vi.fn(async (ruta: string) => ruta === "/api/projects" ? Response.json({ projects: [proyecto] }) : ruta.endsWith("/preview") ? Response.json({ enabled: true, token: "vista" }) : Response.json({ project: proyecto }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />));
  const sitio = () => host.querySelector<HTMLElement>(".lm-pagehost")!.style.getPropertyValue("--app-hoja");
  act(() => hoja.alMedir!(96));
  expect(sitio()).toBe("0px");
  act(() => host.querySelector<HTMLButtonElement>(".lm-grab")!.click());
  // Mientras baja la hoja, la página no se mueve: se acorta al terminar.
  expect(sitio()).toBe("0px");
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(sitio()).toBe("96px");
  act(() => host.querySelector<HTMLButtonElement>(".lm-grab")!.click());
  expect(sitio()).toBe("0px");
 } finally {
  vi.useRealTimers();
 }
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
 const pedir = vi.fn(async (ruta: string) => ruta === "/api/projects" ? Response.json({projects:[proyecto]}) : ruta.endsWith("/preview") ? Response.json({enabled:true,token:"vista"}) : ruta.startsWith("/api/tools?") ? Response.json({tools:[],paid:true,person:{name:""}}) : ruta === "/api/assistants" ? Response.json({assistants:[]}) : (++lectura === 1 ? Response.json({project:proyecto}) : new Promise<Response>(r => { completar = r; })));
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

// «Entregado» y «Tareas» siguen accesibles desde el selector.
it("the selector opens Delivered and Tasks", async () => {
 const proyecto = { id:"p1", title:"Página", subdomain:null, publishedAt:null, updatedAt:"2026-10-29", chatHistory:[] };
 const pedir = vi.fn(async (ruta: string) => ruta === "/api/projects" ? Response.json({projects:[proyecto]}) : ruta.endsWith("/preview") ? Response.json({enabled:true,token:"vista"}) : ruta === "/api/movil/tasks" ? Response.json({needsYou:[],working:[],scheduled:[],resolved:[]}) : ruta.startsWith("/api/movil/delivered") ? Response.json({items:[]}) : Response.json({project:proyecto}));
 host = document.createElement("div"); document.body.append(host); root = createRoot(host);
 await act(async () => root.render(<PantallaPrincipal cliente={{pedir,avisarAlCerrar:vi.fn()}} idioma="es" onSalir={vi.fn()}/>));
 await act(async () => host.querySelector<HTMLButtonElement>(".lm-bar-t")!.click());
 const botones = [...host.querySelectorAll<HTMLButtonElement>(".app-selector button")].map(b => b.textContent);
 expect(botones.indexOf("entregado")).toBeGreaterThanOrEqual(0);
 expect(botones.indexOf("tareas")).toBeGreaterThan(botones.indexOf("Página"));
 await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".app-selector button")].find(b => b.textContent === "tareas")!.click());
 expect(host.querySelector("#tareas-titulo")).not.toBeNull();
 expect(pedir).toHaveBeenCalledWith("/api/movil/tasks");
});

// The person's tools (spec local 2026-11-04-herramientas-hechas-por-len, §4.14): «Herramientas» beside «Entregado» and
// «Tareas»; with tools switched off on the server the button isn't there.
describe("Herramientas in the selector", () => {
  const proyecto = { id: "p1", title: "Página", subdomain: null, publishedAt: null, updatedAt: "2026-11-05", chatHistory: [] };
  async function paint(tools: Response) {
    const pedir = vi.fn(async (ruta: string) =>
      ruta === "/api/projects"
        ? Response.json({ projects: [proyecto] })
        : ruta.endsWith("/preview")
          ? Response.json({ enabled: true, token: "vista" })
          : ruta.startsWith("/api/tools?")
            ? tools.clone()
            : Response.json({ project: proyecto }),
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".lm-bar-t")!.click());
    return { pedir, botones: () => [...host.querySelectorAll<HTMLButtonElement>(".app-selector button")] };
  }

  it("opens the tab", async () => {
    const { pedir, botones } = await paint(Response.json({ tools: [], paid: true, person: { name: "Ana" } }));
    const b = botones().find((x) => x.textContent === "titulo");
    expect(b).toBeDefined();
    await act(async () => b!.click());
    expect(host.querySelector("#herramientas-titulo")).not.toBeNull();
    expect(pedir).toHaveBeenCalledWith("/api/tools?locale=es");
  });

  it("tools switched off: no button", async () => {
    const { botones } = await paint(Response.json({ error: "tools_off" }, { status: 404 }));
    expect(botones().some((x) => x.textContent === "titulo")).toBe(false);
    expect(botones().some((x) => x.textContent === "entregado")).toBe(true);
  });
});

// A project's tools beside its chat (§4.14): one button each in the sheet's row; a rail tool is the tab's, not here.
describe("a project's tools beside the chat", () => {
  // Closing a panel animates its exit, which asks matchMedia (jsdom has none).
  beforeEach(() => vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })));
  afterEach(() => vi.unstubAllGlobals());
  const proyecto = { id: "p1", title: "Página", subdomain: null, publishedAt: null, updatedAt: "2026-11-05", chatHistory: [] };
  const tool = (id: string, placement: "rail" | "project") => ({ id, projectId: `t-${id}`, title: `Tool ${id}`, description: "", placement, iconUrl: `/api/tools/${id}/icon`, iconTinted: true, frameUrl: "x", frameOrigin: "x", releaseSha: "sha", enabled: true, installedAt: "2026-11-05T10:00:00Z", status: "ok" });
  let herramientas = () => [tool("r", "rail"), tool("q", "project")];
  async function paint() {
    const pedir = vi.fn(async (ruta: string) =>
      ruta === "/api/projects"
        ? Response.json({ projects: [proyecto] })
        : ruta.endsWith("/preview")
          ? Response.json({ enabled: true, token: "vista" })
          : ruta.startsWith("/api/tools?")
            ? Response.json({ tools: herramientas(), paid: true, person: { name: "Ana" } })
            : ruta.startsWith("/api/tools/")
              ? new Response("x", { status: 404 })
              : Response.json({ project: proyecto }),
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />));
    return pedir;
  }
  const lecturas = (pedir: ReturnType<typeof vi.fn>) => pedir.mock.calls.filter((c) => String(c[0]).startsWith("/api/tools?")).length;
  const atajos = () => [...host.querySelectorAll<HTMLButtonElement>(".ent-shortcuts button")].map((b) => b.textContent);

  // Final review, Important 1 (Review Focus 3): a tool removed on the web must not stay as a dead button.
  it("closing a tool screen reads the person's tools again: one removed on the web is gone from the row", async () => {
    herramientas = () => [tool("r", "rail"), tool("q", "project")];
    const pedir = await paint();
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".ent-shortcuts button")].find((b) => b.textContent === "Tool q")!.click());
    herramientas = () => [tool("r", "rail")];
    const antes = lecturas(pedir);
    await act(async () => document.querySelector<HTMLButtonElement>("[data-herr-cerrar]")!.click());
    expect(lecturas(pedir)).toBeGreaterThan(antes);
    expect(atajos()).not.toContain("Tool q");
    herramientas = () => [tool("r", "rail"), tool("q", "project")];
  });

  it("coming back to the app reads the person's tools again", async () => {
    herramientas = () => [tool("r", "rail")];
    const pedir = await paint();
    expect(atajos()).not.toContain("Tool q");
    herramientas = () => [tool("r", "rail"), tool("q", "project")];
    const antes = lecturas(pedir);
    const visibilidad = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    try {
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    } finally {
      visibilidad.mockRestore();
    }
    expect(lecturas(pedir)).toBeGreaterThan(antes);
    expect(atajos()).toContain("Tool q");
  });

  it("a project tool is a button in the sheet's row and opens in this project; a rail tool isn't there", async () => {
    await paint();
    const row = [...host.querySelectorAll<HTMLButtonElement>(".ent-shortcuts button")];
    expect(row.map((b) => b.textContent)).toContain("Tool q");
    expect(row.map((b) => b.textContent)).not.toContain("Tool r");
    await act(async () => row.find((b) => b.textContent === "Tool q")!.click());
    const open = document.querySelector("[data-herr-abierta]");
    expect(open?.getAttribute("data-herr-abierta")).toBe("q");
    expect(open?.getAttribute("data-proyecto")).toBe("p1");
  });

  it("its sendPrompt fills the chat's composer and opens the chat", async () => {
    await paint();
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".ent-shortcuts button")].find((b) => b.textContent === "Tool q")!.click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-herr-prompt]")!.click());
    expect(chatProps.ultimo?.abierto).toBe(true);
    expect((chatProps.ultimo?.borrador as { texto: string } | null)?.texto).toBe("> hola\n\n— Reservas\n");
  });

  // A «Crear» card in the chat (§4.10): «Abrir» opens the tool it installed, read again from the person's tools.
  it("a card's «Abrir» opens the installed tool, with the person's tools read again", async () => {
    await paint();
    const onAbrir = chatProps.ultimo?.onAbrirHerramienta as (id: string) => void;
    await act(async () => onAbrir("q"));
    expect(document.querySelector("[data-herr-abierta]")?.getAttribute("data-herr-abierta")).toBe("q");
    expect(document.querySelector("[data-herr-abierta]")?.getAttribute("data-proyecto")).toBe("p1");
  });

  it("the tab's tool opens with no project", async () => {
    await paint();
    await act(async () => host.querySelector<HTMLButtonElement>(".lm-bar-t")!.click());
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".app-selector button")].find((x) => x.textContent === "titulo")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>("[data-tool-row]")!.click());
    const open = document.querySelector("[data-herr-abierta]");
    expect(open?.getAttribute("data-herr-abierta")).toBe("r");
    expect(open?.getAttribute("data-proyecto")).toBe("");
    expect(document.querySelector("[data-herr-prompt]")).toBeNull();
  });
});

// A finished task's push opens what Len delivered (spec local 2026-10-31-len-movil, §5.4).
it("the push of a finished task opens the delivered file in the viewer, with its preview", async () => {
 const proyecto = { id:"p1", title:"Página", subdomain:null, publishedAt:null, updatedAt:"2026-10-29", chatHistory:[] };
 const url = "/api/projects/p1/deliveries/t1/ab12cd34-deck.pptx";
 const pedir = vi.fn(async (ruta: string) => ruta === "/api/projects" ? Response.json({projects:[proyecto]}) : ruta.endsWith("/preview") ? Response.json({enabled:true,token:"vista"}) : ruta.startsWith("/api/movil/delivered") ? Response.json({items:[{ id:"d1", projectId:"p1", turnId:"t1", name:"deck.pptx", url, previewUrl:"/api/projects/p1/deliveries/t1/ef56ab78-deck.pptx.preview.pdf", size:9, contentType:"x", description:null, createdAt:"2026-11-10T18:00:00Z", projectTitle:"Página" }]}) : Response.json({project:proyecto}));
 host = document.createElement("div"); document.body.append(host); root = createRoot(host);
 await act(async () => root.render(<PantallaPrincipal cliente={{pedir,avisarAlCerrar:vi.fn()}} idioma="es" onSalir={vi.fn()}/>));
 await act(async () => aviso.entregado!("p1", url));
 const visor = document.body.querySelector("[data-viewer]");
 expect(visor?.getAttribute("data-viewer")).toBe("deck.pptx");
 expect(visor?.getAttribute("data-preview")).toBe("/api/projects/p1/deliveries/t1/ef56ab78-deck.pptx.preview.pdf");
});

// The person's own assistant (spec local 2026-11-06-asistente-propio, §4.6.3, phase 5): a button with her name beside
// «Entregado» and «Tareas», only when she exists; her notices open her tab.
describe("her tab in the selector", () => {
  // Closing a panel (the list of agents, on choosing one) animates its exit, which asks matchMedia (jsdom has none).
  beforeEach(() => vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })));
  const proyecto = { id: "p1", title: "Página", subdomain: null, publishedAt: null, updatedAt: "2026-11-09", chatHistory: [] };
  const LUCIA = { id: "a1", name: "Lucía", slug: "lucia", look: { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" } as const, color: "#f4a48b", tone: "friendly", projectId: "p1", projectIds: ["p1"] };
  async function paint(asistentes: unknown[], { agents = true }: { agents?: boolean } = {}) {
    const pedir = vi.fn(async (ruta: string) =>
      ruta === "/api/projects"
        ? Response.json({ projects: [proyecto] })
        : ruta.endsWith("/preview")
          ? Response.json({ enabled: true, token: "vista" })
          : ruta === "/api/assistants"
            ? Response.json({ enabled: true, agents, assistants: asistentes })
            : ruta.startsWith("/api/tools?")
              ? Response.json({ tools: [], paid: true, person: { name: "Ana" } })
              : Response.json({ project: proyecto }),
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".lm-bar-t")!.click());
    return { pedir, botones: () => [...host.querySelectorAll<HTMLButtonElement>(".app-selector button")] };
  }

  it("🔴 her button is in the sheet only when she exists, and opens her tab", async () => {
    const { botones } = await paint([LUCIA]);
    const b = botones().find((x) => x.textContent === "Lucía");
    expect(b).toBeDefined();
    await act(async () => b!.click());
    expect(host.querySelector('[data-assistant-tab="a1"]')).not.toBeNull();
  });

  // Len móvil is her app (spec local 2026-11-16-movil-es-tu-asistente, §5.1, §5.2): another one is chosen here.
  it("🔴 choosing another assistant in «Tus páginas» paints the app her color and keeps her on this phone", async () => {
    const MARTA = { ...LUCIA, id: "a2", name: "Marta", slug: "marta", color: "#3b82f6", look: { ...LUCIA.look, color: "#3b82f6" } };
    const { botones } = await paint([LUCIA, MARTA]);
    expect(document.documentElement.style.getPropertyValue("--her-tint")).toBe(tintOf("#f4a48b")!.tint);
    // Agents for everyone, delivery 4 (§6.8): with two or more, through the list of agents.
    await act(async () => botones().find((x) => x.hasAttribute("data-agentes"))!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agente="a2"]')!.click());
    expect(document.documentElement.style.getPropertyValue("--her-tint")).toBe(tintOf("#3b82f6")!.tint);
    expect(localStorage.getItem("len-asistente")).toBe("a2");
    expect(host.querySelector('[data-assistant-tab="a2"]')).toBeNull();
  });

  // Agents for everyone, delivery 4 (spec local 2026-11-19-agentes-para-todos, §6.8): «una lista para elegir con cuál
  // hablar» instead of one button per assistant.
  it("🔴 with two or more, one «Agentes» button: its list makes the one you tap the app's and opens her chat", async () => {
    const MARTA = { ...LUCIA, id: "a2", name: "Marta", slug: "marta", color: "#3b82f6", look: { ...LUCIA.look, color: "#3b82f6" } };
    const { botones } = await paint([LUCIA, MARTA]);
    expect(botones().some((x) => x.textContent === "Lucía" || x.textContent === "Marta")).toBe(false);
    await act(async () => botones().find((x) => x.hasAttribute("data-agentes"))!.click());
    expect([...host.querySelectorAll<HTMLElement>("[data-agente]")].map((x) => x.dataset.agente)).toEqual(["a1", "a2"]);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agente="a2"]')!.click());
    expect(localStorage.getItem("len-asistente")).toBe("a2");
    expect(document.documentElement.style.getPropertyValue("--her-tint")).toBe(tintOf("#3b82f6")!.tint);
    expect(chatProps.ella).toMatchObject({ abierto: true, asistente: { name: "Marta" } });
  });

  it("«Crear un agente» opens OpenLen's home on the agent kind; with agents off it isn't there", async () => {
    const MARTA = { ...LUCIA, id: "a2", name: "Marta", slug: "marta" };
    const abrir = vi.spyOn(plataforma, "abrirNavegador").mockResolvedValue(undefined);
    const { botones } = await paint([LUCIA, MARTA]);
    await act(async () => botones().find((x) => x.hasAttribute("data-agentes"))!.click());
    await act(async () => host.querySelector<HTMLButtonElement>("[data-crear-agente]")!.click());
    expect(abrir).toHaveBeenCalledWith(`${BASE}/?kind=agent`);
    act(() => root.unmount());
    host.remove();
    const off = await paint([LUCIA, MARTA], { agents: false });
    await act(async () => off.botones().find((x) => x.hasAttribute("data-agentes"))!.click());
    expect(host.querySelector("[data-agente]")).not.toBeNull();
    expect(host.querySelector("[data-crear-agente]")).toBeNull();
    abrir.mockRestore();
  });

  // Final review of the minors pass: with pages, an agent of the space chosen here still offered «Ver en tu página» after
  // writing in the space, and it closed her chat onto a page she has nothing to do with.
  it("🔴 «Ver en tu página» is offered in her chat only when she lives in the page on screen", async () => {
    const CHEF = { ...LUCIA, id: "a3", name: "Chef Rosa", slug: "chef-rosa", projectId: "space", projectIds: ["space"] };
    localStorage.setItem("len-asistente", "a3");
    await paint([CHEF, LUCIA]);
    expect(chatProps.ella).toMatchObject({ asistente: { name: "Chef Rosa" } });
    expect(chatProps.ella).not.toHaveProperty("onVerPagina");
    act(() => root.unmount());
    host.remove();
    localStorage.setItem("len-asistente", "a1");
    await paint([CHEF, LUCIA]);
    expect(chatProps.ella).toMatchObject({ asistente: { name: "Lucía" } });
    expect(chatProps.ella).toHaveProperty("onVerPagina");
  });

  // Delivery 4's deferred minor M4: a browser that didn't open said nothing; «Abrir OpenLen» shows the no-network screen.
  it("🔴 «Crear un agente» that can't open the browser says so, as «Abrir OpenLen» does", async () => {
    const MARTA = { ...LUCIA, id: "a2", name: "Marta", slug: "marta" };
    const abrir = vi.spyOn(plataforma, "abrirNavegador").mockRejectedValue(new Error("no browser"));
    const { botones } = await paint([LUCIA, MARTA]);
    await act(async () => botones().find((x) => x.hasAttribute("data-agentes"))!.click());
    await act(async () => host.querySelector<HTMLButtonElement>("[data-crear-agente]")!.click());
    await act(async () => {});
    expect(host.textContent).toContain("sinRed");
    abrir.mockRestore();
  });

  it("with no assistant, the app keeps Len's orange", async () => {
    await paint([]);
    expect(document.documentElement.style.getPropertyValue("--her-tint")).toBe("");
  });

  it("no assistant (or assistants off): no button", async () => {
    const { botones } = await paint([]);
    expect(botones().some((x) => x.textContent === "Lucía")).toBe(false);
    expect(botones().some((x) => x.textContent === "entregado")).toBe(true);
  });

  it("🔴 a notice of hers opens her tab on its part and card", async () => {
    await paint([LUCIA]);
    await act(async () => aviso.asistente!("a1", { parte: "pedidos", tarjeta: "c1" }));
    await act(async () => {});
    const tab = host.querySelector('[data-assistant-tab="a1"]');
    expect(tab?.getAttribute("data-parte")).toBe("pedidos");
    expect(tab?.getAttribute("data-tarjeta")).toBe("c1");
  });

  // Review Focus 2: deleted after the notice, she still opens — her tab says she isn't there — never a blank screen.
  it("🔴 a notice of an assistant deleted since still opens her tab, which says so", async () => {
    await paint([LUCIA]);
    await act(async () => aviso.asistente!("a-borrada", { parte: "pedidos", tarjeta: "c1" }));
    await act(async () => {});
    expect(host.querySelector('[data-assistant-tab="a-borrada"]')).not.toBeNull();
  });
});

// Final review (phase 5): her chat is the main screen's, over her tab and outside it (I1); a notice reopens her tab on
// its part (I3); a deleted one's turn notice never opens an empty chat (M2); «Ver a Len» goes to Len's chat (I2).
describe("her chat and her notices", () => {
  const proyecto = { id: "p1", title: "Página", subdomain: null, publishedAt: null, updatedAt: "2026-11-09", chatHistory: [] };
  const LUCIA = { id: "a1", name: "Lucía", slug: "lucia", look: { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" } as const, color: "#f4a48b", tone: "friendly", projectId: "p1", projectIds: ["p1"] };
  async function paint() {
    const pedir = vi.fn(async (ruta: string) =>
      ruta === "/api/projects"
        ? Response.json({ projects: [proyecto] })
        : ruta.endsWith("/preview")
          ? Response.json({ enabled: true, token: "vista" })
          : ruta === "/api/assistants"
            ? Response.json({ assistants: [LUCIA] })
            : ruta === "/api/assistants/a1/chat"
              ? Response.json({ chatHistory: [] })
              : ruta.startsWith("/api/tools?")
                ? Response.json({ tools: [], paid: true, person: { name: "Ana" } })
                : Response.json({ project: proyecto }),
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />));
    return { pedir };
  }
  const suChat = () => (chatProps.ultimo?.asistente ? chatProps.ultimo : null);

  // Len móvil is her app (spec local 2026-11-16-movil-es-tu-asistente, §5.7): «Hablar» closes her tab and opens THE chat.
  it("🔴 «Hablar» closes her tab and opens her chat, the main screen's one, and reads her conversation", async () => {
    // Closing a panel asks whether motion is reduced (panel-animado.tsx).
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { pedir } = await paint();
    await act(async () => aviso.asistente!("a1", { parte: "conversaciones", tarjeta: null }));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-tab-hablar]")!.click());
    await act(async () => {});
    expect(suChat()).toMatchObject({ abierto: true, projectId: "p1", cardsProjectId: "p1", asistente: { name: "Lucía", color: "#f4a48b", look: { shape: "drop", color: "#f4a48b" } } });
    expect(host.querySelector('[data-assistant-tab="a1"]')).toBeNull();
    expect(pedir).toHaveBeenCalledWith("/api/assistants/a1/chat");
  });

  it("🔴 a turn notice of hers opens her chat", async () => {
    await paint();
    await act(async () => aviso.asistente!("a1", { parte: "hablar", tarjeta: null }));
    await act(async () => {});
    expect(suChat()).toMatchObject({ abierto: true });
  });

  it("🔴 a second notice for her open tab opens it afresh on its part", async () => {
    await paint();
    montajes.n = 0;
    await act(async () => aviso.asistente!("a1", { parte: "conversaciones", tarjeta: null }));
    await act(async () => aviso.asistente!("a1", { parte: "pedidos", tarjeta: "c9" }));
    await act(async () => {});
    const tab = host.querySelector('[data-assistant-tab="a1"]');
    expect(tab?.getAttribute("data-parte")).toBe("pedidos");
    expect(tab?.getAttribute("data-tarjeta")).toBe("c9");
    // Mounted afresh: its views and lists are the notice's, never the ones it had.
    expect(montajes.n).toBe(2);
  });

  it("🔴 a turn notice of one deleted since opens her tab, never an empty chat", async () => {
    await paint();
    await act(async () => aviso.asistente!("a-borrada", { parte: "hablar", tarjeta: null }));
    await act(async () => {});
    expect(host.querySelector('[data-assistant-tab="a-borrada"]')).not.toBeNull();
    expect(suChat()?.abierto ?? false).toBe(false);
  });
});

describe("Len móvil is her app: her sheet and her chat over your page (spec local 2026-11-16-movil-es-tu-asistente, §5.3)", () => {
  const proyecto = { id: "p1", title: "Página", subdomain: null, publishedAt: null, updatedAt: "2026-11-09", chatHistory: [] };
  const LUCIA = { id: "a1", name: "Lucía", slug: "lucia", look: { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" } as const, color: "#f4a48b", tone: "friendly", projectId: "p1", projectIds: ["p1"] };
  beforeEach(() => {
    chatProps.ella = null;
    chatProps.len = null;
    chats.lenTrabajando = false;
    chats.lenPregunta = false;
    chats.mandarALen = null;
    chats.deElla = null;
    chats.elementosDeElla = [];
  });
  async function paint(asistentes: unknown[] = [LUCIA]) {
    const pedir = vi.fn(async (ruta: string) =>
      ruta === "/api/projects"
        ? Response.json({ projects: [proyecto] })
        : ruta.endsWith("/preview")
          ? Response.json({ enabled: true, token: "vista" })
          : ruta === "/api/assistants"
            ? Response.json({ enabled: true, assistants: asistentes })
            : ruta === "/api/assistants/a1/chat"
              ? Response.json({ chatHistory: [] })
              : ruta.startsWith("/api/tools?")
                ? Response.json({ tools: [], paid: true, person: { name: "Ana" } })
                : Response.json({ project: proyecto }),
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />));
    await act(async () => {});
    return { pedir };
  }
  const hoja = () => host.querySelector<HTMLElement>(".app-main-sheet")!;
  const botonesDeLaHoja = () => [...hoja().querySelectorAll<HTMLButtonElement>("button")];

  it("🔴 one chat: the sheet is hers, with no call, and asking for a change opens a chat named Lucía", async () => {
    await paint();
    expect(hoja().querySelector(".lm-who-t b")?.textContent).toBe("Lucía");
    expect(botonesDeLaHoja().some((b) => b.textContent?.includes("llamar"))).toBe(false);
    await act(async () => botonesDeLaHoja().find((b) => b.textContent?.includes("pedirCambio"))!.click());
    expect(chatProps.ella).toMatchObject({ abierto: true, projectId: "p1", cardsProjectId: "p1", asistente: { name: "Lucía" } });
    expect(chatProps.len).toBeNull();
    expect(chats.deElla).toMatchObject({ assistantId: "a1", projectId: "p1", viewingProjectId: "p1" });
  });

  it("while Len works on the page, her sheet says so", async () => {
    chats.lenTrabajando = true;
    await paint();
    expect(hoja().textContent).toContain("lenTrabajando");
  });

  // Final review, I2: a Len turn her ask_len started after the page loaded is Len working on this page — the sheet says so.
  it("🔴 Len working on her request for this page: her sheet says so, with his steps", async () => {
    chats.elementosDeElla = [{ clave: "e1:lenPedidos", t: 1, tipo: "lenPedidos", refs: [{ filaId: "f1", projectId: "p1" }] }];
    const pedir = vi.fn(async (ruta: string) =>
      ruta === "/api/projects"
        ? Response.json({ projects: [proyecto] })
        : ruta.endsWith("/preview")
          ? Response.json({ enabled: true, token: "vista" })
          : ruta === "/api/assistants"
            ? Response.json({ enabled: true, assistants: [LUCIA] })
            : ruta.startsWith("/api/assistants/a1/len-requests")
              ? Response.json({ requests: [{ filaId: "f1", status: "running", turn: { id: "f1", userText: "", assistantReasoning: "", status: "applied", enCurso: true, actions: [{ tool: "Edit", status: "running", summary: "" }] } }] })
              : ruta.startsWith("/api/assistants/a1/chat")
                ? Response.json({ chatHistory: [] })
                : ruta.startsWith("/api/tools?")
                  ? Response.json({ tools: [], paid: true, person: { name: "Ana" } })
                  : Response.json({ project: proyecto }),
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />));
    await act(async () => {});
    await act(async () => {});
    expect(hoja().textContent).toContain("lenTrabajando");
    const cards = chatProps.ella?.lenCards as { byFila: ReadonlyMap<string, { status: string }> };
    expect(cards.byFila.get("f1")?.status).toBe("running");
  });

  it("no «Tu Len» and no call with her: Len's face isn't hers", async () => {
    await paint();
    await act(async () => host.querySelector<HTMLButtonElement>(".lm-bar-t")!.click());
    expect([...host.querySelectorAll<HTMLButtonElement>(".app-selector button")].some((b) => b.textContent === "tuLen")).toBe(false);
    expect(host.querySelector("[data-llamada]")).toBeNull();
  });

  it("her chat's Len cards are titled by their project", async () => {
    await paint();
    const cards = chatProps.ella?.lenCards as { projectTitle: (id: string) => string };
    expect(cards.projectTitle("p1")).toBe("Página");
  });

  it("🔴 a Len card of this page that ends reloads the page (its delivery shows); one of another page doesn't", async () => {
    vi.useFakeTimers();
    try {
      chats.elementosDeElla = [{ clave: "e1:lenPedidos", t: 1, tipo: "lenPedidos", refs: [{ filaId: "f1", projectId: "p1" }, { filaId: "f2", projectId: "p9" }] }];
      let lecturas = 0;
      const pedir = vi.fn(async (ruta: string) =>
        ruta === "/api/projects"
          ? Response.json({ projects: [proyecto] })
          : ruta.endsWith("/preview")
            ? Response.json({ enabled: true, token: "vista" })
            : ruta === "/api/assistants"
              ? Response.json({ enabled: true, assistants: [LUCIA] })
              : ruta.startsWith("/api/assistants/a1/len-requests")
                ? Response.json({ requests: lecturas++ === 0 ? [{ filaId: "f1", status: "running" }, { filaId: "f2", status: "running" }] : [{ filaId: "f1", status: "done" }, { filaId: "f2", status: "running" }] })
                : ruta.startsWith("/api/assistants/a1/chat")
                  ? Response.json({ chatHistory: [] })
                  : ruta.startsWith("/api/tools?")
                    ? Response.json({ tools: [], paid: true, person: { name: "Ana" } })
                    : Response.json({ project: proyecto }),
      );
      host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);
      await act(async () => root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />));
      await act(async () => {});
      const reads = () => pedir.mock.calls.filter(([r]) => r === "/api/projects/p1").length;
      const before = reads();
      await act(async () => vi.advanceTimersByTime(4000));
      await act(async () => {});
      expect(reads()).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("🔴 «Ver lo que hizo Len» on a card opens what he did, never his chat", async () => {
    await paint();
    const cards = chatProps.ella?.lenCards as { onOpen: (r: { filaId: string; projectId: string }) => void };
    await act(async () => cards.onOpen({ filaId: "f1", projectId: "p1" }));
    expect(host.querySelector('[data-len-turn="f1"]')?.getAttribute("data-len-turn-project")).toBe("Página");
    expect(chatProps.len).toBeNull();
  });

  // Deferred minors of the final review: «Antes / Ahora» of a card, a card of a deleted project, Len's question.
  it("🔴 «Antes / Ahora» on a card compares what that card's turn changed", async () => {
    const { pedir } = await paint();
    const cards = chatProps.ella?.lenCards as { onCompare: (r: { filaId: string; projectId: string }) => void };
    await act(async () => cards.onCompare({ filaId: "f1", projectId: "p1" }));
    await act(async () => {});
    expect(pedir).toHaveBeenCalledWith("/api/movil/entrega?project=p1&fila=f1");
  });

  it("🔴 a card of a project no longer in your list: it says so, and opening it leaves you where you are", async () => {
    // Since the final review's I3, «gone» is said once the list, read again, still hasn't it (a new one isn't in it yet).
    chats.elementosDeElla = [{ clave: "t9:lenPedidos", t: 1, tipo: "lenPedidos", refs: [{ filaId: "f2", projectId: "p9" }] }];
    const { pedir } = await paint();
    await act(async () => {});
    const cards = () => chatProps.ella?.lenCards as { projectGone: (id: string) => boolean; onCompare: (r: { filaId: string; projectId: string }) => void };
    expect(cards().projectGone("p1")).toBe(false);
    expect(cards().projectGone("p9")).toBe(true);
    chats.elementosDeElla = [];
    await act(async () => cards().onCompare({ filaId: "f2", projectId: "p9" }));
    await act(async () => {});
    expect(pedir.mock.calls.some(([r]) => String(r).includes("p9"))).toBe(false);
    expect(host.querySelector(".app-main-sheet")).not.toBeNull();
  });

  it("🔴 answering Len's question from what he did sends it to Len, and closes it", async () => {
    await paint();
    const enviado = vi.fn();
    chats.mandarALen = enviado;
    const cards = chatProps.ella?.lenCards as { onOpen: (r: { filaId: string; projectId: string }) => void };
    await act(async () => cards.onOpen({ filaId: "f1", projectId: "p1" }));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-len-turn-answer]")!.click());
    expect(enviado).toHaveBeenCalledWith("Azul");
    expect(host.querySelector("[data-len-turn]")).toBeNull();
    expect(chatProps.len).toBeNull();
  });

  it("🔴 Len's own turn on this page ended on a question: her sheet says so, and «Contestar» opens it", async () => {
    chats.lenPregunta = true;
    const asked = { tool: "ask_user_question", status: "done", summary: "", preguntas: [{ id: "q", question: "¿Azul?" }] };
    const conPregunta = { ...proyecto, chatHistory: [{ id: "f5", userText: "encargo", assistantReasoning: "Una duda:", status: "applied", actions: [asked] }] };
    const pedir = vi.fn(async (ruta: string) =>
      ruta === "/api/projects"
        ? Response.json({ projects: [proyecto] })
        : ruta.endsWith("/preview")
          ? Response.json({ enabled: true, token: "vista" })
          : ruta === "/api/assistants"
            ? Response.json({ enabled: true, assistants: [LUCIA] })
            : ruta.startsWith("/api/assistants/a1/chat")
              ? Response.json({ chatHistory: [] })
              : ruta.startsWith("/api/tools?")
                ? Response.json({ tools: [], paid: true, person: { name: "Ana" } })
                : Response.json({ project: conPregunta }),
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />));
    await act(async () => {});
    expect(hoja().textContent).toContain("lenPregunta");
    await act(async () => botonesDeLaHoja().find((b) => b.textContent === "contestar")!.click());
    expect(host.querySelector('[data-len-turn="f5"]')).not.toBeNull();
  });

  it("🔴 «Ver en el chat» from Entregado opens what Len did, not Len's chat", async () => {
    await paint();
    await act(async () => host.querySelector<HTMLButtonElement>(".lm-bar-t")!.click());
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".app-selector button")].find((b) => b.textContent === "entregado")!.click());
    await act(async () => entregado.irAlChat!("p1", "f7"));
    await act(async () => {});
    expect(host.querySelector('[data-len-turn="f7"]')).not.toBeNull();
    expect(chatProps.len).toBeNull();
  });

  describe("a project she doesn't serve (§5.6)", () => {
    const CAFE = { id: "p2", title: "Café", subdomain: null, publishedAt: null, updatedAt: "2026-11-08" };
    const TIENDA = { id: "p9", title: "Tienda", subdomain: null, publishedAt: null, updatedAt: "2026-11-07", compartido: { rol: "editor" } };
    async function paintMany(asistentes: unknown[]) {
      const pedir = vi.fn(async (ruta: string, init?: RequestInit) =>
        ruta === "/api/projects"
          ? Response.json({ projects: [proyecto, CAFE, TIENDA] })
          : ruta.endsWith("/preview")
            ? Response.json({ enabled: true, token: "vista" })
            : ruta === "/api/assistants"
              ? Response.json({ enabled: true, assistants: asistentes })
              : ruta === "/api/assistants/a1/projects" && init?.method === "POST"
                ? Response.json({ projectId: "p2" }, { status: 201 })
                : ruta.startsWith("/api/assistants/a1/chat")
                  ? Response.json({ chatHistory: [] })
                  : ruta.startsWith("/api/tools?")
                    ? Response.json({ tools: [], paid: true, person: { name: "Ana" } })
                    : ruta === "/api/projects/p2"
                      ? Response.json({ project: { ...CAFE, chatHistory: [] } })
                      : ruta === "/api/projects/p9"
                        ? Response.json({ project: { ...TIENDA, chatHistory: [] } })
                        : Response.json({ project: proyecto }),
      );
      host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);
      await act(async () => root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />));
      await act(async () => {});
      await act(async () => host.querySelector<HTMLButtonElement>(".lm-bar-t")!.click());
      return pedir;
    }
    const fila = (id: string) => host.querySelector<HTMLButtonElement>(`.app-selector-lista [data-proyecto="${id}"] button`)!;

    it("abrir un proyecto no cambia su asistente y la asignación se hace desde su hoja", async () => {
      const pedir = await paintMany([LUCIA]);
      expect(fila("p2").textContent).toContain("sinAsistente");
      expect(host.querySelector(".app-selector")?.textContent).not.toContain("queLoAtienda");
      await act(async () => fila("p2").click());
      expect(pedir.mock.calls.some(([r, i]) => r === "/api/assistants/a1/projects" && i?.method === "POST")).toBe(false);
      const boton = host.querySelector<HTMLButtonElement>('[data-junto-hoja="p2"] button')!;
      expect(boton.textContent).toBe("queLoAtienda");
      await act(async () => boton.click());
      const post = pedir.mock.calls.find(([r, i]) => r === "/api/assistants/a1/projects" && (i as RequestInit | undefined)?.method === "POST");
      expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({ projectId: "p2", onPage: false });
      expect(pedir.mock.calls.filter(([r]) => r === "/api/assistants").length).toBeGreaterThan(1);
    });

    it("muestra quién atiende el proyecto y permite cambiar de asistente desde su hoja", async () => {
      const MARTA = { ...LUCIA, id: "a2", name: "Marta", slug: "marta", projectId: "p2", projectIds: ["p2"] };
      await paintMany([LUCIA, MARTA]);
      expect(fila("p2").textContent).toContain("loAtiende");
      await act(async () => fila("p2").click());
      const cambiar = host.querySelector<HTMLButtonElement>('[data-junto-hoja="p2"] button')!;
      expect(cambiar.textContent).toBe("cambiarA");
      await act(async () => cambiar.click());
      expect(localStorage.getItem("len-asistente")).toBe("a2");
    });

    it("someone else's project is only to look at", async () => {
      await paintMany([LUCIA]);
      expect(fila("p9").textContent).toContain("soloParaVer");
      await act(async () => fila("p9").click());
      const junto = host.querySelector<HTMLElement>('[data-junto-hoja="p9"]')!;
      expect(junto.textContent).toBe("soloParaVer");
      expect(junto.querySelector("button")).toBeNull();
    });

    it("🔴 the sheet over a project she doesn't serve offers to take it", async () => {
      localStorage.setItem("len-proyecto", "p2");
      await paintMany([LUCIA]);
      await act(async () => host.querySelector<HTMLButtonElement>(".app-selector .lm-grab")?.click());
      const enLaHoja = host.querySelector<HTMLElement>('.app-main-sheet [data-junto-hoja="p2"]');
      expect(enLaHoja?.querySelector("button")?.textContent).toBe("queLoAtienda");
    });

    it("identifica también los proyectos que ya atiende la asistente actual", async () => {
      await paintMany([LUCIA]);
      expect(fila("p1").textContent).toContain("loAtiende");
    });
  });

  it("🔴 a Len push for a project opens that project with HER chat, never his", async () => {
    await paint();
    await act(async () => (aviso.abrir as unknown as (id: string, panel?: string) => void)("p1", "chat"));
    await act(async () => {});
    expect(chatProps.ella).toMatchObject({ abierto: true, asistente: { name: "Lucía" } });
    expect(chatProps.len).toBeNull();
  });

  it("her face in the bar opens her place", async () => {
    await paint();
    await act(async () => host.querySelector<HTMLButtonElement>(".ent-face-button")!.click());
    expect(host.querySelector('[data-assistant-tab="a1"]')).not.toBeNull();
  });

  describe("meeting her (§5.1)", () => {
    it("🔴 without assistants, the app opens the creator; «Ahora no» leaves today's app with an invitation", async () => {
      await paint([]);
      expect(host.querySelector('[data-welcome="p1"]')).not.toBeNull();
      await act(async () => bienvenida.props!.onNotNow());
      expect(host.querySelector("[data-welcome]")).toBeNull();
      expect(localStorage.getItem("len-bienvenida")).toBe("1");
      expect(hoja().querySelector(".lm-who-t b")?.textContent).toBe("Len");
      const invitar = botonesDeLaHoja().find((b) => b.textContent === "conoceATuAsistente");
      expect(invitar).toBeDefined();
      await act(async () => invitar!.click());
      expect(host.querySelector('[data-welcome="p1"]')).not.toBeNull();
    });

    // Final review, I6.
    it("🔴 while her person's assistants can't be read, no welcome: today's app", async () => {
      const pedir = vi.fn(async (ruta: string) =>
        ruta === "/api/projects"
          ? Response.json({ projects: [proyecto] })
          : ruta.endsWith("/preview")
            ? Response.json({ enabled: true, token: "vista" })
            : ruta === "/api/assistants"
              ? new Response("boom", { status: 500 })
              : ruta.startsWith("/api/tools?")
                ? Response.json({ tools: [], paid: true, person: { name: "Ana" } })
                : Response.json({ project: proyecto }),
      );
      host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);
      await act(async () => root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />));
      await act(async () => {});
      expect(host.querySelector("[data-welcome]")).toBeNull();
      expect(hoja().querySelector(".lm-who-t b")?.textContent).toBe("Len");
    });

    it("🔴 created, the welcome closes even if reading her back fails", async () => {
      let fail = false;
      const pedir = vi.fn(async (ruta: string) =>
        ruta === "/api/projects"
          ? Response.json({ projects: [proyecto] })
          : ruta.endsWith("/preview")
            ? Response.json({ enabled: true, token: "vista" })
            : ruta === "/api/assistants"
              ? fail ? new Response("boom", { status: 500 }) : Response.json({ enabled: true, assistants: [] })
              : ruta.startsWith("/api/tools?")
                ? Response.json({ tools: [], paid: true, person: { name: "Ana" } })
                : Response.json({ project: proyecto }),
      );
      host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);
      await act(async () => root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />));
      await act(async () => {});
      expect(host.querySelector("[data-welcome]")).not.toBeNull();
      fail = true;
      await act(async () => bienvenida.props!.onCreated("a1"));
      expect(host.querySelector("[data-welcome]")).toBeNull();
    });

    it("created, she is the app: chosen on this phone and read again", async () => {
      const { pedir } = await paint([]);
      const reads = () => pedir.mock.calls.filter(([r]) => r === "/api/assistants").length;
      const before = reads();
      await act(async () => bienvenida.props!.onCreated("a1"));
      expect(localStorage.getItem("len-asistente")).toBe("a1");
      expect(reads()).toBe(before + 1);
    });
  });

  it("🔴 the app of today when she isn't there: Len's sheet, his call and his chat", async () => {
    localStorage.setItem("len-bienvenida", "1");
    await paint([]);
    expect(hoja().querySelector(".lm-who-t b")?.textContent).toBe("Len");
    expect(botonesDeLaHoja().some((b) => b.textContent?.includes("llamar"))).toBe(true);
    expect(chatProps.len).not.toBeNull();
    expect(chatProps.ella).toBeNull();
  });
});

it("🔴 the creator's home is a project of yours, never a shared one", async () => {
  const COMPARTIDO = { id: "p9", title: "De Ana", subdomain: null, publishedAt: null, updatedAt: "2026-11-10", compartido: { rol: "editor" }, chatHistory: [] };
  const MIO = { id: "p1", title: "Pan", subdomain: null, publishedAt: null, updatedAt: "2026-11-01", chatHistory: [] };
  localStorage.setItem("len-proyecto", "p9");
  const pedir = vi.fn(async (ruta: string) =>
    ruta === "/api/projects"
      ? Response.json({ projects: [COMPARTIDO, MIO] })
      : ruta.endsWith("/preview")
        ? Response.json({ enabled: true, token: "vista" })
        : ruta === "/api/assistants"
          ? Response.json({ enabled: true, assistants: [] })
          : ruta.startsWith("/api/tools?")
            ? Response.json({ tools: [], paid: true, person: { name: "Ana" } })
            : Response.json({ project: ruta.endsWith("/p9") ? COMPARTIDO : MIO }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />));
  await act(async () => {});
  expect(host.querySelector("[data-welcome]")?.getAttribute("data-welcome")).toBe("p1");
});

// AGENTS FOR EVERYONE, delivery 4 (spec local 2026-11-19-agentes-para-todos, §1 and §6.8): someone who never made a page
// and made an agent opens the phone. Their agents live in their hidden space, which isn't in the list of pages: the app
// is their agents, not «Aún no tienes páginas».
describe("no pages: your agents are the app", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    chatProps.ella = null;
  });
  const look = { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" } as const;
  const CHEF = { id: "a3", name: "Chef Rosa", slug: "chef-rosa", look, color: "#f4a48b", tone: "friendly", projectId: "space", projectIds: ["space"] };
  const ANA = { ...CHEF, id: "a4", name: "Teacher Ana", slug: "teacher-ana" };
  const OVERVIEW = { needsYou: [], working: [], scheduled: [], resolved: [], events: [] };
  async function paint(asistentes: (ruta: string) => Response | Promise<Response>, overview: unknown = OVERVIEW, suChat?: (ruta: string) => Response | undefined) {
    const pedir = vi.fn(async (ruta: string) =>
      suChat?.(ruta) ??
      (ruta === "/api/projects"
        ? Response.json({ projects: [] })
        : ruta === "/api/assistants"
          ? asistentes(ruta)
          : ruta === "/api/movil/tasks"
            ? Response.json(overview)
            : ruta.startsWith("/api/tools?")
              ? Response.json({ tools: [], paid: true, person: { name: "Ana" } })
              : Response.json({ chatHistory: [] })),
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />));
    await act(async () => {});
    return { pedir };
  }
  const agents = (list: unknown[], on = true) => () => Response.json({ enabled: true, agents: on, assistants: list });

  it("🔴 with no pages and two agents, the app lists them and never says you have no pages", async () => {
    await paint(agents([CHEF, ANA]));
    expect(host.querySelector('[data-mode="agents"]')).not.toBeNull();
    expect([...host.querySelectorAll<HTMLElement>("[data-agente]")].map((x) => x.dataset.agente)).toEqual(["a3", "a4"]);
    expect(host.textContent).not.toContain("sinPaginas");
  });

  it("🔴 tapping one opens her chat and keeps her on this phone", async () => {
    await paint(agents([CHEF, ANA]));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agente="a4"]')!.click());
    expect(chatProps.ella).toMatchObject({ abierto: true, asistente: { name: "Teacher Ana" }, projectId: "space" });
    expect(localStorage.getItem("len-asistente")).toBe("a4");
    // Delivery 4's deferred minor M2: with no page, her chat has no «Ver en tu página» to offer.
    expect(chatProps.ella).not.toHaveProperty("onVerPagina");
  });

  // Delivery 1 deferred it: opened first on the phone, a new agent's chat stayed empty — her place on the web sends her
  // file's first message by itself, the phone didn't.
  it("🔴 opening a new agent's chat sends her first message, once", async () => {
    chats.abiertaCon = [];
    await paint(agents([CHEF, ANA]), OVERVIEW, (ruta) => (ruta === "/api/assistants/a4/chat" ? Response.json({ chatHistory: [], startsWith: "¡Hola! Empecemos." }) : undefined));
    expect(chats.abiertaCon).toEqual([]);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agente="a4"]')!.click());
    await act(async () => {});
    expect(chatProps.ella).toMatchObject({ abierto: true, asistente: { name: "Teacher Ana" } });
    expect(chats.abiertaCon).toEqual(["¡Hola! Empecemos."]);
  });

  // Final review of this pass: the app's agent's opening, read while her chat was closed, went to the next one tapped.
  it("🔴 one agent's opening never goes to another: tapping a different one sends nothing of hers", async () => {
    chats.abiertaCon = [];
    await paint(agents([CHEF, ANA]), OVERVIEW, (ruta) => (ruta === "/api/assistants/a3/chat" ? Response.json({ chatHistory: [], startsWith: "Hola, soy Chef Rosa." }) : undefined));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agente="a4"]')!.click());
    await act(async () => {});
    expect(chatProps.ella).toMatchObject({ abierto: true, asistente: { name: "Teacher Ana" } });
    expect(chats.abiertaCon).toEqual([]);
  });

  it("🔴 a turn notice of an agent opens her chat with no pages", async () => {
    await paint(agents([CHEF, ANA]));
    await act(async () => aviso.asistente!("a3", { parte: "hablar", tarjeta: null }));
    await act(async () => {});
    expect(chatProps.ella).toMatchObject({ abierto: true, asistente: { name: "Chef Rosa" } });
  });

  it("🔴 assistants not read yet: loading, never «no pages»; their read failed: today's empty screen", async () => {
    await paint(() => new Promise<Response>(() => {}));
    expect(host.textContent).toContain("cargandoPaginas");
    expect(host.textContent).not.toContain("sinPaginas");
    expect(host.querySelector("[data-agente]")).toBeNull();
    act(() => root.unmount());
    host.remove();
    await paint(() => new Response("no", { status: 500 }));
    expect(host.textContent).toContain("sinPaginas");
  });

  it("no pages and no agents: today's screen, with «Crear un agente» only when agents are on", async () => {
    await paint(agents([]));
    expect(host.textContent).toContain("sinPaginas");
    expect(host.querySelector("[data-crear-agente]")).not.toBeNull();
    act(() => root.unmount());
    host.remove();
    await paint(agents([], false));
    expect(host.textContent).toContain("sinPaginas");
    expect(host.querySelector("[data-crear-agente]")).toBeNull();
  });

  it("🔴 in «Tareas», an agent's run opens her chat", async () => {
    const run = { kind: "run", projectId: "space", projectTitle: "Chef Rosa", agentName: "Chef Rosa", agentSlug: "chef-rosa", text: "Receta", at: "2026-11-21T15:00:00.000Z", open: "chat", outcome: "done" };
    await paint(agents([CHEF, ANA]), { ...OVERVIEW, resolved: [run] });
    await act(async () => host.querySelector<HTMLButtonElement>("[data-atajo-tareas]")!.click());
    await act(async () => {});
    const fila = [...host.querySelectorAll<HTMLButtonElement>(".resumen-fila")].find((b) => b.textContent?.includes("Receta"))!;
    await act(async () => fila.click());
    expect(chatProps.ella).toMatchObject({ abierto: true, asistente: { name: "Chef Rosa" } });
  });

  // Delivery 4's deferred minor M3: an agent made on the web after the app read its list has her runs in «Tareas»; her
  // row closed the panel and opened nothing. The list is read again and her chat opens.
  it("🔴 in «Tareas», the run of an agent made since the app opened: the list is read again and her chat opens", async () => {
    const LUIS = { ...CHEF, id: "a5", name: "Coach Luis", slug: "coach-luis" };
    const run = { kind: "run", projectId: "space", projectTitle: "Coach Luis", agentName: "Coach Luis", agentSlug: "coach-luis", text: "Rutina", at: "2026-11-21T15:00:00.000Z", open: "chat", outcome: "done" };
    let lecturas = 0;
    await paint(() => (++lecturas === 1 ? Response.json({ enabled: true, agents: true, assistants: [CHEF, ANA] }) : Response.json({ enabled: true, agents: true, assistants: [LUIS, CHEF, ANA] })), { ...OVERVIEW, resolved: [run] });
    await act(async () => host.querySelector<HTMLButtonElement>("[data-atajo-tareas]")!.click());
    await act(async () => {});
    const fila = [...host.querySelectorAll<HTMLButtonElement>(".resumen-fila")].find((b) => b.textContent?.includes("Rutina"))!;
    await act(async () => fila.click());
    await act(async () => {});
    expect(chatProps.ella).toMatchObject({ abierto: true, asistente: { name: "Coach Luis" } });
  });

  // Final review I3: with no pages, an agent's `ask_len` starts Len in a new project, which the list read at opening
  // doesn't have. Its card must not say «Esa página ya no está en tu lista»; the list is read again, the app goes to
  // that page, and her chat stays open.
  it("🔴 a Len card of hers for a project not in the list yet: the list is read again, it isn't «gone», her chat stays open", async () => {
    chats.elementosDeElla = [];
    let lecturas = 0;
    const NUEVO = { id: "p-nuevo", title: "Tarjetas", subdomain: null, publishedAt: null, updatedAt: "2026-11-21", chatHistory: [] };
    const pedir = vi.fn(async (ruta: string) =>
      ruta === "/api/projects"
        ? Response.json({ projects: lecturas++ === 0 ? [] : [NUEVO] })
        : ruta === "/api/assistants"
          ? Response.json({ enabled: true, agents: true, assistants: [CHEF] })
          : ruta.endsWith("/preview")
            ? Response.json({ enabled: true, token: "vista" })
            : ruta === "/api/projects/p-nuevo"
              ? Response.json({ project: NUEVO })
              : ruta.startsWith("/api/tools?")
                ? Response.json({ tools: [], paid: true, person: { name: "Ana" } })
                : Response.json({ chatHistory: [] }),
    );
    const cliente = { pedir, avisarAlCerrar: vi.fn() };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<PantallaPrincipal cliente={cliente} idioma="es" onSalir={vi.fn()} />));
    await act(async () => {});
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agente="a3"]')!.click());
    // Her turn passed something to Len, who started in a new project.
    chats.elementosDeElla = [{ clave: "t1:lenPedidos", t: 1, tipo: "lenPedidos", refs: [{ filaId: "f1", projectId: "p-nuevo" }] }];
    await act(async () => root.render(<PantallaPrincipal cliente={cliente} idioma="es" onSalir={vi.fn()} />));
    await act(async () => {});
    await act(async () => {});
    expect(pedir.mock.calls.filter(([ruta]) => ruta === "/api/projects").length).toBe(2);
    const lenCards = chatProps.ella!.lenCards as { projectGone: (pid: string) => boolean };
    expect(lenCards.projectGone("p-nuevo")).toBe(false);
    expect(chatProps.ella).toMatchObject({ abierto: true, asistente: { name: "Chef Rosa" } });
    chats.elementosDeElla = [];
  });

  // Final review I2: «Crear un agente» sends the person to the web; coming back, the agent they made is there.
  it("🔴 coming back to the app reads the agents again: one made on the web shows", async () => {
    let mine: unknown[] = [];
    await paint(() => Response.json({ enabled: true, agents: true, assistants: mine }));
    expect(host.textContent).toContain("sinPaginas");
    mine = [CHEF];
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {});
    expect(host.querySelector('[data-agente="a3"]')).not.toBeNull();
  });

  it("«Tareas» opens from your agents", async () => {
    const { pedir } = await paint(agents([CHEF]));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-atajo-tareas]")!.click());
    await act(async () => {});
    expect(pedir.mock.calls.some(([ruta]) => ruta === "/api/movil/tasks")).toBe(true);
  });
});
