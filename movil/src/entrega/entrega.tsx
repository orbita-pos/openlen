import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { StoredChatTurn } from "@/lib/projects/types";
import { terminaEnPregunta } from "../chat/hilo";
import { useAtras } from "../atras";
import { devolverFoco } from "../foco";
import { Cara } from "../cara";
import type { Paso } from "./progreso";
import "./entrega.css";

export function esEntrega(turno?: StoredChatTurn): boolean {
  return !!turno && turno.tipo !== "persona" && turno.status === "applied" && !turno.enCurso && !turno.noDocChange && !turno.cortado && !terminaEnPregunta([turno]) && !turno.actions?.some((a) => a.status === "error");
}

export function Progreso({ pasos = [], trabajando }: { pasos?: Paso[]; trabajando: boolean }) {
  const t = useTranslations("movil.entrega");
  const avance = useTranslations("movil.chat.avance");
  // A finished step says what was done, like Claude Code's: «working…» on a ✓ read as if Len were still at it (31/10).
  const hecho = useTranslations("movil.chat.hecho");
  if (!pasos.length) return null;
  return <details className="ent-progreso" open={trabajando || pasos.some((p) => p.estado === "error" || p.estado === "warning")}>
    <summary>{t("progreso")}</summary>
    <ol>{pasos.map((p, i) => <li key={i} data-estado={p.estado}>
      <span aria-hidden="true">{p.estado === "done" ? "✓" : p.estado === "error" || p.estado === "warning" ? "!" : p.estado === "running" ? "◉" : "○"}</span>
      <span>{p.texto ?? (p.estado === "done" ? hecho : avance)(p.clave ?? "trabajando")}{(p.estado === "error" || p.estado === "warning") && <small>{t("fallo")}</small>}</span>
    </li>)}</ol>
  </details>;
}

type Version = { html: string; fecha: string };
type Cambio = { antes: Version; ahora: Version };
export function Comparacion({ cliente, projectId, page, onCerrar }: { cliente: ClienteDeOpenLen; projectId: string; page?: string | null; onCerrar: () => void }) {
  const t = useTranslations("movil.entrega");
  const [cambio, setCambio] = useState<Cambio | null>(null);
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");
  const [intento, setIntento] = useState(0);
  const [lado, setLado] = useState<"antes" | "ahora">("ahora");
  const panel = useRef<HTMLElement>(null);
  const cerrar = useRef<HTMLButtonElement>(null);
  useAtras(true, onCerrar);
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    cerrar.current?.focus();
    return () => devolverFoco(previo);
  }, []);
  useEffect(() => {
    let vigente = true;
    setCambio(null); setEstado("cargando");
    const params = new URLSearchParams({ project: projectId });
    if (page) params.set("page", page);
    void cliente.pedir(`/api/movil/entrega?${params}`).then(async (r) => {
      if (!r.ok) throw new Error("entrega");
      const j = await r.json() as { comparacion: Cambio | null };
      if (vigente) { setCambio(j.comparacion); setEstado("listo"); }
    }).catch(() => { if (vigente) setEstado("error"); });
    return () => { vigente = false; };
  }, [cliente, projectId, page, intento]);
  return <section className="ent-panel" ref={panel} role="dialog" aria-modal="true" aria-label={t("comparar")} onKeyDown={(e) => {
    if (e.key === "Escape") onCerrar();
    if (e.key === "Tab") {
      const botones = [...(panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const primero = botones[0], ultimo = botones.at(-1);
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo?.focus(); }
      if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero?.focus(); }
    }
  }}>
    <header><div><small>{t("ultimoCambio")}{page ? ` · /${page}` : ""}</small><h1>{t("comparar")}</h1></div><button ref={cerrar} type="button" onClick={onCerrar} aria-label={t("cerrar")}>×</button></header>
    {estado === "cargando" && <p role="status">{t("cargando")}</p>}
    {estado === "error" && <div role="alert"><p>{t("error")}</p><button className="lm-btn lm-pri" onClick={() => setIntento((x) => x + 1)}>{t("reintentar")}</button></div>}
    {estado === "listo" && !cambio && <p>{t("sinAntes")}</p>}
    {cambio && <>
      <div className="ent-tabs" role="group" aria-label={t("comparar")}>{(["antes", "ahora"] as const).map((x) => <button key={x} type="button" aria-pressed={lado === x} onClick={() => setLado(x)}>{t(x)}</button>)}</div>
      <div className="ent-versiones">{(["antes", "ahora"] as const).map((x) => <figure key={x} hidden={lado !== x}>
        <figcaption>{t(x)} <time dateTime={cambio[x].fecha}>{new Date(cambio[x].fecha).toLocaleString()}</time></figcaption>
        {/* HTML del usuario: origen opaco, sin scripts, formularios, ventanas ni navegación del padre. */}
        <iframe title={t(x)} sandbox="" srcDoc={cambio[x].html} referrerPolicy="no-referrer" tabIndex={-1} />
      </figure>)}</div>
      <p className="ent-nota">{t("vistaEstatica")}</p>
    </>}
  </section>;
}

/** Sólo turnos nuevos: abrir otra página no vuelve a celebrar su historial. */
export function EntregaVisual({ projectId, turno, onVer }: { projectId: string | null; turno?: StoredChatTurn; onVer: () => void }) {
  const t = useTranslations("movil.entrega");
  const anterior = useRef(`${projectId}:${turno?.id ?? ""}:${!!turno?.enCurso}`);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const clave = `${projectId}:${turno?.id ?? ""}:${!!turno?.enCurso}`;
    if (anterior.current === clave) return;
    anterior.current = clave;
    if (!esEntrega(turno)) return;
    setVisible(true);
  }, [projectId, turno]);
  useEffect(() => {
    if (!visible) return;
    const reloj = window.setTimeout(() => setVisible(false), 1500);
    return () => window.clearTimeout(reloj);
  }, [visible]);
  if (!visible) return null;
  return <button className="ent-revelar" type="button" onClick={() => { setVisible(false); onVer(); }} aria-label={t("verPagina")}>
    <Cara estado="reposo" className="ent-cara" /><strong>{t("listo")}</strong><span>{t("verPagina")} ↗</span>
  </button>;
}
