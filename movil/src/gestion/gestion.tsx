import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { Capacitor } from "@capacitor/core";
import { subdomainFromTitle, PUBLISHED_BASE_HOST } from "@/lib/publish/base-host";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { DatosDeVisitas } from "@/lib/voz/tarjeta-de-visitas";
import type { Idioma } from "../config";
import { useAtras } from "../atras";
import { devolverFoco } from "../foco";
import { cargarGestion, comprobarNombre, publicar, leerVisitas, quitarEncargo, pausarEncargo, ErrorGestion, urlPublicada, type ProyectoGestion, type ConfirmacionPublicar } from "./api";
import "./gestion.css";

type Seccion = "publicar" | "numeros" | "encargos";
function textoDelDetalle(valor: unknown): string {
  if (typeof valor === "string") return valor;
  if (!valor || typeof valor !== "object") return "";
  const d = valor as Record<string, unknown>;
  const campos = [d.description || d.kind || d.category, d.table, d.column, d.count, d.from, d.to, d.migration, d.statement, d.file, d.line, d.exploitScenario, d.recommendation];
  if (d.params && typeof d.params === "object") campos.push(...Object.entries(d.params).map(([k,v]) => `${k}: ${String(v)}`));
  return campos.filter(v => v !== undefined && v !== null && v !== "").map(String).join(" · ");
}
interface Props {
  cliente: ClienteDeOpenLen; projectId: string; idioma: Idioma; trabajando: boolean; turnoId: string | null;
  onCerrar: () => void; onCambio: () => void; onEncargo: (texto: string, modo: "create" | "resume") => void;
}
// El cambio de proyecto desmonta la instancia: ninguna respuesta vieja cruza de página.
export function Gestion(props: Props) { return <Contenido key={props.projectId} {...props} />; }

function Contenido({ cliente, projectId, idioma, trabajando, turnoId, onCerrar, onCambio, onEncargo }: Props) {
  const t = useTranslations("movil.gestion");
  const [seccion, setSeccion] = useState<Seccion>("publicar");
  const [proyecto, setProyecto] = useState<ProyectoGestion | null>(null);
  const [nombre, setNombre] = useState("");
  const [estadoNombre, setEstadoNombre] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [aviso, setAviso] = useState("");
  const [visitas, setVisitas] = useState<DatosDeVisitas | null>(null);
  const [cargandoVisitas, setCargandoVisitas] = useState(false);
  const [objetivo, setObjetivo] = useState("");
  const [aceptado, setAceptado] = useState(false);
  const [confirmaciones, setConfirmaciones] = useState<ConfirmacionPublicar>({});
  const [revision, setRevision] = useState(0);
  const vivo = useRef(true);
  const panel = useRef<HTMLElement>(null);
  useAtras(true, onCerrar);
  useEffect(() => {
    vivo.current = true;
    const previo = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => { vivo.current = false; devolverFoco(previo); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void cargarGestion(cliente, projectId, controller.signal).then(p => {
      if (controller.signal.aborted) return;
      setProyecto(p); setNombre(n => n || p.subdomain || subdomainFromTitle(p.title) || `p-${projectId.slice(0, 8)}`);
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e : new Error(String(e))); });
    return () => controller.abort();
  }, [cliente, projectId, revision, trabajando]);
  useEffect(() => {
    if (seccion !== "numeros") return;
    const controller = new AbortController();
    setCargandoVisitas(true); setVisitas(null);
    void leerVisitas(cliente, projectId, Intl.DateTimeFormat().resolvedOptions().timeZone, controller.signal).then(v => {
      if (!controller.signal.aborted) setVisitas(v);
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e : new Error(String(e))); })
      .finally(() => { if (!controller.signal.aborted) setCargandoVisitas(false); });
    return () => controller.abort();
  }, [cliente, projectId, seccion, revision]);

  async function accion(f: () => Promise<void>) {
    if (ocupado) return;
    setOcupado(true); setError(null); setAviso("");
    try { await f(); } catch(e) { if (vivo.current) setError(e instanceof Error ? e : new Error(String(e))); }
    finally { if (vivo.current) setOcupado(false); }
  }
  async function publicarAhora(extra: ConfirmacionPublicar = {}) {
    setAceptado(false);
    const permisos = { ...confirmaciones, ...extra };
    setConfirmaciones(permisos);
    await accion(async () => {
      if (nombre !== proyecto?.subdomain) {
        const disponible = await comprobarNombre(cliente, nombre);
        if (!vivo.current) return;
        if (!disponible.available) { setEstadoNombre(disponible.reason ?? "taken"); return; }
      }
      const res = await publicar(cliente, projectId, nombre, idioma, permisos);
      if (!vivo.current) return;
      const url = urlPublicada({ publishedAt: res.publishedAt || true, deployUrl: res.url });
      setProyecto(p => p && ({ ...p, subdomain: nombre, url, hasUnpublishedChanges: false }));
      setAviso(t("publicada")); onCambio();
    });
  }
  const url = proyecto?.url;
  async function compartir() {
    if (!url) return;
    await accion(async () => {
      try {
        if (Capacitor.isNativePlatform()) {
          const { Share } = await import("@capacitor/share");
          await Share.share({ title: proyecto?.title, url });
        } else if (navigator.share) await navigator.share({ title: proyecto?.title, url });
        else { await navigator.clipboard.writeText(url); if (vivo.current) setAviso(t("copiado")); }
      } catch (e) {
        if (e instanceof Error && (e.name === "AbortError" || /cancel/i.test(e.message))) return;
        throw e;
      }
    });
  }
  const problema = error instanceof ErrorGestion ? error : null;
  let permiso: ConfirmacionPublicar | null = null;
  if (problema?.codigo === "security_findings" && /^[0-9a-f]{64}$/.test(String(problema.datos.fingerprint))) permiso = { acceptSecurityFingerprint: String(problema.datos.fingerprint) };
  if (problema?.codigo === "confirmation_required" && /^[0-9a-f]{64}$/.test(String(problema.datos.fingerprint))) permiso = { confirmFingerprint: String(problema.datos.fingerprint) };
  if (problema?.codigo === "secrets_required") permiso = { skipMissingSecrets: true };
  const goal = proyecto?.goal;
  const puedeEditar = proyecto?.rol !== "lector";
  const dueno = proyecto?.rol === "dueno";
  const cambiar = (s: Seccion) => { setSeccion(s); setError(null); setAviso(""); setAceptado(false); };
  const detalle = problema?.datos;
  const detalles = detalle ? [detalle.blocking, detalle.destructive, detalle.missing, detalle.errors, detalle.versions].flatMap(v => Array.isArray(v) ? v : []) : [];

  return <section className="app-gestion lm-m lm-marca" role="dialog" aria-modal="true" aria-labelledby="gestion-titulo" tabIndex={-1} ref={panel} onKeyDown={e => {
    if (e.key === "Escape") { e.stopPropagation(); onCerrar(); }
    if (e.key === "Tab") {
      const items = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href]') ?? [])];
      const primero = items[0], ultimo = items.at(-1);
      if (e.shiftKey && (document.activeElement === primero || document.activeElement === panel.current)) { e.preventDefault(); ultimo?.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero?.focus(); }
    }
  }}>
    <header><div><p className="gestion-ceja">Len</p><h1 id="gestion-titulo">{t("titulo")}</h1></div><button className="gestion-cerrar" onClick={onCerrar} aria-label={t("cerrar")}>×</button></header>
    <nav aria-label={t("titulo")}>{(["publicar", "numeros", "encargos"] as const).map(s => <button key={s} aria-pressed={seccion === s} onClick={() => cambiar(s)}>{t(s)}</button>)}</nav>
    <div className="gestion-cuerpo">
      {proyecto && <p className="gestion-proyecto">{proyecto.title}</p>}
      {!proyecto && !error && <p role="status">{t("cargando")}</p>}
      {proyecto && seccion === "publicar" && <>
        <h2>{t(proyecto.url ? "publicada" : "listo")}</h2><p>{t(proyecto.url ? (proyecto.hasUnpublishedChanges ? "cambios" : "visible") : "borrador")}</p>
        {puedeEditar && <><label htmlFor="gestion-nombre">{t("direccion")}</label><div className="gestion-direccion"><input id="gestion-nombre" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={63} value={nombre} disabled={ocupado || !dueno} onChange={e => { setNombre(e.target.value.toLowerCase().trim()); setEstadoNombre(null); setError(null); setConfirmaciones({}); setAceptado(false); }} /><span>.{PUBLISHED_BASE_HOST}</span></div>
        <button className="gestion-texto" disabled={ocupado || !nombre || !dueno} onClick={() => void accion(async () => { const r = await comprobarNombre(cliente, nombre); if (vivo.current) setEstadoNombre(r.available ? "disponible" : r.reason ?? "taken"); })}>{t("comprobar")}</button>
        {estadoNombre && <p role="status">{t(["disponible", "invalid", "reserved", "taken", "limit_reached"].includes(estadoNombre) ? estadoNombre : "taken")}</p>}
        <button className="gestion-principal" disabled={ocupado || trabajando || !nombre || (!!estadoNombre && estadoNombre !== "disponible")} onClick={() => void publicarAhora()}>{t(ocupado ? "espera" : proyecto.url ? "actualizar" : "publicar")}</button></>}
        {url && <a className="gestion-url" href={url} target="_blank" rel="noopener noreferrer">{url}</a>}
        <div className="gestion-acciones"><button disabled={!url || ocupado} onClick={() => void compartir()}>{t("compartir")}</button><button disabled={!url || ocupado} onClick={() => void accion(async () => { if(url) { await navigator.clipboard.writeText(url); if (vivo.current) setAviso(t("copiado")); } })}>{t("copiar")}</button></div>
      </>}
      {proyecto && seccion === "numeros" && <><h2>{t("numeros")}</h2><p>{t("semana")}</p>{cargandoVisitas && <p role="status">{t("cargando")}</p>}{visitas && <><div className="gestion-numeros">{([ [visitas.vistas, "visitas"], [visitas.personas, "personas"], [visitas.hoy, "hoy"] ] as const).map(([n,k]) => <div key={k}><strong>{new Intl.NumberFormat(idioma).format(n)}</strong><span>{t(k)}</span></div>)}</div>{visitas.vistas === 0 && <p>{t("sinVisitas")}</p>}{visitas.porDia.length > 0 && <table><thead><tr><th>{t("dia")}</th><th>{t("visitas")}</th></tr></thead><tbody>{visitas.porDia.map(d => <tr key={d.dia}><td>{new Intl.DateTimeFormat(idioma, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(d.dia))}</td><td>{d.vistas}</td></tr>)}</tbody></table>}</>}<button disabled={cargandoVisitas} onClick={() => { setError(null); setRevision(n => n + 1); }}>{t("refrescar")}</button></>}
      {proyecto && seccion === "encargos" && <><h2>{t("encargos")}</h2><p>{t("encargoAyuda")}</p>{goal ? <article className="gestion-encargo"><span className="gestion-estado">{t(goal.phase === "active" && goal.activation === "disarmed" && !trabajando ? "paused" : goal.phase)}</span><h3>{goal.objective}</h3><p>{t("rondas", { n: goal.roundsStarted, max: goal.maxGoalRounds })}</p>{goal.blockedReason && <p>{goal.blockedReason.message}</p>}{dueno && <div className="gestion-acciones">{trabajando ? <button disabled={ocupado || !turnoId} onClick={() => void accion(async () => { if(turnoId) { await pausarEncargo(cliente, turnoId); if(vivo.current) setAviso(t("pausando")); } })}>{t("pausar")}</button> : goal.phase !== "complete" && <button disabled={ocupado} onClick={() => onEncargo(goal.objective, "resume")}>{t("reanudar")}</button>}<button disabled={ocupado || trabajando} onClick={() => void accion(async () => { await quitarEncargo(cliente, projectId); if (vivo.current) { setProyecto(p => p && ({ ...p, goal: null })); onCambio(); } })}>{t("quitar")}</button></div>}</article> : <p>{t("sinEncargo")}</p>}{dueno && (!goal || goal.phase === "complete") && <form onSubmit={e => { e.preventDefault(); if(objetivo.trim() && !trabajando) onEncargo(objetivo.trim(), "create"); }}><label htmlFor="gestion-objetivo">{t("objetivo")}</label><textarea id="gestion-objetivo" value={objetivo} onChange={e => setObjetivo(e.target.value)} rows={4} maxLength={8000} placeholder={t("ejemplo")} /><button className="gestion-principal" disabled={!objetivo.trim() || trabajando || ocupado}>{t("enviar")}</button></form>}</>}
      {error && <div className="gestion-error" role="alert"><strong>{t(problema?.codigo === "security_review_pending" ? "revision" : permiso ? "confirmarAviso" : "error")}</strong>{problema && <p>{problema.codigo}</p>}{error.message !== problema?.codigo && <p>{error.message}</p>}{detalles.length > 0 && <ul>{detalles.map((d, i) => <li key={i}>{textoDelDetalle(d)}</li>)}</ul>}{permiso && <><label className="gestion-consentir"><input type="checkbox" checked={aceptado} onChange={e => setAceptado(e.target.checked)} />{t("aceptarRiesgo")}</label><button disabled={!aceptado || ocupado} onClick={() => void publicarAhora(permiso!)}>{t("publicarIgual")}</button></>}{problema?.codigo === "security_review_pending" && <button disabled={ocupado} onClick={() => void publicarAhora()}>{t("reintentar")}</button>}{!proyecto && <button onClick={() => setRevision(n => n + 1)}>{t("reintentar")}</button>}</div>}
      {(aviso || ocupado) && <p role="status">{aviso || t("espera")}</p>}
    </div>
  </section>;
}

