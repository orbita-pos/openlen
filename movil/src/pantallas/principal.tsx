// La pantalla principal (escena 5 del prototipo): la barra, tu página de
// verdad en vista previa y la hoja de Len. La llamada (Task 10) se abre desde
// la hoja y, pequeña, flota encima.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_LOOK } from "@/lib/figure/look";
import { AssistantFigure } from "@/components/workspace-v2/assistant/figure";
import { lookOfRow } from "@/lib/assistants/look";
import { App as AppNativa } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useTranslations } from "use-intl";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { publishedHost } from "@/lib/publish/base-host";
import { BASE, type Idioma } from "../config";
import { Cara } from "../cara";
import { Icono, type NombreDeIcono } from "../iconos";
import type { StoredChatTurn } from "@/lib/projects/types";
import { enlaceDeVistaPrevia, leerProyecto, listarProyectos, type ProyectoAbierto, type ProyectoEnLista } from "../api/proyectos";
import { ALLOW_REMOTO, SANDBOX_REMOTO } from "@/components/workspace-v2/sandbox-del-lienzo";
import { loQueDijoLen, ultimoTurnoDeLen } from "../hoja";
import { plataforma } from "../sesion/plataforma";
import { Cargando } from "./cargando";
import { devolverFoco } from "../foco";
import { SinRed } from "./sin-red";
import { Selector } from "./selector";
import { DeliveredTab } from "../overview/delivered-tab";
import { TasksTab } from "../overview/tasks-tab";
import { ToolsTab } from "../herramientas/tools-tab";
import { AssistantTab } from "../asistente/assistant-tab";
import { AgentsList } from "../asistente/agents-list";
import { LenTurnView } from "../asistente/len-turn-view";
import { useLenRequests } from "../asistente/use-len-requests";
import { pasosDelTrabajo } from "../entrega/progreso";
import type { ElementoDelHilo } from "../chat/hilo";
import { leerSuChat, listarAsistentes, readAssistants, serveProject } from "../api/asistente";
import { projectStatusOf } from "../asistente/project-status";
import { appModeOf, dismissWelcome, readChosen, readWelcomeDismissed, saveChosen } from "../asistente/app-mode";
import { WelcomeCreator } from "../asistente/welcome-creator";
import { applyHerColor } from "../asistente/color";
import type { ParteDeLaAsistente } from "../avisos/controlador";
import type { AssistantListItem } from "@/lib/assistants/view";
import type { LenRequestRef } from "@/lib/assistants/len-request-ref";
import { listarHerramientas, sePuedeAbrir, type HerramientasDeLaPersona } from "../api/herramientas";
import { IconoDeHerramienta } from "../herramientas/tools-tab";
import { PantallaHerramienta } from "../herramientas/tool-screen";
import type { InstalledToolView } from "@/lib/tools/types";
import { fetchDelivered } from "../api/overview";
import { PhoneViewer } from "../viewer/phone-viewer";
import type { ViewerFile } from "@/components/viewer/viewer";
import { Llamada } from "../llamada/llamada";
import { useHojaDeslizable } from "../hoja-deslizable";
import { useAtras } from "../atras";
import { useChat } from "../chat/use-chat";
import { PantallaChat } from "../chat/chat";
import { Gestion } from "../gestion/gestion";
import { TuLen } from "../personalizacion/tu-len";
import { ControlAvisos } from "../avisos/control-avisos";
import { useAvisos } from "../avisos/use-avisos";
import { Comparacion, EntregaVisual, Progreso } from "../entrega/entrega";
import { Equipo } from "../equipo/equipo";
import { PanelAnimado } from "../panel-animado";
import { useEquipo } from "../equipo/use-equipo";

const ULTIMO = "len-proyecto";
type Tamano = "cel" | "tab" | "pc";
const ANCHO: Record<Tamano, number> = { cel: 390, tab: 820, pc: 1280 };
// Como el prototipo: el botón lleva el icono del tamaño de ahora.
const ICONO_DEL_TAMANO: Record<Tamano, NombreDeIcono> = { cel: "dvCel", tab: "dvTab", pc: "dvPc" };
// Una sola lista vacía: con `?? []` en cada render, el chat creería que la
// conversación cambió cada vez y tiraría lo que acabas de mandar.
const SIN_HISTORIAL: StoredChatTurn[] = [];
const SIN_ELEMENTOS: ElementoDelHilo[] = [];

export function PantallaPrincipal({ cliente, idioma, onSalir }: { cliente: ClienteDeOpenLen; idioma: Idioma; onSalir: () => void }) {
  const t = useTranslations("movil.principal");
  const tv = useTranslations("movil.vacio");
  const tc = useTranslations("movil.chat");
  const te = useTranslations("movil.entrega");
  const tq = useTranslations("movil.equipo");
  const tr = useTranslations("movil.resumen");
  const ta = useTranslations("movil.adjuntos");
  const ti = useTranslations("movil.interfaz");
  const th = useTranslations("movil.herramientas");
  const tas = useTranslations("movil.asistente");
  const [lista, setLista] = useState<ProyectoEnLista[] | null>(null);
  const [sinRed, setSinRed] = useState(false);
  const [id, setId] = useState<string | null>(() => localStorage.getItem(ULTIMO));
  const [proyectoGuardado, setP] = useState<ProyectoAbierto | null>(null);
  const p = proyectoGuardado?.id === id ? proyectoGuardado : null;
  const [vista, setVista] = useState<string | null>(null);
  const [vistaFallo, setVistaFallo] = useState(false);
  const [intentoVista, setIntentoVista] = useState(0);
  const [tamano, setTamano] = useState<Tamano>("cel");
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBoton = useRef<HTMLButtonElement>(null);
  const [selector, setSelector] = useState(false);
  const [hojaMin, setHojaMin] = useState(false);
  const [llamada, setLlamada] = useState(false);
  const [chatAbierto, setChatAbierto] = useState(false);
  // «Ver en el chat» desde Entregado: el elemento del hilo que el chat trae a la vista al abrirse.
  const [enfocarEnChat, setEnfocarEnChat] = useState<string | null>(null);
  const alEnfocarEnChat = useCallback(() => setEnfocarEnChat(null), []);
  const [conPip, setConPip] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [panel, setPanel] = useState<"gestion" | "look" | "comparar" | "equipo" | "entregado" | "tareas" | "herramientas" | "asistente" | "turnoDeLen" | "agentes" | null>(null);
  // What Len did, to read (spec local 2026-11-16-movil-es-tu-asistente, §5.4.9): in her app, where his chat used to lead.
  const [turnoDeLen, setTurnoDeLen] = useState<{ fila: string; projectId: string } | null>(null);
  // «Antes / Ahora» of a Len card: that card's turn (null: the page's latest change, the sheet's shortcut).
  const [comparando, setComparando] = useState<string | null>(null);
  // The person's own assistants (spec local 2026-11-06-asistente-propio, §4.6.3, phase 5): one button each, with her name,
  // beside «Entregado» and «Tareas»; none (or assistants off on the server) → no button. The open one, and on what part.
  const [asistentes, setAsistentes] = useState<readonly AssistantListItem[]>([]);
  // Len móvil is her app (spec local 2026-11-16-movil-es-tu-asistente, §5.1): assistants on at all, the one chosen on
  // this phone, and whether the welcome was dismissed.
  const [asistentesOn, setAsistentesOn] = useState(true);
  // Whether agents can be made (spec local 2026-11-19-agentes-para-todos, §6.8): «Crear un agente» opens the web's home on
  // the agent kind, where Len makes them (§6.3) — only when the server says it can.
  const [agentesOn, setAgentesOn] = useState(false);
  const crearAgente = useCallback(() => void plataforma.abrirNavegador(`${BASE}/?kind=agent`).catch(() => {}), []);
  // Read at least once (final review, I6): until then, no welcome.
  const [asistentesLeidas, setAsistentesLeidas] = useState(false);
  const [elegida, setElegida] = useState<string | null>(readChosen);
  const [bienvenidaCerrada, setBienvenidaCerrada] = useState(readWelcomeDismissed);
  const [asistenteAbierta, setAsistenteAbierta] = useState<{ asistente: AssistantListItem; parte?: ParteDeLaAsistente; tarjeta?: string | null; n: number } | null>(null);
  const aperturas = useRef(0);
  const abrirSuPestana = useCallback((asistente: AssistantListItem, donde: { parte?: ParteDeLaAsistente; tarjeta?: string | null } = {}) => {
    setAsistenteAbierta({ asistente, ...donde, n: ++aperturas.current });
    setPanel("asistente");
  }, []);
  // The person's tools (spec local 2026-11-04-herramientas-hechas-por-len, §4.14): read when the app opens and on every
  // reload; `"off"` hides «Herramientas» (tools switched off on the server); a failure keeps it (the tab offers «Reintentar»).
  const [herramientas, setHerramientas] = useState<HerramientasDeLaPersona | "off" | null>(null);
  // The tool open full screen: a `rail` one from the tab (no project), a `project` one beside this project's chat.
  const [herramientaAbierta, setHerramientaAbierta] = useState<{ tool: InstalledToolView; proyecto: { id: string; title: string } | null } | null>(null);
  // A «Crear» card's «Abrir»: the tool it installed, from the person's tools read again (it may be newer than the list).
  const abrirHerramientaPorId = useCallback(async (installationId: string) => {
    const l = await listarHerramientas(cliente, idioma).catch(() => null);
    if (!l || l === "off") return;
    setHerramientas(l);
    const tool = l.tools.find((x) => x.id === installationId);
    if (!tool || !sePuedeAbrir(tool)) return;
    const actual = idActual.current;
    const titulo = lista?.find((y) => y.id === actual)?.title ?? "";
    setHerramientaAbierta({ tool, proyecto: tool.placement === "project" && actual ? { id: actual, title: titulo } : null });
  }, [cliente, idioma, lista]);
  const releerHerramientas = useCallback(() => {
    void listarHerramientas(cliente, idioma).then(setHerramientas, () => {});
  }, [cliente, idioma]);
  // What a project tool's `sendPrompt` leaves in the chat's composer.
  const [borrador, setBorrador] = useState<{ texto: string; n: number } | null>(null);
  useEffect(() => {
    let alive = true;
    listarHerramientas(cliente, idioma).then((x) => alive && setHerramientas(x), () => {});
    return () => {
      alive = false;
    };
  }, [cliente, idioma, recarga]);
  useEffect(() => {
    let alive = true;
    readAssistants(cliente).then((x) => {
      if (!alive) return;
      setAsistentes(x.assistants);
      setAsistentesOn(x.enabled);
      setAgentesOn(x.agents);
      setAsistentesLeidas(true);
    }, () => {});
    return () => {
      alive = false;
    };
  }, [cliente, recarga]);
  const modo = appModeOf({ loaded: asistentesLeidas, enabled: asistentesOn, assistants: asistentes, chosenId: elegida, projects: lista ?? [], welcomeDismissed: bienvenidaCerrada });
  const suColor = modo.kind === "assistant" ? modo.assistant.color : null;
  // The app takes her color (§5.2); with no assistant, and on leaving this screen (signing out), Len's orange again.
  useEffect(() => {
    applyHerColor(suColor);
    return () => applyHerColor(null);
  }, [suColor]);
  // HER CHAT (spec local 2026-11-16-movil-es-tu-asistente, §5.3): in her app, THE chat — her sheet opens it, over your
  // page. Her conversation with her owner, read when she becomes the app's and after each of her turns.
  const ella = modo.kind === "assistant" ? modo.assistant : null;
  const suId = ella?.id ?? null;
  const [suHistorial, setSuHistorial] = useState<StoredChatTurn[]>(SIN_HISTORIAL);
  const suIdActual = useRef(suId);
  useLayoutEffect(() => { suIdActual.current = suId; });
  const recargarSuChat = useCallback(() => {
    if (!suId) return;
    void leerSuChat(cliente, suId).then((h) => { if (suIdActual.current === suId) setSuHistorial(h); }, () => {});
  }, [cliente, suId]);
  useEffect(() => {
    setSuHistorial(SIN_HISTORIAL);
    recargarSuChat();
  }, [recargarSuChat]);
  /** Talking with one of her person's assistants: she becomes the app's (if she wasn't) and her chat opens. */
  const hablarCon = useCallback((asistente: AssistantListItem) => {
    if (asistente.id !== suId) { saveChosen(asistente.id); setElegida(asistente.id); }
    setPanel(null);
    setChatAbierto(true);
  }, [suId]);
  const idActual = useRef(id);
  const paginaCargada = useRef<string | null>(null);
  // El panel que pidió un aviso (una mención → Equipo; Len Watch → Gestión) para el proyecto que abre.
  // «chat» (spec local 2026-10-31-len-movil): a row of «Tareas» answered in the project's chat.
  const panelDelAviso = useRef<{ id: string; panel: "equipo" | "gestion" | "chat" | "comparar" | "turnoDeLen" } | null>(null);
  useLayoutEffect(() => { idActual.current = id; paginaCargada.current = p?.id ?? null; }, [id, p]);
  useEffect(() => {
    const destino = panelDelAviso.current?.id === id ? panelDelAviso.current.panel : null;
    setPanel(destino && destino !== "chat" ? destino : null); panelDelAviso.current = null; setChatAbierto(destino === "chat"); setLlamada(false); setConPip(false);
  }, [id]);
  const abrirAviso = useCallback((destino: string, panelDestino?: "equipo" | "gestion" | "chat" | "comparar" | "turnoDeLen") => {
    // El controlador ya verificó identidad y acceso. Releer la lista conserva
    // también sus títulos y evita abrir proyectos que ya no estén disponibles.
    void listarProyectos(cliente).then((ps) => {
      // Gone (deleted, no longer shared): you stay where you are, and the list read says so — a Len card of it shows
      // it (deferred minor of the final review: it used to switch to it and stay on «Cargando»).
      if (!ps.some((x) => x.id === destino)) { setLista(ps); return; }
      if (panelDestino) {
        if (idActual.current !== destino) panelDelAviso.current = { id: destino, panel: panelDestino };
        else if (panelDestino === "chat") { setPanel(null); setChatAbierto(true); }
        else setPanel(panelDestino);
      }
      setLista(ps); setId(destino); setSelector(false); setMenu(false);
    }).catch(() => setSinRed(true));
  }, [cliente]);
  // A finished task's push (spec local 2026-10-31-len-movil, §5.4): the project, and over it what Len delivered,
  // found in «Entregado» for its name and preview (only its URL travels in the push).
  const [archivoDelAviso, setArchivoDelAviso] = useState<ViewerFile | null>(null);
  const abrirEntregado = useCallback((destino: string, url: string) => {
    abrirAviso(destino);
    void fetchDelivered(cliente, 100).then((items) => {
      const d = items.find((x) => x.url === url);
      setArchivoDelAviso(d ? { name: d.name, url: d.url, size: d.size, ...(d.previewUrl ? { preview: d.previewUrl } : {}), projectTitle: d.projectTitle } : { name: decodeURIComponent(url.split("/").pop() ?? "").slice(9), url, size: 0 });
    }).catch(() => setSinRed(true));
  }, [abrirAviso, cliente]);
  // An event task's card (spec local 2026-11-03-len-que-avisa, §8): the project's chat, with that card in view.
  const [avisoDelChat, setAvisoDelChat] = useState<{ id: string; tarjeta: string | null } | null>(null);
  const abrirAvisoDeLen = useCallback((destino: string, tarjeta: string | null) => {
    setAvisoDelChat({ id: destino, tarjeta });
    abrirAviso(destino, "chat");
  }, [abrirAviso]);
  const abrirAsistente = useCallback((assistantId: string, donde: { parte: ParteDeLaAsistente; tarjeta: string | null }) => {
    void listarAsistentes(cliente)
      .catch(() => null)
      .then((l) => {
        if (l) setAsistentes(l);
        const suya = l?.find((x) => x.id === assistantId);
        const asistente = suya ?? { id: assistantId, name: "", slug: "", look: DEFAULT_LOOK, color: DEFAULT_LOOK.color, tone: "friendly" as const, projectId: "", projectIds: [] };
        setSelector(false); setMenu(false);
        if (suya && donde.parte === "hablar") { hablarCon(suya); return; }
        setChatAbierto(false);
        abrirSuPestana(asistente, donde);
      });
  }, [cliente, abrirSuPestana, hablarCon]);
  const avisos = useAvisos({ cliente, onAbrirProyecto: abrirAviso, onAbrirEntregado: abrirEntregado, onAbrirAviso: abrirAvisoDeLen, onAbrirAsistente: abrirAsistente });
  useAtras(selector, () => setSelector(false));
  useAtras(menu, () => setMenu(false));
  useEffect(() => {
    if (!menu) return;
    const antes = document.activeElement as HTMLElement | null;
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    const fuera = (e: PointerEvent) => {
      if (e.target instanceof Node && !menuRef.current?.contains(e.target) && !menuBoton.current?.contains(e.target)) setMenu(false);
    };
    document.addEventListener("pointerdown", fuera);
    return () => { document.removeEventListener("pointerdown", fuera); devolverFoco(antes); };
  }, [menu]);
  // Encogida, la hoja no tapa el final de la página (Jesús, 01/11): la página acaba encima de ella. Se acorta
  // cuando la hoja termina de bajar (.32 s, app.css) y, al abrirla, vuelve a todo el alto en el acto: abierta
  // la tapa igual, y así no se ve un hueco mientras la hoja se mueve.
  const [visibleEncogida, setVisibleEncogida] = useState(0);
  const [paginaCorta, setPaginaCorta] = useState(false);
  useEffect(() => {
    if (!hojaMin || selector) { setPaginaCorta(false); return; }
    const espera = setTimeout(() => setPaginaCorta(true), 320);
    return () => clearTimeout(espera);
  }, [hojaMin, selector]);
  const deslizarHoja = useHojaDeslizable({ encogida: hojaMin, alCambiar: setHojaMin, alMedir: setVisibleEncogida });

  const cargar = useCallback(async (conservarPantalla = false) => {
    if (!conservarPantalla) setSinRed(false);
    try {
      const ps = await listarProyectos(cliente);
      setLista(ps);
      const elegido = ps.find((x) => x.id === idActual.current)?.id ?? ps[0]?.id ?? null;
      setId(elegido); setSinRed(false);
    } catch {
      // También un HTTP 500 o una respuesta inválida necesitan reintento.
      // El cliente ya devuelve a Entrar cuando recibe un 401.
      if (!conservarPantalla) setSinRed(true);
    }
  }, [cliente]);

  useEffect(() => {
    void cargar();
    // Sólo al montar: elegir otra página no recarga la lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sólo una página de TU lista: la recordada puede ya no existir (borrada,
  // otra cuenta, la muestra) y pedirla daba 404. Y lo que llegue tarde de la
  // página anterior se tira: un 404 viejo ponía «No pude cargar tu página».
  useEffect(() => {
    if (!id || !lista?.some((x) => x.id === id)) return;
    let vigente = true;
    localStorage.setItem(ULTIMO, id);
    // La derivación por id oculta otros proyectos; releer éste conserva sus capas.
    void leerProyecto(cliente, id)
      .then((x) => {
        if (vigente) setP(x);
      })
      .catch(() => {
        // Una actualización fallida no desmonta conversación ni llamada ya abiertas.
        if (vigente && paginaCargada.current !== id) setSinRed(true);
      });
    return () => { vigente = false; };
  }, [cliente, id, lista]);
  useEffect(() => {
    if (!id || !lista?.some(x => x.id === id)) return;
    let vigente = true;
    setVista(null); setVistaFallo(false);
    void enlaceDeVistaPrevia(cliente, BASE, id).then(x => { if (vigente) setVista(x); })
      .catch(() => { if (vigente) setVistaFallo(true); });
    return () => { vigente = false; };
  }, [cliente, id, lista, intentoVista]);

  const dicho = p ? loQueDijoLen(p.historial) : null;

  // A project she doesn't serve (§5.6): she takes it (bubble off), or another assistant of yours has it, or it's not
  // yours. The list of assistants is read again after she takes one.
  const [atendiendo, setAtendiendo] = useState<string | null>(null);
  const [noSePudo, setNoSePudo] = useState<string | null>(null);
  const queLoAtienda = useCallback(async (projectId: string) => {
    if (!ella) return;
    setAtendiendo(projectId);
    setNoSePudo(null);
    const r = await serveProject(cliente, ella.id, projectId);
    setAtendiendo(null);
    if (r === "error") { setNoSePudo(projectId); return; }
    const l = await readAssistants(cliente).catch(() => null);
    if (l) { setAsistentes(l.assistants); setAsistentesOn(l.enabled); }
  }, [cliente, ella]);
  // The welcome (§5.1): her home is the project on screen if it is yours, or your newest.
  const casaDeLaBienvenida = (lista ?? []).find((x) => x.id === id && !x.compartido)?.id ?? (lista ?? []).find((x) => !x.compartido)?.id ?? null;
  const yaNacio = useCallback((nueva: string) => {
    saveChosen(nueva);
    setElegida(nueva);
    // She exists now: the welcome closes even if reading her back fails (final review, I6); the next read shows her.
    setBienvenidaCerrada(true);
    void readAssistants(cliente).then((l) => { setAsistentes(l.assistants); setAsistentesOn(l.enabled); setAsistentesLeidas(true); }, () => {});
  }, [cliente]);
  const asistenciaDelProyecto = (p: ProyectoEnLista) => {
    if (!ella) return null;
    const estado = projectStatusOf(p, ella, asistentes);
    const descripcion = estado.kind === "hers" || estado.kind === "other"
      ? tas("loAtiende", { name: estado.kind === "hers" ? ella.name : estado.assistant.name })
      : tas(estado.kind === "notYours" ? "soloParaVer" : "sinAsistente");
    return { estado, descripcion };
  };
  const juntoAlProyecto = (p: ProyectoEnLista) => {
    if (!ella) return null;
    const info = asistenciaDelProyecto(p);
    if (!info || info.estado.kind === "hers") return null;
    const { estado, descripcion } = info;
    if (estado.kind === "notYours") return <small>{descripcion}</small>;
    if (estado.kind === "other") {
      const otra = estado.assistant;
      return <><small>{descripcion}</small><button type="button" className="lm-btn lm-sec" onClick={() => { saveChosen(otra.id); setElegida(otra.id); }}>{tas("cambiarA", { name: otra.name })}</button></>;
    }
    return <>
      <small>{descripcion}</small>
      <button type="button" className="lm-btn lm-sec" disabled={atendiendo === p.id} onClick={() => void queLoAtienda(p.id)}>{tas("queLoAtienda", { name: ella.name })}</button>
      {noSePudo === p.id && <small role="alert">{tas("noSePudo")}</small>}
    </>;
  };
  /** What Len did in one of his turns: its panel, over that project (switching to it first if it isn't on screen). */
  const abrirTurnoDeLen = useCallback((fila: string, projectId: string) => {
    setTurnoDeLen({ fila, projectId });
    if (projectId === idActual.current) { setChatAbierto(false); setPanel("turnoDeLen"); return; }
    abrirAviso(projectId, "turnoDeLen");
  }, [abrirAviso]);
  /** «Antes / Ahora» (of that card's turn) and «Publicar» of a Len card: that project's panel, switching to it first if
   *  it isn't on screen — and only if it is still in your list. */
  const abrirPanelDelProyecto = useCallback((projectId: string, destino: "comparar" | "gestion", fila?: string) => {
    setComparando(destino === "comparar" ? fila ?? null : null);
    if (projectId === idActual.current) { setChatAbierto(false); setPanel(destino); return; }
    abrirAviso(projectId, destino);
  }, [abrirAviso]);
  // Al acabar un turno (o volver de uno cortado): la conversación nueva y la
  // vista previa recargada, para que «Ver en tu página» enseñe el cambio.
  const recargar = useCallback(() => {
    if (!id) return;
    void leerProyecto(cliente, id).then((p) => { if (idActual.current === id) setP(p); }).catch(() => {});
    setRecarga((n) => n + 1);
  }, [cliente, id]);
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      const listener = AppNativa.addListener("appStateChange", ({ isActive }) => { if (isActive) { void cargar(true); releerHerramientas(); } });
      return () => { void listener.then((l) => l.remove()); };
    }
    const volver = () => { if (document.visibilityState === "visible") { void cargar(true); releerHerramientas(); } };
    document.addEventListener("visibilitychange", volver);
    return () => document.removeEventListener("visibilitychange", volver);
  }, [cargar, releerHerramientas]);

  // El chat (pieza 2). Si cuelgas o cierras con Len trabajando, el chat se
  // vuelve a enganchar al turno (lo que antes hacía aquí la hoja).
  const chat = useChat({
    cliente,
    base: BASE,
    projectId: id,
    idioma,
    historial: p?.historial ?? SIN_HISTORIAL,
    alCambiarLaPagina: recargar,
    textoDeArchivoSolo: ta("archivoSolo"),
  });
  const chatDeElla = useChat({
    cliente,
    base: BASE,
    projectId: ella?.projectId || null,
    idioma,
    historial: suHistorial,
    alCambiarLaPagina: recargarSuChat,
    textoDeArchivoSolo: ta("archivoSolo"),
    ...(ella ? { assistantId: ella.id, ...(id ? { viewingProjectId: id } : {}) } : {}),
  });
  const dichoElla = ella ? loQueDijoLen(suHistorial) : null;
  // HER LEN CARDS, followed here and not in her chat (final review, I2): the sheet over the page needs them too — a Len
  // turn her ask_len started after this page loaded is Len working on it, and the sheet says so with his steps.
  const pedidosALen = useLenRequests({
    cliente,
    assistantId: ella?.id ?? null,
    elementos: (chatDeElla.elementos as ElementoDelHilo[] | undefined) ?? SIN_ELEMENTOS,
    onSettled: (r) => { if (r.projectId === idActual.current) recargar(); },
  });
  const lenAqui = ella
    ? ((chatDeElla.elementos as ElementoDelHilo[] | undefined) ?? SIN_ELEMENTOS)
        .flatMap((e) => (e.tipo === "lenPedidos" ? e.refs : []))
        .filter((r) => r.projectId === id)
        .map((r) => pedidosALen.byFila.get(r.filaId))
        .find((v) => v?.status === "running" || v?.status === "queued")
    : undefined;
  const lenTrabajaAqui = chat.trabajando || lenAqui !== undefined;
  // In her app Len's own chat is out of sight: a turn of his on this page (a goal, an «@Len») that ended on a question
  // shows in her sheet, with «Contestar» (deferred minor of the final review).
  const preguntaDeLen = ella && !lenTrabajaAqui && chat.pregunta ? ultimoTurnoDeLen(p?.historial ?? []) : undefined;
  const pasosDeLenAqui = chat.trabajando ? chat.progreso : pasosDelTrabajo(lenAqui?.turn?.actions ?? []);
  const equipo = useEquipo({
    cliente, projectId: id, idioma, activo: panel === "equipo",
    alPedirLen: texto => { setPanel(null); if (!ella) setChatAbierto(true); chat.mandar(texto); },
    alCambiar: pagina => {
      if (!id) return;
      if (pagina) { recargar(); return; }
      void leerProyecto(cliente, id).then(p => { if (idActual.current === id) setP(p); }).catch(() => {});
    },
  });

  if (sinRed) return <SinRed onReintentar={() => void cargar()} />;
  if (lista && lista.length === 0) return <section className="ent-empty lm-layer lm-chat is-on"><Cara estado="reposo" className="app-cargando-cara" /><p>{tv("sinPaginas")}</p><div className="app-vacio-acciones"><button className="app-vacio-abrir" type="button" onClick={() => void plataforma.abrirNavegador(BASE).catch(() => setSinRed(true))}>{ti("abrirOpenLen")}</button><button type="button" onClick={() => void cargar()}>{ti("actualizarPaginas")}</button></div><ControlAvisos avisos={avisos} /><button className="lm-btn lm-sec" onClick={onSalir}>{t("salir")}</button></section>;
  if (!lista || !id) return <Cargando mensaje={ti("cargandoPaginas")} />;

  if (!p) return <Cargando mensaje={ti("cargandoPagina")} />;

  const direccion = p?.subdomain ? publishedHost(p.subdomain) : t("sinPublicar");

  return (
    <>
      <section className="lm-layer lm-app is-on" data-mode="page">
        <div className={`lm-pagehost app-con-iframe${tamano !== "cel" ? " is-dv" : ""}`} style={{ "--app-hoja": paginaCorta ? `${visibleEncogida}px` : "0px" } as CSSProperties}>
          {vista && !vistaFallo ? (
            <iframe
              key={recarga}
              className="app-vista"
              src={vista}
              // Las banderas del lienzo de la web: lo que la publicada puede, sin sacarte de la app.
              sandbox={SANDBOX_REMOTO}
              allow={ALLOW_REMOTO}
              title={p?.title ?? "Vista previa"}
              style={tamano === "cel" ? undefined : { width: ANCHO[tamano], transform: `scale(${390 / ANCHO[tamano]})`, transformOrigin: "0 0", height: `calc((100% - var(--app-barra) - var(--app-hoja, 0px)) * ${ANCHO[tamano] / 390})` }}
              onError={() => setVistaFallo(true)}
            />
          ) : vistaFallo ? (
            <div className="app-vista-estado" role="alert"><p>{t("vistaNoCarga")}</p><button type="button" onClick={() => setIntentoVista(n => n + 1)}>{te("reintentar")}</button></div>
          ) : <div className="app-vista-estado" role="status"><p>{ti("cargandoPagina")}</p></div>}
        </div>

        <header className="lm-bar">
          {ella
            ? <button className="ent-face-button" type="button" aria-label={ella.name} onClick={() => abrirSuPestana(ella)}><span className="lm-bar-face lm-bar-asistente"><AssistantFigure look={lookOfRow(ella)} size={36} /></span></button>
            : <button className="ent-face-button" type="button" aria-label={te("tuLen")} onClick={() => setPanel("look")}><Cara estado="reposo" className="lm-bar-face" /></button>}
          <button type="button" className="lm-bar-t" style={{ background: "none", border: 0, textAlign: "left", color: "inherit", padding: 0 }} onClick={() => setSelector(true)}>
            <b>{p?.title ?? lista.find(x => x.id === id)?.title ?? ""}</b>
            <span>{direccion}</span>
          </button>
          <span className={`lm-chip-st${p?.publicado ? " is-live" : ""}`}>{p?.publicado ? t("publicada") : t("vistaPrevia")}</span>
          <button ref={menuBoton} type="button" className={`lm-dvbtn${tamano !== "cel" ? " is-dv" : ""}`} aria-label={t("otrosTamanos")} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Icono nombre={ICONO_DEL_TAMANO[tamano]} />
          </button>
        </header>
        <div ref={menuRef} className={`lm-dvmenu${menu ? " is-on" : ""}`} role="menu" aria-label={t("verEn")} inert={!menu} onKeyDown={e => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setMenu(false); return; }
          const bs = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
          const i = bs.indexOf(document.activeElement as HTMLButtonElement);
          if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End", "Tab"].includes(e.key)) {
            e.preventDefault();
            const indice = e.key === "Home" ? 0 : e.key === "End" ? bs.length - 1 : (i + ((e.key === "Tab" ? e.shiftKey : e.key === "ArrowUp" || e.key === "ArrowLeft") ? -1 : 1) + bs.length) % bs.length;
            bs[indice]?.focus({ preventScroll: true });
          }
        }}>
          <p className="lm-dvmenu-cap">{t("verEn")}</p>
          <div>
            {(["cel", "tab", "pc"] as const).map((x) => (
              <button key={x} type="button" role="menuitemradio" aria-checked={x === tamano} onClick={() => { setTamano(x); setMenu(false); }}>
                <Icono nombre={ICONO_DEL_TAMANO[x]} />
                <span>{t(x)}</span>
                <small>{ANCHO[x]} px</small>
              </button>
            ))}
          </div>
        </div>

        {/* Tus proyectos ocupan el sitio de la hoja (dentro de la capa: fuera,
            su z-index la deja debajo de la app). Como en el prototipo, una
            sola hoja que cambia de contenido. */}
        {selector ? (
          <Selector proyectos={lista} actual={id} descripcion={(p) => asistenciaDelProyecto(p)?.descripcion} onElegir={(x) => { setId(x); setSelector(false); }} onCerrar={() => setSelector(false)} onSalir={onSalir} atajos={<>
            <button type="button" className="lm-btn lm-sec" onClick={() => { setSelector(false); setPanel("entregado"); }}>{tr("entregado")}</button>
            <button type="button" className="lm-btn lm-sec" onClick={() => { setSelector(false); setPanel("tareas"); }}>{tr("tareas")}</button>
            {herramientas !== "off" && <button type="button" className="lm-btn lm-sec" onClick={() => { setSelector(false); setPanel("herramientas"); }}>{th("titulo")}</button>}
            {/* With two or more, one «Agentes» button: the list to choose whom to talk to (spec local
                2026-11-19-agentes-para-todos, §6.8). With one, as before: her button opens her place (§6.10). */}
            {asistentes.length >= 2 && (
              <button type="button" className="lm-btn lm-sec" data-agentes="" onClick={() => { setSelector(false); setPanel("agentes"); }}>{tas("agentes")}</button>
            )}
            {/* The app's assistant opens her place; another one becomes the app's (§5.1). */}
            {asistentes.length < 2 && asistentes.map((a) => {
              const esLaDeLaApp = modo.kind === "assistant" && modo.assistant.id === a.id;
              return <button key={a.id} type="button" className="lm-btn lm-sec" data-asistente={a.id} aria-current={esLaDeLaApp ? "true" : undefined} onClick={() => {
                if (esLaDeLaApp) { setSelector(false); abrirSuPestana(a); return; }
                saveChosen(a.id);
                setElegida(a.id);
              }}>{a.name}</button>;
            })}
          </>}>
            {!ella && <button type="button" className="lm-btn lm-sec" onClick={() => { setSelector(false); setPanel("look"); }}>{te("tuLen")}</button>}
            <ControlAvisos avisos={avisos} />
          </Selector>
        ) : (
          <div ref={deslizarHoja} className={`lm-sheet lm-m lm-marca is-on app-main-sheet${hojaMin ? " is-min" : ""}`} data-kind="listo">
            <button type="button" className="lm-grab" aria-label={t("encoger")} aria-expanded={!hojaMin} aria-controls="len-sheet-body" onClick={() => setHojaMin(!hojaMin)} />
            <div className="lm-who">
              {ella
                ? <span className="lm-who-face lm-who-asistente"><AssistantFigure look={lookOfRow(ella)} size={44} /></span>
                : <Cara estado={chat.trabajando ? "pensando" : "reposo"} className="lm-who-face" />}
              <div className="lm-who-t">
                <b>{ella ? ella.name : "Len"}</b>
                {/* In her app, Len's work on the page on screen shows here too — his own turns and hers (§5.4). */}
                <span className={(ella ? lenTrabajaAqui : chat.trabajando) ? "lm-live" : undefined}>{ella ? (lenTrabajaAqui ? tas("lenTrabajando") : preguntaDeLen ? tas("lenPregunta") : t("estado")) : chat.trabajando ? t("trabajando") : t("estado")}</span>
              </div>
            </div>
            <div id="len-sheet-body" className="lm-body" inert={hojaMin}>
              <p className="lm-msg">{(ella ? dichoElla?.texto : dicho?.texto) || t("sinMensaje")}</p>
              <Progreso pasos={ella ? pasosDeLenAqui : chat.progreso} trabajando={ella ? lenTrabajaAqui : chat.trabajando} />
              <div className="lm-actions">
                {preguntaDeLen && id && (
                  <button type="button" className="lm-btn lm-sec" onClick={() => abrirTurnoDeLen(preguntaDeLen.id, id)}>{tas("contestar")}</button>
                )}
                {/* No call with her in this version (§5.7): talking by voice to her is a work of its own. */}
                {!ella && (
                  <button type="button" className="lm-btn lm-pri" onClick={() => setLlamada(true)}>
                    <Icono nombre="phone" />
                    <span>{t("llamar")}</span>
                  </button>
                )}
                <button type="button" className={`lm-btn ${ella ? "lm-pri" : "lm-sec"}`} onClick={() => setChatAbierto(true)}>
                  <Icono nombre="mic" />
                  <span>{ella ? tas("pedirCambio", { name: ella.name }) : tc("pedirCambio")}</span>
                </button>
              </div>
              <div className="ent-shortcuts">
                <button type="button" onClick={() => setPanel("gestion")}>{te("gestionar")}</button>
                <button type="button" onClick={() => { setComparando(null); setPanel("comparar"); }}>{te("comparar")}</button>
                <button type="button" onClick={() => setPanel("equipo")}>{tq("titulo")}</button>
                {id && herramientas && herramientas !== "off" && herramientas.paid && herramientas.tools.filter((x) => x.placement === "project" && sePuedeAbrir(x)).map((x) => (
                  <button key={x.id} type="button" className="herr-atajo" data-tool-shortcut={x.id} onClick={() => setHerramientaAbierta({ tool: x, proyecto: { id, title: p?.title ?? lista?.find((y) => y.id === id)?.title ?? "" } })}>
                    <IconoDeHerramienta cliente={cliente} tool={x} />{x.title}
                  </button>
                ))}
              </div>
              {/* No assistant yet, the welcome dismissed (§5.1): today's app, and an invitation to meet her. */}
              {modo.kind === "len" && modo.invite && (
                <button type="button" className="lm-btn lm-sec app-invitar" onClick={() => setBienvenidaCerrada(false)}>{tas("conoceATuAsistente")}</button>
              )}
              {/* The page on screen isn't hers (§5.6): what she can do about it, in her sheet too. */}
              {(() => {
                const enPantalla = ella ? lista.find((x) => x.id === id) : undefined;
                const extra = enPantalla ? juntoAlProyecto(enPantalla) : null;
                return extra ? <div className="app-hoja-junto" data-junto-hoja={id}>{extra}</div> : null;
              })()}
              {avisos.recibido && <ControlAvisos avisos={avisos} />}
            </div>
          </div>
        )}
      </section>

      {/* ONE chat (spec local 2026-11-16-movil-es-tu-asistente): hers in her app — her home's conversation, with the
          cards of the project on screen — and Len's in today's app. */}
      <PantallaChat
        abierto={chatAbierto}
        chat={ella ? chatDeElla : chat}
        cliente={cliente}
        projectId={ella ? ella.projectId : id}
        {...(ella ? { cardsProjectId: id, asistente: { name: ella.name, color: ella.color, look: ella.look }, lenCards: {
          byFila: pedidosALen.byFila,
          onStop: (turno: string) => void pedidosALen.stop(turno),
          projectTitle: (pid: string) => lista?.find((x) => x.id === pid)?.title ?? "",
          projectGone: (pid: string) => !!lista && !lista.some((x) => x.id === pid),
          onCompare: (r: LenRequestRef) => abrirPanelDelProyecto(r.projectId, "comparar", r.filaId),
          onPublish: (r: LenRequestRef) => abrirPanelDelProyecto(r.projectId, "gestion"),
          onOpen: (r: LenRequestRef) => abrirTurnoDeLen(r.filaId, r.projectId),
        } } : {})}
        idioma={idioma}
        conPip={!ella && llamada && conPip}
        onCerrar={() => { setChatAbierto(false); setEnfocarEnChat(null); }}
        onLlamar={() => setLlamada(true)}
        onVerPagina={() => setChatAbierto(false)}
        onEquipo={() => setPanel("equipo")}
        enfocar={enfocarEnChat}
        onEnfocado={alEnfocarEnChat}
        resaltarAviso={avisoDelChat?.id === id ? avisoDelChat.tarjeta : null}
        borrador={borrador}
        onAbrirHerramienta={(x) => void abrirHerramientaPorId(x)}
        onAbrirProyecto={(x) => { setChatAbierto(false); abrirAviso(x); }}
        onHerramientasCambiaron={releerHerramientas}
      />
      {herramientaAbierta && (
        <PantallaHerramienta
          key={herramientaAbierta.tool.id}
          cliente={cliente}
          tool={herramientaAbierta.tool}
          persona={herramientas && herramientas !== "off" ? herramientas.person : { name: "" }}
          proyecto={herramientaAbierta.proyecto}
          idioma={idioma}
          onCerrar={() => { setHerramientaAbierta(null); releerHerramientas(); }}
          onPrompt={herramientaAbierta.proyecto ? (texto) => { setBorrador({ texto, n: Date.now() }); setChatAbierto(true); } : null}
        />
      )}

      <PanelAnimado contexto={id}
        paso={panel === "equipo" ? `equipo:${equipo.hilo?.id ?? "lista"}` : panel === "asistente" ? `asistente:${asistenteAbierta?.asistente.id ?? ""}:${asistenteAbierta?.n ?? 0}` : panel === "turnoDeLen" ? `turno:${turnoDeLen?.fila ?? ""}` : panel ?? ""}
        onVolver={() => { if (panel === "equipo" && equipo.hilo) equipo.cerrarHilo(); else setPanel(null); }}
        nivel={panel === "equipo" ? 370 : panel === "comparar" ? 350 : panel === "look" ? 70 : 45}>
        {panel === "gestion" ? <Gestion cliente={cliente} projectId={id} idioma={idioma} trabajando={chat.trabajando} turnoId={chat.turnoId} onCerrar={() => setPanel(null)} onCambio={recargar} onEncargo={(texto, m) => { setPanel(null); if (!ella) setChatAbierto(true); void chat.mandarEncargo(texto, m); }} />
          : panel === "look" ? <TuLen onCerrar={() => setPanel(null)} />
          : panel === "comparar" ? <Comparacion cliente={cliente} projectId={id} {...(comparando ? { fila: comparando } : { page: ultimoTurnoDeLen(p?.historial ?? [])?.page })} onCerrar={() => setPanel(null)} />
          : panel === "equipo" ? <Equipo equipo={equipo} titulo={p?.title ?? ""} idioma={idioma} onCerrar={() => setPanel(null)} />
          : panel === "entregado" ? <DeliveredTab cliente={cliente} onCerrar={() => setPanel(null)} onIrAlChat={(destino, turno) => { setPanel(null); if (ella) { abrirTurnoDeLen(turno, destino); return; } setEnfocarEnChat(`${turno}:entregado`); abrirAviso(destino, "chat"); }} />
          : panel === "tareas" ? <TasksTab cliente={cliente} onCerrar={() => setPanel(null)} onAbrirProyecto={(destino, abrir, card) => { setPanel(null); if (card) abrirAvisoDeLen(destino, card); else abrirAviso(destino, abrir); }} />
          : panel === "agentes" ? <AgentsList agentes={asistentes} actual={ella?.id ?? null} onElegir={hablarCon} onCerrar={() => setPanel(null)} {...(agentesOn ? { onCrear: crearAgente } : {})} />
          : panel === "herramientas" ? <ToolsTab cliente={cliente} idioma={idioma} onCerrar={() => setPanel(null)} onAbrir={(tool) => { setPanel(null); setHerramientaAbierta({ tool, proyecto: null }); }} />
          : panel === "asistente" && asistenteAbierta ? <AssistantTab key={`${asistenteAbierta.asistente.id}:${asistenteAbierta.n}`} cubierta={!!ella && chatAbierto} cliente={cliente} asistente={asistenteAbierta.asistente} parte={asistenteAbierta.parte} tarjeta={asistenteAbierta.tarjeta ?? null} idioma={idioma} onCerrar={() => setPanel(null)} onHablar={() => hablarCon(asistenteAbierta.asistente)} onVerLen={(proyecto, fila) => { setPanel(null); if (ella && fila) { abrirTurnoDeLen(fila, proyecto); return; } abrirAviso(proyecto, ella ? undefined : "chat"); }} />
          : panel === "turnoDeLen" && turnoDeLen ? <LenTurnView key={turnoDeLen.fila} cliente={cliente} fila={turnoDeLen.fila} projectTitle={lista?.find((x) => x.id === turnoDeLen.projectId)?.title ?? ""} onClose={() => setPanel(null)}
              // Answering a question Len ended on: the next message to Len on that page, as the phone always answered
              // him — his next turn, which her sheet shows working (deferred minor of the final review).
              {...(turnoDeLen.projectId === id ? { onAnswer: (texto: string) => { setPanel(null); chat.mandar(texto); } } : {})} /> : null}
      </PanelAnimado>
      {p && <EntregaVisual key={id} projectId={id} turno={ultimoTurnoDeLen(p.historial)} onVer={() => { setChatAbierto(false); setHojaMin(true); }} />}
      {modo.kind === "welcome" && casaDeLaBienvenida && (
        <WelcomeCreator cliente={cliente} projectId={casaDeLaBienvenida} idioma={idioma} onCreated={yaNacio} onNotNow={() => { dismissWelcome(); setBienvenidaCerrada(true); }} />
      )}
      {archivoDelAviso && createPortal(<PhoneViewer cliente={cliente} file={archivoDelAviso} onClose={() => setArchivoDelAviso(null)} />, document.body)}

      {llamada && !ella && (
        <Llamada
          key={`llamada:${id}`}
          cliente={cliente}
          projectId={id}
          idioma={idioma}
          onPequena={setConPip}
          encargo={chat.encargo}
          dichoAlTerminar={chat.dichoAlTerminar}
          onTerminar={(tarjetas, segundos) => {
            setLlamada(false);
            setConPip(false);
            // Lo que pasó en la llamada queda en el chat (prototipo: «te lo dejo en el chat»).
            chat.agregarLlamada(segundos, tarjetas);
            if (segundos !== null || tarjetas.length) setChatAbierto(true);
            recargar();
          }}
        />
      )}
    </>
  );
}
