/* eslint-disable @next/next/no-img-element -- Esta interfaz corre en Vite/Capacitor, sin optimizador de imágenes de Next. */
import { useEffect, useRef } from "react";
import { useTranslations } from "use-intl";
import { useAtras } from "../atras";
import { devolverFoco } from "../foco";
import { CajaMenciones, TextoMenciones } from "./menciones";
import type { ControlEquipo } from "./use-equipo";
import "./equipo.css";

const fecha = (valor: number | string, idioma: string) => {
  const d = new Date(valor);
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat(idioma, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d) : "";
};
export function Equipo({ equipo: e, titulo, idioma, onCerrar }: { equipo: ControlEquipo; titulo: string; idioma: string; onCerrar: () => void }) {
  const t = useTranslations("movil.equipo");
  const tc = useTranslations("movil.chat");
  const panel = useRef<HTMLElement>(null);
  const cerrar = useRef<HTMLButtonElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const alFinal = useRef(true);
  const conHilo = !!e.hilo;
  useAtras(true, onCerrar);
  useAtras(!!e.hilo, e.cerrarHilo);
  const cerrarPanel = () => {
    // Los dos listeners cierran sus capas al recibir popstate. Desmontarlas
    // juntas antes de volver dejaba una entrada invisible del panel.
    if (conHilo) history.go(-2);
    else onCerrar();
  };
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    cerrar.current?.focus();
    return () => devolverFoco(antes);
  }, []);
  useEffect(() => {
    const el = feed.current;
    if (!el) return;
    if (e.pestana === "hilos" && !conHilo) el.scrollTop = 0;
    else if (alFinal.current) el.scrollTop = el.scrollHeight;
  }, [e.datos?.mensajes.length, e.hilo?.id, e.hilo?.mensajes.length, e.pestana, conHilo]);
  const d = e.datos;
  const personas = d?.personas ?? [];
  const destino = e.hilo || e.pestana === "mensajes";
  const codigos: Record<string, string> = { no_disponible: "noDisponible", sin_acceso: "sinAcceso", sin_mencion: "sinMencion", solo_lectura: "soloLectura" };
  return <section className="eq-panel lm-chat" role="dialog" aria-modal="true" aria-labelledby="eq-titulo" ref={panel} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); cerrarPanel(); }
    if (event.key === "Tab") {
      const opciones = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),a[href]') ?? [])];
      const primero = opciones[0], ultimo = opciones.at(-1);
      if (event.shiftKey && document.activeElement === primero) { event.preventDefault(); ultimo?.focus(); }
      if (!event.shiftKey && document.activeElement === ultimo) { event.preventDefault(); primero?.focus(); }
    }
  }}>
    <header className="eq-top"><div><small>{titulo}</small><h1 id="eq-titulo">{t("titulo")}</h1></div><button ref={cerrar} type="button" aria-label={t("cerrar")} onClick={cerrarPanel}>×</button></header>
    <nav className="eq-tabs" aria-label={t("titulo")}>{(["mensajes", "hilos"] as const).map(p => <button key={p} type="button" aria-pressed={e.pestana === p} onClick={() => { alFinal.current = true; e.cambiarPestana(p); }}>{t(p)}{p === "hilos" && !!d?.hilos.some(h => h.sinVer > 0) && <span className="eq-punto" aria-label={t("nuevo")} />}</button>)}<button type="button" className="eq-refrescar" disabled={e.cargando || e.ocupado} onClick={() => void e.recargar()} aria-label={t("actualizar")}>↻</button></nav>
    <p className="eq-publico">{t("publico")}</p>
    {e.error && <div className="eq-error" role="alert"><span>{t(codigos[e.error] ?? "error")}</span><button type="button" onClick={() => void e.recargar()}>{t("reintentar")}</button></div>}
    {!d && e.cargando && <p className="eq-vacio" role="status">{t("cargando")}</p>}
    {d && <>
      {e.hilo && <div className="eq-hilo-top"><button type="button" onClick={() => { alFinal.current = true; e.cerrarHilo(); }}>‹ {t("volver")}</button><span>{e.hilo.ruta}:{e.hilo.linea}</span><small>{t(e.hilo.estado)}</small></div>}
      <div className="eq-feed" ref={feed} onScroll={event => { const el = event.currentTarget; alFinal.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
        {e.pestana === "mensajes" ? <>
          {!d.mensajes.length && <p className="eq-vacio">{t("vacio")}</p>}
          {d.mensajes.map(m => <article key={m.id} className={`eq-mensaje${m.autorId === d.yo ? " es-mio" : ""}`}>
            <header><b>{m.autorId === d.yo ? t("yo") : m.autor || t("miembro")}</b><time>{fecha(m.fecha, idioma)}</time></header>
            <p><TextoMenciones texto={m.texto} personas={personas} /></p>
            {m.fotos.map((foto, i) => <img key={i} src={foto.url} alt={foto.alt} loading="lazy" />)}
          </article>)}
        </> : e.hilo ? <>
          {e.hilo.codigo && <details className="eq-contexto"><summary>{t("contexto")}</summary><pre>{e.hilo.codigo}</pre></details>}
          {e.hilo.mensajes.map(m => <article key={m.id} className={`eq-mensaje${m.autorId === d.yo ? " es-mio" : ""}`}>
            <header><b>{m.autorId === null ? "Len" : m.autorId === d.yo ? t("yo") : m.autor || t("miembro")}</b><time>{fecha(m.createdAt, idioma)}</time></header>
            <p><TextoMenciones texto={m.texto} personas={personas} /></p>
          </article>)}
          {e.esperandoLen && <p className="eq-vacio" role="status">{tc("avance.trabajando")}</p>}
        </> : <>
          {!d.hilos.length && <p className="eq-vacio">{t("hilosVacios")}</p>}
          {d.hilos.map(h => <button type="button" className="eq-hilo" key={h.id} onClick={() => { alFinal.current = true; e.abrirHilo(h.id); }}>
            <span><b>{h.ruta}:{h.linea}</b><small>{t(h.estado)}{h.sinVer > 0 && ` · @${h.sinVer}`}</small></span><p>{h.mensajes.at(-1)?.texto ?? h.codigo}</p>
          </button>)}
        </>}
      </div>
      {e.hilo && (d.puedeLen || e.hilo.creadoPor === d.yo) && <button className="eq-estado" type="button" disabled={e.ocupado} onClick={() => void e.cambiarEstado(e.hilo!.estado === "abierto" ? "resuelto" : "abierto")}>{t(e.hilo.estado === "abierto" ? "resolver" : "reabrir")}</button>}
      {destino && <form className="eq-foot" onSubmit={event => { event.preventDefault(); void e.enviar(); }}>
        <CajaMenciones value={e.texto} onChange={e.cambiarTexto} personas={personas.filter(p => p.userId !== d.yo)} conLen={d.puedeLen} disabled={e.ocupado} label={t("mensaje")} placeholder={t(e.hilo ? "respuestaPlaceholder" : "mensajePlaceholder")} onEnviar={() => void e.enviar()} />
        <div className="eq-enviar"><small>{t(d.puedeLen ? "ayuda" : "lector")}</small><button type="submit" disabled={!e.texto.trim() || e.ocupado}>{t(e.ocupado ? "enviando" : "enviar")}</button></div>
      </form>}
    </>}
  </section>;
}
