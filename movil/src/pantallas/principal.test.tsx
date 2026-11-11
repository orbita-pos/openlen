import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
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
const hoja = vi.hoisted(() => ({ alMedir: null as null | ((visibleEncogida: number) => void) }));
vi.mock("../hoja-deslizable", () => ({ useHojaDeslizable: (o: { alMedir?: (v: number) => void }) => { hoja.alMedir = o.alMedir ?? null; return null; } }));
vi.mock("../atras", () => ({ useAtras: () => {} }));
vi.mock("../llamada/llamada", () => ({ Llamada: ({ projectId }: { projectId: string }) => <div data-llamada={projectId} /> }));
const chatProps: { ultimo: Record<string, unknown> | null } = { ultimo: null };
vi.mock("../chat/chat", () => ({ PantallaChat: (p: Record<string, unknown>) => { chatProps.ultimo = p; return null; } }));
// The tool's screen is its own test's (tool-screen.test.tsx): here, which tool opened, where, and its `sendPrompt`.
vi.mock("../herramientas/tool-screen", () => ({
  PantallaHerramienta: ({ tool, proyecto, onPrompt, onCerrar }: { tool: { id: string }; proyecto: { id: string } | null; onPrompt: ((d: string) => void) | null; onCerrar: () => void }) => (
    <div data-herr-abierta={tool.id} data-proyecto={proyecto?.id ?? ""}>{onPrompt && <button data-herr-prompt="" onClick={() => onPrompt("> hola\n\n— Reservas\n")} />}<button data-herr-cerrar="" onClick={onCerrar} /></div>
  ),
}));
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
  const proyecto = { id: "p1", title: "Página", subdomain: null, publishedAt: null, updatedAt: "2026-11-09", chatHistory: [] };
  const LUCIA = { id: "a1", name: "Lucía", slug: "lucia", look: { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" } as const, color: "#f4a48b", tone: "friendly", projectId: "p1", projectIds: ["p1"] };
  async function paint(asistentes: unknown[]) {
    const pedir = vi.fn(async (ruta: string) =>
      ruta === "/api/projects"
        ? Response.json({ projects: [proyecto] })
        : ruta.endsWith("/preview")
          ? Response.json({ enabled: true, token: "vista" })
          : ruta === "/api/assistants"
            ? Response.json({ assistants: asistentes })
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

  it("🔴 «Hablar» opens her chat over her tab, outside the panel, and reads her conversation", async () => {
    const { pedir } = await paint();
    await act(async () => aviso.asistente!("a1", { parte: "conversaciones", tarjeta: null }));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-tab-hablar]")!.click());
    await act(async () => {});
    expect(suChat()).toMatchObject({ abierto: true, projectId: "p1", asistente: { name: "Lucía", color: "#f4a48b", look: { shape: "drop", color: "#f4a48b" } } });
    expect(host.querySelector('[data-assistant-tab="a1"]')).not.toBeNull();
    expect(host.querySelector(".app-panel-motion .app-su-chat")).toBeNull();
    expect(host.querySelector(".app-su-chat")).not.toBeNull();
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
    expect(suChat()).toBeNull();
  });
});
