// La pantalla principal (escena 5 del prototipo): la barra, tu página de
// verdad en vista previa y la hoja de Len. La llamada (Task 10) se abre desde
// la hoja y, pequeña, flota encima.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

export function PantallaPrincipal({ cliente, idioma, onSalir }: { cliente: ClienteDeOpenLen; idioma: Idioma; onSalir: () => void }) {
  const t = useTranslations("movil.principal");
  const tv = useTranslations("movil.vacio");
  const tc = useTranslations("movil.chat");
  const te = useTranslations("movil.entrega");
  const tq = useTranslations("movil.equipo");
  const ta = useTranslations("movil.adjuntos");
  const ti = useTranslations("movil.interfaz");
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
  const [conPip, setConPip] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [panel, setPanel] = useState<"gestion" | "look" | "comparar" | "equipo" | null>(null);
  const idActual = useRef(id);
  const paginaCargada = useRef<string | null>(null);
  // El panel que pidió un aviso (una mención → Equipo; Len Watch → Gestión) para el proyecto que abre.
  const panelDelAviso = useRef<{ id: string; panel: "equipo" | "gestion" } | null>(null);
  useLayoutEffect(() => { idActual.current = id; paginaCargada.current = p?.id ?? null; }, [id, p]);
  useEffect(() => { setPanel(panelDelAviso.current?.id === id ? panelDelAviso.current.panel : null); panelDelAviso.current = null; setChatAbierto(false); setLlamada(false); setConPip(false); }, [id]);
  const abrirAviso = useCallback((destino: string, panelDestino?: "equipo" | "gestion") => {
    // El controlador ya verificó identidad y acceso. Releer la lista conserva
    // también sus títulos y evita abrir proyectos que ya no estén disponibles.
    void listarProyectos(cliente).then((ps) => {
      if (!ps.some((x) => x.id === destino)) return;
      if (panelDestino) {
        if (idActual.current !== destino) panelDelAviso.current = { id: destino, panel: panelDestino };
        else setPanel(panelDestino);
      }
      setLista(ps); setId(destino); setSelector(false); setMenu(false);
    }).catch(() => setSinRed(true));
  }, [cliente]);
  const avisos = useAvisos({ cliente, onAbrirProyecto: abrirAviso });
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
  const deslizarHoja = useHojaDeslizable({ encogida: hojaMin, alCambiar: setHojaMin });

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

  // Al acabar un turno (o volver de uno cortado): la conversación nueva y la
  // vista previa recargada, para que «Ver en tu página» enseñe el cambio.
  const recargar = useCallback(() => {
    if (!id) return;
    void leerProyecto(cliente, id).then((p) => { if (idActual.current === id) setP(p); }).catch(() => {});
    setRecarga((n) => n + 1);
  }, [cliente, id]);
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      const listener = AppNativa.addListener("appStateChange", ({ isActive }) => { if (isActive) void cargar(true); });
      return () => { void listener.then((l) => l.remove()); };
    }
    const volver = () => { if (document.visibilityState === "visible") void cargar(true); };
    document.addEventListener("visibilitychange", volver);
    return () => document.removeEventListener("visibilitychange", volver);
  }, [cargar]);

  // El chat (pieza 2). Si cuelgas o cierras con Len trabajando, el chat se
  // vuelve a enganchar al turno (lo que antes hacía aquí la hoja).
  const chat = useChat({
    cliente,
    base: BASE,
    projectId: id,
    idioma,
    historial: p?.historial ?? SIN_HISTORIAL,
    alCambiarLaPagina: recargar,
    textoDeFotoSola: tc("fotoSola"),
    textoDeArchivoSolo: ta("archivoSolo"),
  });
  const equipo = useEquipo({
    cliente, projectId: id, idioma, activo: panel === "equipo",
    alPedirLen: texto => { setPanel(null); setChatAbierto(true); chat.mandar(texto); },
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
        <div className={`lm-pagehost app-con-iframe${tamano !== "cel" ? " is-dv" : ""}`}>
          {vista && !vistaFallo ? (
            <iframe
              key={recarga}
              className="app-vista"
              src={vista}
              // Las banderas del lienzo de la web: lo que la publicada puede, sin sacarte de la app.
              sandbox={SANDBOX_REMOTO}
              allow={ALLOW_REMOTO}
              title={p?.title ?? "Vista previa"}
              style={tamano === "cel" ? undefined : { width: ANCHO[tamano], transform: `scale(${390 / ANCHO[tamano]})`, transformOrigin: "0 0", height: `calc((100% - var(--app-barra)) * ${ANCHO[tamano] / 390})` }}
              onError={() => setVistaFallo(true)}
            />
          ) : vistaFallo ? (
            <div className="app-vista-estado" role="alert"><p>{t("vistaNoCarga")}</p><button type="button" onClick={() => setIntentoVista(n => n + 1)}>{te("reintentar")}</button></div>
          ) : <div className="app-vista-estado" role="status"><p>{ti("cargandoPagina")}</p></div>}
        </div>

        <header className="lm-bar">
          <button className="ent-face-button" type="button" aria-label={te("tuLen")} onClick={() => setPanel("look")}><Cara estado="reposo" className="lm-bar-face" /></button>
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

        {/* Tus páginas ocupan el sitio de la hoja (dentro de la capa: fuera,
            su z-index la deja debajo de la app). Como en el prototipo, una
            sola hoja que cambia de contenido. */}
        {selector ? (
          <Selector proyectos={lista} actual={id} onElegir={(x) => { setId(x); setSelector(false); }} onCerrar={() => setSelector(false)} onSalir={onSalir}>
            <button type="button" className="lm-btn lm-sec" onClick={() => { setSelector(false); setPanel("look"); }}>{te("tuLen")}</button>
            <ControlAvisos avisos={avisos} />
          </Selector>
        ) : (
          <div ref={deslizarHoja} className={`lm-sheet lm-m lm-marca is-on app-main-sheet${hojaMin ? " is-min" : ""}`} data-kind="listo">
            <button type="button" className="lm-grab" aria-label={t("encoger")} aria-expanded={!hojaMin} aria-controls="len-sheet-body" onClick={() => setHojaMin(!hojaMin)} />
            <div className="lm-who">
              <Cara estado={chat.trabajando ? "pensando" : "reposo"} className="lm-who-face" />
              <div className="lm-who-t">
                <b>Len</b>
                <span className={chat.trabajando ? "lm-live" : undefined}>{chat.trabajando ? t("trabajando") : t("estado")}</span>
              </div>
            </div>
            <div id="len-sheet-body" className="lm-body" inert={hojaMin}>
              <p className="lm-msg">{dicho?.texto || t("sinMensaje")}</p>
              <Progreso pasos={chat.progreso} trabajando={chat.trabajando} />
              <div className="lm-actions">
                <button type="button" className="lm-btn lm-pri" onClick={() => setLlamada(true)}>
                  <Icono nombre="phone" />
                  <span>{t("llamar")}</span>
                </button>
                <button type="button" className="lm-btn lm-sec" onClick={() => setChatAbierto(true)}>
                  <Icono nombre="mic" />
                  <span>{tc("pedirCambio")}</span>
                </button>
              </div>
              <div className="ent-shortcuts">
                <button type="button" onClick={() => setPanel("gestion")}>{te("gestionar")}</button>
                <button type="button" onClick={() => setPanel("comparar")}>{te("comparar")}</button>
                <button type="button" onClick={() => setPanel("equipo")}>{tq("titulo")}</button>
              </div>
              {avisos.recibido && <ControlAvisos avisos={avisos} />}
            </div>
          </div>
        )}
      </section>

      <PantallaChat
        abierto={chatAbierto}
        chat={chat}
        cliente={cliente}
        projectId={id}
        idioma={idioma}
        conPip={llamada && conPip}
        onCerrar={() => setChatAbierto(false)}
        onLlamar={() => setLlamada(true)}
        onVerPagina={() => setChatAbierto(false)}
        onEquipo={() => setPanel("equipo")}
      />

      <PanelAnimado contexto={id}
        paso={panel === "equipo" ? `equipo:${equipo.hilo?.id ?? "lista"}` : panel ?? ""}
        onVolver={() => { if (panel === "equipo" && equipo.hilo) equipo.cerrarHilo(); else setPanel(null); }}
        nivel={panel === "equipo" ? 370 : panel === "comparar" ? 350 : panel === "look" ? 70 : 45}>
        {panel === "gestion" ? <Gestion cliente={cliente} projectId={id} idioma={idioma} trabajando={chat.trabajando} turnoId={chat.turnoId} onCerrar={() => setPanel(null)} onCambio={recargar} onEncargo={(texto, modo) => { setPanel(null); setChatAbierto(true); void chat.mandarEncargo(texto, modo); }} />
          : panel === "look" ? <TuLen onCerrar={() => setPanel(null)} />
          : panel === "comparar" ? <Comparacion cliente={cliente} projectId={id} page={ultimoTurnoDeLen(p?.historial ?? [])?.page} onCerrar={() => setPanel(null)} />
          : panel === "equipo" ? <Equipo equipo={equipo} titulo={p?.title ?? ""} idioma={idioma} onCerrar={() => setPanel(null)} /> : null}
      </PanelAnimado>
      {p && <EntregaVisual key={id} projectId={id} turno={ultimoTurnoDeLen(p.historial)} onVer={() => { setChatAbierto(false); setHojaMin(true); }} />}

      {llamada && (
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
