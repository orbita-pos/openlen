// Las tarjetas de la llamada, con las clases del prototipo (.nx…). Los datos
// de visitas son los de /api/voz/visitas = lo que lee Len con ver_visitas. El
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
import { Icono } from "../iconos";
import { barrasDeVisitas } from "./barras";

const DIA = (iso: string, idioma: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(idioma, { weekday: "short" }).replace(".", "");

function Visitas({ cliente, projectId, idioma }: { cliente: ClienteDeOpenLen; projectId: string; idioma: string }) {
  const t = useTranslations("movil.tarjetas");
  const [d, setD] = useState<DatosDeVisitas | null>(null);
  const [entra, setEntra] = useState("");
  useEffect(() => {
    const zona = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
    void cliente
      .pedir(`/api/voz/visitas?project=${encodeURIComponent(projectId)}&zona=${zona}`)
      .then((r) => (r.ok ? (r.json() as Promise<DatosDeVisitas>) : null))
      .then(setD)
      .catch(() => setD(null));
  }, [cliente, projectId]);
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
  if (!d) return null;
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
        disabled={estado === "enviado"}
        onChange={(e) => setTexto(e.target.value)}
      />
      <div className="nx-vs">{estado === "error" ? (r.botones.includes("enviar") ? t("error") : null) : t("nota")}</div>
      <div className="nx-acts" style={{ flexWrap: "wrap" }}>
        {r.botones.includes("enviar") && (
          <button type="button" className="nx-act" onClick={() => void enviar()} disabled={estado === "enviando" || estado === "enviado"}>
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
      {estado === "error" && <div className="nx-vs">{t("noPublicada")}</div>}
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

export function TarjetaDeLaApp({ x, cliente, projectId, idioma }: { x: TarjetaDeLlamada; cliente: ClienteDeOpenLen; projectId: string; idioma: string }) {
  if (x.tipo === "visitas") return <Visitas cliente={cliente} projectId={projectId} idioma={idioma} />;
  if (x.tipo === "respuesta") return <Borrador cliente={cliente} r={x.respuesta} />;
  if (x.tipo === "publicar") return <Publicar cliente={cliente} projectId={projectId} confirm={x.confirm} />;
  return <div className="nx"><div className="nx-what" style={{ whiteSpace: "pre-wrap" }}>{x.texto}</div></div>;
}
