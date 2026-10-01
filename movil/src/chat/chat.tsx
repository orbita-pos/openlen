// El chat de la app (escena 6 del prototipo): la conversación de esa página
// con Len, como escribirle a alguien. Sin pasos ni herramientas — eso es el
// chat de la web. Entra desde la derecha; se va con la flecha, deslizando a la
// derecha o con atrás. El estado vive en `useChat` (en la principal): Len
// sigue trabajando aunque lo cierres.
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { Cara } from "../cara";
import { Icono } from "../iconos";
import { useDeslizar } from "../deslizar";
import { useAtras } from "../atras";
import { TarjetaDeLaApp } from "../llamada/tarjetas";
import { claveDeAvance, cualDia, diaLocal, type ElementoDelHilo } from "./hilo";
import { conGesto, type Gesto, type Micro } from "./grabadora";
import { useNota } from "./use-nota";
import type { Chat } from "./use-chat";

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
}

export function PantallaChat({ abierto, chat, cliente, projectId, idioma, conPip, onCerrar, onLlamar, onVerPagina }: Props) {
  const t = useTranslations("movil.chat");
  const tp = useTranslations("movil.principal");
  const tl = useTranslations("movil.llamada");
  const [texto, setTexto] = useState("");
  // La foto elegida espera arriba del campo (como WhatsApp) hasta que la
  // mandas con tu mensaje (Jesús, 01/10: mandarla al elegirla «no le gustará
  // a la gente»).
  const [adjunta, setAdjunta] = useState<{ foto: Blob; url: string } | null>(null);
  const [micro, setMicro] = useState<Micro>({ fase: "quieto" });
  const microRef = useRef<Micro>({ fase: "quieto" });
  const [arrastre, setArrastre] = useState(0);
  const log = useRef<HTMLDivElement>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const vistos = useRef(chat.elementos.length);
  const deslizar = useDeslizar({ hacia: "derecha", alSoltar: onCerrar });
  useAtras(abierto, onCerrar);

  const limite = useRef<() => void>(() => {});
  const nota = useNota(() => limite.current());
  const enviarNota = async () => {
    const n = await nota.terminar();
    if (n) chat.mandarNota(n);
  };
  useEffect(() => {
    // A los 2 minutos la nota se envía sola.
    limite.current = () => {
      microRef.current = { fase: "quieto" };
      setMicro(microRef.current);
      void enviarNota();
    };
  });

  // Siempre abajo del todo, como un chat: al abrir, al llegar algo, mientras escribe.
  useEffect(() => {
    const l = log.current;
    if (l) l.scrollTop = l.scrollHeight;
  }, [chat.elementos.length, chat.trabajando, abierto]);
  useEffect(() => {
    vistos.current = chat.elementos.length;
  });
  // Al abrirse el teclado el hilo encoge por abajo: si estabas al final, se
  // queda al final (lo último no se esconde detrás del campo).
  useEffect(() => {
    const l = log.current;
    if (!l) return;
    let alFinal = true;
    const alMover = () => {
      alFinal = l.scrollHeight - l.scrollTop - l.clientHeight < 40;
    };
    const ro = new ResizeObserver(() => {
      if (alFinal) l.scrollTop = l.scrollHeight;
    });
    l.addEventListener("scroll", alMover, { passive: true });
    ro.observe(l);
    return () => {
      ro.disconnect();
      l.removeEventListener("scroll", alMover);
    };
  }, []);

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
    if (adjunta) URL.revokeObjectURL(adjunta.url);
    setAdjunta(null);
  };
  const mandarTexto = () => {
    const x = texto.trim();
    if (!x && !adjunta) return;
    setTexto("");
    chat.mandar(x, adjunta?.foto);
    quitarAdjunta();
  };
  // Con la foto puesta, el pie crece: lo último del hilo no debe quedar debajo.
  useEffect(() => {
    const l = log.current;
    if (l) l.scrollTop = l.scrollHeight;
  }, [adjunta]);

  // Con texto o con una foto puesta, el botón envía (no graba).
  const hayTexto = texto.trim().length > 0 || adjunta !== null;
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
    const leido = i === ultimoMio && (i < chat.elementos.length - 1 || chat.trabajando);
    return (
      <div key={e.clave} className={cls}>
        <Burbuja e={e} chat={chat} cliente={cliente} projectId={projectId} idioma={idioma} onVerPagina={onVerPagina} />
        {leido && <span className="ch-rcpt">{t("leido")}</span>}
      </div>
    );
  });

  return (
    <section ref={deslizar} className={`lm-layer lm-chat${abierto ? " is-on" : ""}${conPip ? " has-pip" : ""}${adjunta ? " con-adjunta" : ""}`} aria-hidden={!abierto}>
      <header className="ch-top">
        <button type="button" className="ch-btn" aria-label={t("volver")} onClick={onCerrar}>
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
      </header>

      <div className="ch-log" ref={log} aria-live="polite">
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

      <div className="ch-foot" data-no-deslizar>
        {adjunta && (
          <div className="app-adjunta">
            {/* eslint-disable-next-line @next/next/no-img-element -- la app es Vite, no hay next/image */}
            <img src={adjunta.url} alt="" />
            <button type="button" aria-label={t("quitarFoto")} onClick={quitarAdjunta}>
              <Icono nombre="x" />
            </button>
          </div>
        )}
        <div className="lm-comp">
          <input
            ref={archivo}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (adjunta) URL.revokeObjectURL(adjunta.url);
              setAdjunta({ foto: f, url: URL.createObjectURL(f) });
            }}
          />
          <button type="button" className="ch-plus" aria-label={t("mandarFoto")} disabled={chat.trabajando || grabando} onClick={() => archivo.current?.click()}>
            <Icono nombre="plus" />
          </button>
          <div className={`lm-field${grabando ? " is-rec" : ""}`}>
            {/* textarea y no input: en un <input> Chrome pone encima del
                teclado su barra negra de autocompletar (contraseñas,
                direcciones), que se comía el poco sitio que deja el teclado. */}
            <textarea
              rows={1}
              placeholder={t("mensaje")}
              autoComplete="off"
              enterKeyHint="send"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
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
          {e.texto && <div className="ch-b">{e.texto}</div>}
          {(e.estado === "noSeEnvio" || e.estado === "noSeSubio") && (
            <span className="ch-rcpt">
              {t(e.estado)}
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
    default:
      return null;
  }
}
