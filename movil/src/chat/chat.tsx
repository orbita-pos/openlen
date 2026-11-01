// El chat de la app (escena 6 del prototipo): la conversación de esa página
// con Len, como escribirle a alguien. Sin pasos ni herramientas — eso es el
// chat de la web. Entra desde la derecha; se va con la flecha, deslizando a la
// derecha o con atrás. El estado vive en `useChat` (en la principal): Len
// sigue trabajando aunque lo cierres.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { Cara } from "../cara";
import { Icono } from "../iconos";
import { useDeslizar } from "../deslizar";
import { devolverFoco } from "../foco";
import { useAtras } from "../atras";
import { TarjetaDeLaApp } from "../llamada/tarjetas";
import { claveDeAvance, cualDia, diaLocal, type ElementoDelHilo } from "./hilo";
import { conGesto, type Gesto, type Micro } from "./grabadora";
import { useNota } from "./use-nota";
import type { Chat } from "./use-chat";
import { ElegirAdjunto } from "./elegir-adjunto";
import { tamanoArchivo } from "./archivos";
import { useSeguirChat } from "./use-seguir-chat";
import { DeliveredCards } from "./delivered-cards";

const reloj = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const ladoDe = (e: ElementoDelHilo): "me" | "len" | null =>
  e.tipo === "tu" || e.tipo === "voz" ? "me" : e.tipo === "len" || e.tipo === "verEnTuPagina" || e.tipo === "fallo" || e.tipo === "tarjeta" ? "len" : null;

interface Props {
  abierto: boolean;
  chat: Chat;
  cliente: ClienteDeOpenLen;
  projectId: string;
  idioma: string;
  /** La llamada pequeña flota encima: el hilo le deja sitio (.has-pip del prototipo). */
  conPip: boolean;
  onCerrar: () => void;
  onLlamar: () => void;
  onVerPagina: () => void;
  onEquipo?: () => void;
  /** Desde «Entregado»: la clave del elemento del hilo que hay que traer a la vista (el turno que entregó). */
  enfocar?: string | null;
  onEnfocado?: () => void;
}

export function PantallaChat({ abierto, chat, cliente, projectId, idioma, conPip, onCerrar, onLlamar, onVerPagina, onEquipo, enfocar, onEnfocado }: Props) {
  const t = useTranslations("movil.chat");
  const tp = useTranslations("movil.principal");
  const tl = useTranslations("movil.llamada");
  const tq = useTranslations("movil.equipo");
  const ta = useTranslations("movil.adjuntos");
  const [texto, setTexto] = useState("");
  // La foto elegida espera arriba del campo (como WhatsApp) hasta que la
  // mandas con tu mensaje (Jesús, 01/10: mandarla al elegirla «no le gustará
  // a la gente»).
  const [adjunta, setAdjunta] = useState<{ foto: Blob; url: string } | null>(null);
  const [micro, setMicro] = useState<Micro>({ fase: "quieto" });
  const microRef = useRef<Micro>({ fase: "quieto" });
  const [arrastre, setArrastre] = useState(0);
  const { log, contenido, puedeBajar, alFinal } = useSeguirChat(abierto, projectId, chat.elementos, enfocar, onEnfocado);
  const campo = useRef<HTMLTextAreaElement>(null);
  const volver = useRef<HTMLButtonElement>(null);
  const [archivos,setArchivos] = useState<File[]>([]);
  const [errorAdjunto,setErrorAdjunto] = useState<string|null>(null);
  useEffect(()=>{setArchivos([]);setAdjunta(null);setTexto("");setErrorAdjunto(null)},[projectId]);
  const vistos = useRef(chat.elementos.length);
  const deslizar = useDeslizar({ hacia: "derecha", rapido: true, activo: abierto, clave: projectId, alSoltar: onCerrar });
  useAtras(abierto, onCerrar);
  useEffect(() => {
    if (!abierto) return;
    const antes = document.activeElement as HTMLElement | null;
    volver.current?.focus({ preventScroll: true });
    return () => devolverFoco(antes);
  }, [abierto, projectId]);

  const limite = useRef<() => void>(() => {});
  const nota = useNota(() => limite.current());
  const enviarNota = async () => {
    const n = await nota.terminar();
    if (n) { alFinal(); chat.mandarNota(n); }
  };
  useEffect(() => {
    // A los 2 minutos la nota se envía sola.
    limite.current = () => {
      microRef.current = { fase: "quieto" };
      setMicro(microRef.current);
      void enviarNota();
    };
  });

  useEffect(() => { vistos.current = chat.elementos.length; });
  useLayoutEffect(() => {
    const el = campo.current;
    if (!el) return;
    const ajustar = () => { el.style.height = "44px"; el.style.height = `${Math.min(132, Math.max(44, el.scrollHeight))}px`; };
    ajustar();
    let ancho = el.clientWidth;
    const observador = new ResizeObserver(() => {
      // El ancho cambia al girar o redimensionar; el alto lo ajusta el texto.
      if (el.clientWidth !== ancho) { ancho = el.clientWidth; ajustar(); }
    });
    observador.observe(el);
    return () => observador.disconnect();
  }, [texto, abierto]);
  // La vista previa de una foto se libera al sustituirla, cambiar de proyecto o salir.
  useEffect(() => () => { if (adjunta) URL.revokeObjectURL(adjunta.url); }, [adjunta]);

  const gesto = (g: Gesto) => {
    const r = conGesto(microRef.current, g);
    microRef.current = r.micro;
    setMicro(r.micro);
    setArrastre(r.arrastre);
    if (r.efecto === "empezar") {
      void nota.empezar().then((x) => {
        if (x !== "sinMicro") return;
        microRef.current = { fase: "quieto" };
        setMicro(microRef.current);
        chat.avisar("sinMicro");
      });
    } else if (r.efecto === "cancelar") nota.cancelar();
    else if (r.efecto === "enviar") void enviarNota();
  };

  const quitarAdjunta = () => {
    setAdjunta(null);
  };
  const mandarTexto = () => {
    const x = texto.trim();
    if (!x && !adjunta && !archivos.length) return;
    alFinal();
    setTexto("");
    chat.mandar(x, adjunta?.foto, archivos);
    setArchivos([]);setErrorAdjunto(null);
    quitarAdjunta();
  };
  // Con texto o con una foto puesta, el botón envía (no graba).
  const hayTexto = texto.trim().length > 0 || adjunta !== null || archivos.length > 0;
  const grabando = micro.fase === "grabando";
  const fija = micro.fase === "grabando" && micro.fijo;
  const avance = claveDeAvance(chat.avance);
  const linea = chat.trabajando ? t(`avance.${avance ?? "trabajando"}`) : chat.pregunta ? t("tienePregunta") : "";
  const cara = grabando ? "escuchando" : chat.trabajando ? "pensando" : chat.pregunta ? "avisando" : "reposo";

  const ultimoMio = chat.elementos.map(ladoDe).lastIndexOf("me");
  const hoy = diaLocal(Date.now());
  // `as`: si no, TypeScript lo deja en `null` tras el map (no sigue asignaciones dentro de callbacks).
  let previo = null as "me" | "len" | null;
  const filas = chat.elementos.map((e, i) => {
    if (e.tipo === "dia") {
      previo = null;
      const c = cualDia(e.dia, hoy);
      const etiqueta = c === "hoy" ? t("hoy") : c === "ayer" ? t("ayer") : new Date(`${e.dia}T12:00:00`).toLocaleDateString(idioma, { weekday: "long", day: "numeric", month: "long" });
      // Como el prototipo («Hoy 9:41»): el día y la hora del primer mensaje de ese día.
      const hora = new Date(e.t).toLocaleTimeString(idioma, { hour: "numeric", minute: "2-digit" });
      return (
        <div key={e.clave} className="ch-day">
          {etiqueta} {hora}
        </div>
      );
    }
    if (e.tipo === "llamada") {
      previo = null;
      return (
        <div key={e.clave} className="ch-call">
          <Icono nombre="phone" />
          {t("llamada", { dur: reloj(e.segundos) })}
        </div>
      );
    }
    if (e.tipo === "aviso") {
      previo = null;
      return (
        <p key={e.clave} className="ch-day">
          {e.aviso === "sinMicro" ? `${t("sinMicro")} ${tl("microAjustes")}` : t("tope")}
        </p>
      );
    }
    const quien = ladoDe(e) ?? "len";
    const cls = ["ch-row", `is-${quien}`, previo === quien && "is-cont", i >= vistos.current && "is-new", (e.tipo === "verEnTuPagina" || e.tipo === "tarjeta") && "is-card"]
      .filter(Boolean)
      .join(" ");
    previo = quien;
    const recibido = (e.tipo === "tu" || e.tipo === "voz") && e.estado === "ok";
    const leido = i === ultimoMio && recibido && (!!chat.turnoId || chat.elementos.slice(i + 1).some(x => x.tipo === "len" || x.tipo === "verEnTuPagina"));
    return (
      <div key={e.clave} className={cls} data-clave={e.clave}>
        <Burbuja e={e} chat={chat} cliente={cliente} projectId={projectId} idioma={idioma} onVerPagina={onVerPagina} />
        {leido && <span className="ch-rcpt">{t("leido")}</span>}
      </div>
    );
  });

  return (
    <section ref={deslizar} className={`lm-layer lm-chat${abierto ? " is-on" : ""}${conPip ? " has-pip" : ""}${adjunta || archivos.length ? " con-adjunta" : ""}${errorAdjunto ? " con-adjuntos-error" : ""}`} aria-hidden={!abierto} inert={!abierto} role="dialog" aria-label="Len" aria-modal={abierto || undefined} onKeyDown={e => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCerrar(); }
      if (e.key === "Tab") {
        const bs = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),a[href]')];
        if (e.shiftKey && document.activeElement === bs[0]) { e.preventDefault(); bs.at(-1)?.focus(); }
        if (!e.shiftKey && document.activeElement === bs.at(-1)) { e.preventDefault(); bs[0]?.focus(); }
      }
    }}>
      <header className="ch-top">
        <button ref={volver} type="button" className="ch-btn" aria-label={t("volver")} onClick={onCerrar}>
          <Icono nombre="back" />
        </button>
        <div className="ch-who">
          <Cara estado={cara} className="ch-face" />
          <b className="ch-name">Len</b>
          <span className={`ch-st${linea ? " is-on" : ""}${chat.trabajando ? " ch-live" : ""}`}>{linea}</span>
        </div>
        <button type="button" className="ch-btn" aria-label={tp("llamar")} onClick={onLlamar}>
          <Icono nombre="phone" />
        </button>
        {onEquipo && <button type="button" className="ch-equipo" onClick={onEquipo}>@ {tq("titulo")}</button>}
      </header>

      <div className="ch-historial">
      <div className="ch-log" ref={log} role="log" aria-live="polite" aria-relevant="additions text">
        <div className="ch-contenido" ref={contenido}>
        {filas}
        {chat.trabajando && (
          <div className={`ch-row is-len${previo === "len" ? " is-cont" : ""}`}>
            <div className="ch-b ch-typing" aria-label={t("avance.trabajando")}>
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
        </div>
      </div>
      {puedeBajar && <button className="ch-volver-final" type="button" aria-label={t("irAlUltimo")} onClick={alFinal}><Icono nombre="arrowR" /></button>}
      </div>

      <div className="ch-foot" data-no-deslizar>
        {errorAdjunto && <p className="app-adjuntos-error" role="alert">{ta(errorAdjunto)}</p>}
        {(adjunta || archivos.length>0) && <div className="app-pendientes" data-no-deslizar>
          {adjunta && <div className="app-adjunta">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={adjunta.url} alt=""/>
            <button type="button" onClick={quitarAdjunta} aria-label={t("quitarFoto")}><Icono nombre="x"/></button>
          </div>}
          {archivos.map((f,i)=><div className="app-archivo-pendiente" key={`${i}:${f.name}`}><b>{f.name}</b><small>{tamanoArchivo(f.size)}</small><button type="button" aria-label={ta("quitar",{nombre:f.name})} onClick={()=>setArchivos(fs=>fs.filter((_,j)=>j!==i))}>×</button></div>)}
        </div>}
        <div className="lm-comp">
          <ElegirAdjunto key={projectId} cantidad={archivos.length} disabled={chat.trabajando || grabando} onError={setErrorAdjunto} onArchivos={fs=>setArchivos(xs=>[...xs,...fs])} onFoto={f=>{setAdjunta({foto:f,url:URL.createObjectURL(f)});}}/>
          <div className={`lm-field${grabando ? " is-rec" : ""}`}>
            {/* textarea y no input: en un <input> Chrome pone encima del
                teclado su barra negra de autocompletar (contraseñas,
                direcciones), que se comía el poco sitio que deja el teclado. */}
            <textarea
              ref={campo}
              rows={1}
              placeholder={t("mensaje")}
              autoComplete="off"
              enterKeyHint="send"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  mandarTexto();
                }
              }}
            />
            <div className="lm-rec">
              <i className="lm-rec-dot" />
              <span className="lm-rec-t">{reloj(nota.segundos)}</span>
              <div className="lm-rec-wave">
                {Array.from({ length: 22 }, (_, k) => {
                  const n = nota.niveles[k - (22 - nota.niveles.length)];
                  return <i key={k} style={{ height: n === undefined ? "12%" : `${Math.round(16 + n * 84)}%` }} />;
                })}
              </div>
              <span className="lm-rec-hint" style={fija ? undefined : { transform: `translateX(${arrastre * 0.6}px)`, opacity: Math.max(0, 1 + arrastre / 140) }}>
                {fija ? (
                  <button type="button" className="lm-link" onClick={() => gesto({ tipo: "cancelar" })}>
                    {t("cancelar")}
                  </button>
                ) : (
                  t("deslizaCancelar")
                )}
              </span>
            </div>
          </div>
          <button
            type="button"
            className={`lm-mic${grabando ? " is-rec" : ""}`}
            aria-label={hayTexto || fija ? t("enviar") : t("grabar")}
            onPointerDown={(e) => {
              if (hayTexto) return;
              e.preventDefault();
              if (microRef.current.fase === "quieto") e.currentTarget.setPointerCapture(e.pointerId);
              gesto({ tipo: "bajar", t: performance.now(), x: e.clientX });
            }}
            onPointerMove={(e) => {
              if (microRef.current.fase !== "grabando") return;
              const b = e.currentTarget;
              gesto({ tipo: "mover", x: e.clientX, escala: b.getBoundingClientRect().width / b.offsetWidth || 1 });
            }}
            onPointerUp={() => {
              if (!hayTexto) gesto({ tipo: "subir", t: performance.now() });
            }}
            onClick={() => {
              if (hayTexto) mandarTexto();
            }}
          >
            <Icono nombre={hayTexto || fija ? "send" : "mic"} />
          </button>
        </div>
      </div>
    </section>
  );
}

function Burbuja({ e, chat, cliente, projectId, idioma, onVerPagina }: {
  e: ElementoDelHilo;
  chat: Chat;
  cliente: ClienteDeOpenLen;
  projectId: string;
  idioma: string;
  onVerPagina: () => void;
}) {
  const t = useTranslations("movil.chat");
  const ta = useTranslations("movil.adjuntos");
  const estado = useTranslations("movil.tarjetas");
  const otraVez = (
    <>
      {" "}
      <button type="button" className="lm-link" onClick={() => chat.reintentar(e.clave)}>
        {t("reintentar")}
      </button>
      {" · "}
      <button type="button" className="lm-link" onClick={() => chat.borrar(e.clave)}>
        {t("borrar")}
      </button>
    </>
  );
  switch (e.tipo) {
    case "tu":
      return (
        <>
          {e.foto && (
            <div className="ch-b ch-photo">
              {/* La app es Vite, no Next: aquí no hay next/image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={e.foto} alt="" />
            </div>
          )}
          {e.archivos?.map((f,i)=><div className="ch-b ch-file" key={`${i}:${f.name}`}><b>{f.name}</b><small>{(f.kind??"pdf").toUpperCase()} · {tamanoArchivo(f.size)}</small></div>)}
          {e.texto && <div className="ch-b">{e.texto}</div>}
          {e.estado === "enviando" && <span className="ch-rcpt" role="status">{estado("enviando")}</span>}
          {(e.estado === "noSeEnvio" || e.estado === "noSeSubio") && (
            <span className="ch-rcpt">
              {e.estado === "noSeSubio" ? ta("subida") : t(e.estado)}
              {otraVez}
            </span>
          )}
        </>
      );
    case "voz":
      return (
        <>
          <div className="ch-b lm-vn">
            <button type="button" className="lm-vn-play" aria-label={t("escuchar")} onClick={() => void new Audio(e.url).play().catch(() => {})}>
              <Icono nombre="play" />
            </button>
            <div className="lm-vn-bars">
              {e.barras.map((h, k) => (
                <i key={k} style={{ height: `${h}%` }} />
              ))}
            </div>
            <span className="lm-vn-d">{reloj(e.segundos)}</span>
          </div>
          <div className="ch-tr">
            {e.transcripcion ? `«${e.transcripcion}»` : e.estado === "transcribiendo" ? <span className="ch-live">{t("transcribiendo")}</span> : t("noSeEntendio")}
            {e.estado === "enviando" && <span role="status"> {estado("enviando")}</span>}
            {e.estado === "noSeEnvio" && ` ${t("noSeEnvio")}`}
            {(e.estado === "noSeEntendio" || e.estado === "noSeEnvio") && otraVez}
          </div>
        </>
      );
    case "len":
      return <div className="ch-b">{e.texto}</div>;
    case "fallo":
      return <div className="ch-b">{t("fallo")}</div>;
    case "verEnTuPagina":
      return (
        <div className="ch-card">
          <button type="button" className="ch-card-act" onClick={onVerPagina}>
            {t("verEnTuPagina")}
            <Icono nombre="arrowR" />
          </button>
        </div>
      );
    case "tarjeta":
      return (
        <div className="ch-card">
          <TarjetaDeLaApp x={e.tarjeta} cliente={cliente} projectId={projectId} idioma={idioma} />
        </div>
      );
    case "entregado":
      return <DeliveredCards cliente={cliente} archivos={e.archivos} />;
    default:
      return null;
  }
}
