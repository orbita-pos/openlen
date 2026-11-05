// Las tarjetas de la llamada, con las clases del prototipo (.nx…). Los datos
// de visitas son los de /api/voz/visitas = lo que lee Len con get_visits. El
// borrador y publicar hacen lo mismo que las tarjetas del chat de la web
// (AgentReplyCard, AgentConfirmCard): el toque del usuario es lo único que
// manda o publica.
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { TarjetaDeLlamada } from "@/components/llamada/puente-a-len";
import type { DatosDeVisitas } from "@/lib/voz/tarjeta-de-visitas";
import { enlaceDeCorreo, enlaceDeWhatsApp } from "@/lib/resultados/enlaces-de-respuesta";
import { publishedHost } from "@/lib/publish/base-host";
import { postInstallAfterSecurity, type PublishOutcome } from "@/lib/workspace-v2/publish-request";
import { Icono } from "../iconos";
import { barrasDeVisitas } from "./barras";

const DIA = (iso: string, idioma: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(idioma, { weekday: "short" }).replace(".", "");

function Visitas({ cliente, projectId, idioma }: { cliente: ClienteDeOpenLen; projectId: string; idioma: string }) {
  const t = useTranslations("movil.tarjetas");
  const [d, setD] = useState<DatosDeVisitas | null>(null);
  const [entra, setEntra] = useState("");
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");
  const [intento, setIntento] = useState(0);
  const tg = useTranslations("movil.gestion");
  useEffect(() => {
    let vigente = true;
    setD(null); setEstado("cargando");
    const zona = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
    void cliente
      .pedir(`/api/voz/visitas?project=${encodeURIComponent(projectId)}&zona=${zona}`)
      .then(r => { if (!r.ok) throw new Error("visitas"); return r.json() as Promise<DatosDeVisitas>; })
      .then(x => { if (vigente) { setD(x); setEstado("listo"); } })
      .catch(() => { if (vigente) setEstado("error"); });
    return () => { vigente = false; };
  }, [cliente, projectId, intento]);
  // Como el prototipo: la tarjeta entra (is-in), luego crecen las barras
  // (is-grown) y sale la pastilla de dónde llegan (su propio is-in).
  useEffect(() => {
    if (!d) return;
    const a = requestAnimationFrame(() => setEntra(" is-in"));
    const b = setTimeout(() => setEntra(" is-in is-grown"), 140);
    return () => {
      cancelAnimationFrame(a);
      clearTimeout(b);
    };
  }, [d]);
  if (!d) return <div className="nx is-in"><div className="nx-cap">{t("visitas")}</div>
    <p className="nx-vs" role={estado === "error" ? "alert" : "status"}>{tg(estado === "error" ? "error" : "cargando")}</p>
    {estado === "error" && <button type="button" className="nx-act" onClick={() => setIntento(x => x + 1)}>{tg("reintentar")}</button>}
  </div>;
  const barras = barrasDeVisitas(d.porDia);
  return (
    <div className={`nx is-live${entra}`}>
      <div className="nx-cap">{t("visitas")}</div>
      <div className="nx-hero"><span className="nx-num">{d.vistas.toLocaleString(idioma)}</span></div>
      <div className="nx-vs">{t("personas", { n: d.personas })}</div>
      <div className="nx-bars" role="img" aria-label={barras.map((b) => b.valor).join(", ")}>
        {barras.map((b, k) => (
          <span key={b.dia} className={`nx-bar${b.esHoy ? " is-today" : ""}`} style={{ ["--h" as string]: `${b.alto}px`, ["--d" as string]: `${k * 55}ms` }}>
            {b.esMax ? <b>{b.valor}</b> : null}
            <i />
          </span>
        ))}
      </div>
      <div className="nx-base" />
      <div className="nx-days">{barras.map((b) => <span key={b.dia}>{b.esHoy ? t("hoy") : DIA(b.dia, idioma)}</span>)}</div>
      {d.origen && (
        <div className="nx-foot">
          <span className={`nx-chip${entra.includes("is-grown") ? " is-in" : ""}`} data-k="ref"><Icono nombre="enter" />{t("llegan", { origen: d.origen.origen, n: d.origen.deCadaDiez })}</span>
        </div>
      )}
    </div>
  );
}

type Respuesta = Extract<TarjetaDeLlamada, { tipo: "respuesta" }>["respuesta"];

// Los botones son los que puso Len: «Enviar» en un chat; correo, WhatsApp y
// copiar en un formulario (ahí no hay a quién mandarlo desde OpenLen).
function Borrador({ cliente, r }: { cliente: ClienteDeOpenLen; r: Respuesta }) {
  const t = useTranslations("movil.tarjetas");
  const [texto, setTexto] = useState(r.texto);
  const tg = useTranslations("movil.gestion");
  const [estado, setEstado] = useState<"listo" | "enviando" | "enviado" | "copiado" | "error">("listo");
  const enviar = async () => {
    if (estado === "enviando" || estado === "enviado" || !texto.trim()) return;
    setEstado("enviando");
    const res = await cliente
      .pedir(`/api/inbox/${encodeURIComponent(r.id)}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: texto.trim() }),
      })
      .catch(() => null);
    setEstado(res?.ok ? "enviado" : "error");
  };
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setEstado("copiado");
    } catch {
      setEstado("error");
    }
  };
  const correo = r.botones.includes("correo") && r.correo ? enlaceDeCorreo(r.correo, t("asunto"), texto) : null;
  const whatsapp = r.botones.includes("whatsapp") && r.whatsapp ? enlaceDeWhatsApp(r.whatsapp, texto) : null;
  return (
    <div className="nx">
      <div className="nx-cap">{r.con ? t("borrador", { con: r.con }) : t("borradorSinNombre")}</div>
      <textarea
        className="nx-what"
        style={{ width: "100%", minHeight: 72, border: 0, borderRadius: 12, padding: 10, font: "500 15px Inter, sans-serif", boxSizing: "border-box" }}
        value={texto}
        aria-label={r.con ? t("borrador", { con:r.con }) : t("borradorSinNombre")}
        disabled={estado === "enviado" || estado === "enviando"}
        onChange={(e) => { setTexto(e.target.value); setEstado("listo"); }}
      />
      <div className="nx-vs" role={estado === "error" ? "alert" : "status"}>{estado === "error" ? (r.botones.includes("enviar") ? t("error") : tg("error")) : estado === "enviado" ? t("enviado") : t("nota")}</div>
      <div className="nx-acts" style={{ flexWrap: "wrap" }}>
        {r.botones.includes("enviar") && (
          <button type="button" className="nx-act" onClick={() => void enviar()} disabled={estado === "enviando" || estado === "enviado" || !texto.trim()}>
            {estado === "enviando" ? t("enviando") : estado === "enviado" ? t("enviado") : t("enviar")}
          </button>
        )}
        {correo && <a className="nx-act" href={correo}>{t("correo")}</a>}
        {whatsapp && <a className="nx-act is-wa" href={whatsapp} target="_blank" rel="noopener noreferrer"><Icono nombre="wa" />{t("whatsapp")}</a>}
        {r.botones.includes("copiar") && (
          <button type="button" className="nx-act" onClick={() => void copiar()}>{estado === "copiado" ? t("copiado") : t("copiar")}</button>
        )}
      </div>
    </div>
  );
}

type Confirmar = Extract<TarjetaDeLlamada, { tipo: "publicar" }>["confirm"];

function Publicar({ cliente, projectId, confirm }: { cliente: ClienteDeOpenLen; projectId: string; confirm: Confirmar }) {
  const t = useTranslations("movil.tarjetas");
  const [estado, setEstado] = useState<"listo" | "publicando" | "hecho" | "error">("listo");
  const direccion = publishedHost(confirm.subdominio);
  const publicar = async () => {
    setEstado("publicando");
    // Como la tarjeta de la web: `languages` sólo si Len eligió alguno (una
    // lista vacía borraría las traducciones guardadas de una página viva).
    const res = await cliente
      .pedir(`/api/projects/${encodeURIComponent(projectId)}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subdomain: confirm.subdominio, ...(confirm.idiomas.length > 0 ? { languages: confirm.idiomas } : {}) }),
      })
      .catch(() => null);
    setEstado(res?.ok ? "hecho" : "error");
  };
  return (
    <div className="nx">
      <div className="nx-cap">{estado === "hecho" ? t("publicadaEn", { url: direccion }) : direccion}</div>
      {estado === "error" && <div className="nx-vs" role="alert">{t("noPublicada")}</div>}
      {estado !== "hecho" && (
        <div className="nx-acts">
          <button type="button" className="nx-act" onClick={() => void publicar()} disabled={estado === "publicando"}>
            {estado === "publicando" ? t("publicando") : t("publicar")}
          </button>
        </div>
      )}
    </div>
  );
}

type ConfirmarInstalar = Extract<TarjetaDeLlamada, { tipo: "instalar" }>["confirm"];
type EstadoDeInstalar =
  | { fase: "listo" }
  | { fase: "instalando" }
  | { fase: "hallazgos"; huella: string; titulos: string[] }
  | { fase: "borraDatos"; huella: string }
  | { fase: "revisionSigue" }
  | { fase: "instalada" }
  | { fase: "error"; motivo: string };

/** «Instalar» (herramientas, fase 5, spec local 2026-11-04-herramientas-hechas-por-len, §4.2, §4.14): lo que deja el
 *  `publish` de Len en una herramienta, con las mismas puertas que la tarjeta de la web y su texto. El servidor espera
 *  una revisión de seguridad que sigue en marcha (`waitWhenPending`); lo que encuentre, y lo que borre datos reales,
 *  sólo lo acepta este toque — nunca Len. */
function Instalar({ cliente, projectId, idioma, confirm, onInstalada }: { cliente: ClienteDeOpenLen; projectId: string; idioma: string; confirm: ConfirmarInstalar; onInstalada?: () => void }) {
  const t = useTranslations("movil.herramientas");
  const [estado, setEstado] = useState<EstadoDeInstalar>({ fase: "listo" });
  // The security review is still running and the server is waiting for it: the card says so meanwhile.
  const [revisando, setRevisando] = useState(false);
  const [aceptado, setAceptado] = useState<{ acceptSecurityFingerprint?: string; confirmFingerprint?: string }>({});
  const instalar = async (extra: { acceptSecurityFingerprint?: string; confirmFingerprint?: string } = {}) => {
    const todo = { ...aceptado, ...extra };
    setAceptado(todo);
    setEstado({ fase: "instalando" });
    setRevisando(false);
    const r: PublishOutcome = await postInstallAfterSecurity(
      projectId,
      { locale: idioma, waitWhenPending: true, ...todo },
      (v) => setRevisando(v.status === "running"),
      async () => null,
      (u, i) => cliente.pedir(u, i),
    ).catch(() => ({ kind: "error", status: 0, error: "network" }) as PublishOutcome);
    setRevisando(false);
    if (r.kind === "published") {
      setEstado({ fase: "instalada" });
      onInstalada?.();
    }
    else if (r.kind === "security_findings") setEstado({ fase: "hallazgos", huella: r.view.fingerprint, titulos: r.view.blocking.map((f) => f.description || f.category) });
    else if (r.kind === "needs_confirmation") setEstado({ fase: "borraDatos", huella: r.fingerprint });
    else if (r.kind === "security_review_pending") setEstado({ fase: "revisionSigue" });
    else setEstado({ fase: "error", motivo: r.kind === "error" ? r.error : r.kind });
  };
  return (
    <div className="nx" data-tarjeta-instalar="">
      <div className="nx-cap">{t("installCard.title", { title: confirm.title })}</div>
      {estado.fase === "instalada" ? (
        <div className="nx-what">{confirm.placement === "rail" ? t("instaladaRail") : t("instaladaProyecto")}</div>
      ) : (
        <>
          <div className="nx-what">{confirm.placement === "rail" ? t("installCard.inRail") : t("installCard.inProject")}</div>
          {estado.fase === "hallazgos" && (
            <div className="nx-vs" role="alert">
              {t("installCard.findings")}
              <ul>
                {estado.titulos.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {estado.fase === "borraDatos" && <div className="nx-vs" role="alert">{t("installCard.destructive")}</div>}
          {estado.fase === "revisionSigue" && <div className="nx-vs" role="status">{t("revisionSigue")}</div>}
          {estado.fase === "instalando" && <div className="nx-vs" role="status">{revisando ? t("revisionSigue") : t("toolCard.installing")}</div>}
          {estado.fase === "error" && <div className="nx-vs" role="alert">{t("installCard.failed", { reason: estado.motivo })}</div>}
          <div className="nx-acts">
            {estado.fase === "hallazgos" ? (
              <button type="button" className="nx-act" onClick={() => void instalar({ acceptSecurityFingerprint: estado.huella })}>{t("installCard.installAnyway")}</button>
            ) : estado.fase === "borraDatos" ? (
              <button type="button" className="nx-act" onClick={() => void instalar({ confirmFingerprint: estado.huella })}>{t("installCard.installAnyway")}</button>
            ) : estado.fase === "revisionSigue" ? (
              <button type="button" className="nx-act" onClick={() => void instalar()}>{t("volverAIntentar")}</button>
            ) : (
              <button type="button" className="nx-act" disabled={estado.fase === "instalando"} onClick={() => void instalar()}>{t("installCard.install")}</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function TarjetaDeLaApp({ x, cliente, projectId, idioma, onInstalada }: { x: TarjetaDeLlamada; cliente: ClienteDeOpenLen; projectId: string; idioma: string; onInstalada?: () => void }) {
  if (x.tipo === "visitas") return <Visitas cliente={cliente} projectId={projectId} idioma={idioma} />;
  if (x.tipo === "respuesta") return <Borrador cliente={cliente} r={x.respuesta} />;
  if (x.tipo === "publicar") return <Publicar cliente={cliente} projectId={projectId} confirm={x.confirm} />;
  if (x.tipo === "instalar") return <Instalar cliente={cliente} projectId={projectId} idioma={idioma} confirm={x.confirm} onInstalada={onInstalada} />;
  return <div className="nx"><div className="nx-what" style={{ whiteSpace: "pre-wrap" }}>{x.texto}</div></div>;
}
