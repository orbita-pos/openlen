// LEN WATCH en Gestión → Publicar (spec local 2026-10-30-len-watch, §5.7): si la publicada no carga,
// dónde va su arreglo con su botón, y los tres interruptores. La misma lógica que la web
// (components/workspace-v2/len-watch/view-model.ts); un 428 al aprobar se revisa con «Publicar».
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { bannerState, patchFor, settingsRows, type SettingKey } from "@/components/workspace-v2/len-watch/view-model";
import type { LenWatchStatus } from "@/lib/len-watch/types";
import type { Idioma } from "../config";
import { ErrorGestion, lenWatchAjustes, lenWatchAprobar, lenWatchArreglar, lenWatchEstado, lenWatchTraer } from "./api";
import { textoDelDetalle } from "./detalle";

export function LenWatch({ cliente, projectId, idioma }: { cliente: ClienteDeOpenLen; projectId: string; idioma: Idioma }) {
  const t = useTranslations("movil.lenWatch");
  const [estado, setEstado] = useState<LenWatchStatus | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [nota, setNota] = useState<"review" | "failed" | "changed" | "handedToLen" | "queued" | "bringFailed" | "reviewRunning" | "secretsMissing" | null>(null);
  const [faltan, setFaltan] = useState<string[]>([]);
  const [hallazgos, setHallazgos] = useState<{ huella: string; lista: unknown[] } | null>(null);
  const cargar = async (signal?: AbortSignal) => {
    const e = await lenWatchEstado(cliente, projectId, signal).catch(() => null);
    if (!signal?.aborted && e?.enabled) setEstado(e);
  };
  useEffect(() => {
    const c = new AbortController();
    void cargar(c.signal);
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente, projectId]);
  if (!estado) return null;

  const vista = bannerState(estado.incident, estado.pendingFix ?? null);
  // «Traer el arreglo» (spec §5.5): the fix Len published from its branch comes into the draft.
  const traer = async (incidentId: string) => {
    setOcupado(true);
    setNota(null);
    const r = await lenWatchTraer(cliente, projectId, incidentId).catch(() => null);
    setNota(!r ? "bringFailed" : r.status === "handed_to_len" ? "handedToLen" : r.status === "queued" ? "queued" : null);
    setOcupado(false);
    await cargar();
  };
  const actuar = async (accion: "fix" | "approve", permiso: { confirmChanged?: true; acceptSecurityFingerprint?: string } = {}) => {
    setOcupado(true);
    setNota(null);
    setHallazgos(null);
    try {
      await (accion === "fix" ? lenWatchArreglar(cliente, projectId) : lenWatchAprobar(cliente, projectId, permiso));
    } catch (e) {
      const g = e instanceof ErrorGestion ? e : null;
      // El arreglo en su rama (spec §5.5): «Publicar» publica el borrador, nunca esto; lo que encontró la revisión se
      // contesta aquí.
      if (g?.status === 428 && g.datos.branch === true) {
        if (g.codigo === "security_findings" && typeof g.datos.fingerprint === "string") setHallazgos({ huella: g.datos.fingerprint, lista: Array.isArray(g.datos.blocking) ? g.datos.blocking : [] });
        else if (g.codigo === "security_review_pending") setNota("reviewRunning");
        else if (g.codigo === "secrets_required" && Array.isArray(g.datos.missing)) {
          setFaltan(g.datos.missing.map(String));
          setNota("secretsMissing");
        } else setNota("failed");
      } else {
        // 409 changed_since_fix: el borrador cambió tras el arreglo de Len; se pregunta antes de publicarlo.
        setNota(g?.status === 428 ? "review" : g?.codigo === "changed_since_fix" ? "changed" : "failed");
      }
    }
    setOcupado(false);
    await cargar();
  };
  const cambiar = async (clave: SettingKey, activo: boolean) => {
    setOcupado(true);
    const r = await lenWatchAjustes(cliente, projectId, { ...patchFor(clave, activo), locale: idioma }).catch(() => null);
    setOcupado(false);
    if (r) setEstado({ ...estado, settings: r.settings });
  };
  const nombre: Record<SettingKey, string> = { watch: t("watch"), autoFix: t("autoFix"), autoPublish: t("autoPublish") };
  const ayuda: Partial<Record<SettingKey, string>> = { autoFix: t("autoFixHint"), autoPublish: t("autoPublishHint") };

  return <section className="gestion-len-watch" aria-label={t("title")}>
    <h3>{t("title")}</h3>
    {vista.kind === "bring" && <div className="gestion-len-watch-aviso" role="status">
      <p><strong>{t("bringTitle")}</strong> {t("bringBody")}</p>
      <button className="gestion-principal" disabled={ocupado} onClick={() => void traer(vista.incidentId)}>{ocupado ? t("bringing") : t("bring")}</button>
      {(nota === "handedToLen" || nota === "queued" || nota === "bringFailed") && <p>{t(nota)}</p>}
    </div>}
    {/* The fix (it changes tables) is in the draft: «Publicar» sits right above, in this same panel. */}
    {vista.kind === "publish" && <div className="gestion-len-watch-aviso" role="status"><p>{t("publishBrought")}</p></div>}
    {vista.kind !== "hidden" && vista.kind !== "bring" && vista.kind !== "publish" && <div className="gestion-len-watch-aviso" role="status">
      <p>{vista.kind === "working" ? t("working") : vista.kind === "down" ? t("down") : t("ready")}{vista.kind === "ready" && vista.shipsUnpublished && <> {t("shipsUnpublished")}</>}</p>
      {vista.kind !== "working" && <button className="gestion-principal" disabled={ocupado} onClick={() => void actuar(vista.kind === "ready" ? "approve" : "fix")}>{vista.kind === "ready" ? t("approve") : t("fix")}</button>}
      {nota === "review" && <p>{t("review")}</p>}
      {nota === "failed" && <p>{t("failed")}</p>}
      {nota === "reviewRunning" && <p>{t("reviewRunning")}</p>}
      {nota === "secretsMissing" && <p>{t("secretsMissing", { names: faltan.join(", ") })}</p>}
      {nota === "changed" && <><p>{t("changed")}</p><button className="gestion-texto" disabled={ocupado} onClick={() => void actuar("approve", { confirmChanged: true })}>{t("publishAnyway")}</button></>}
      {hallazgos && <><p>{t("findings")}</p>{hallazgos.lista.length > 0 && <ul>{hallazgos.lista.map((d, i) => <li key={i}>{textoDelDetalle(d)}</li>)}</ul>}<button className="gestion-texto" disabled={ocupado} onClick={() => void actuar("approve", { acceptSecurityFingerprint: hallazgos.huella })}>{t("publishAnyway")}</button></>}
    </div>}
    <p>{t("intro")}</p>
    {settingsRows(estado.settings, estado.isOwner).map((fila) => <label key={fila.key} className="gestion-len-watch-interruptor">
      <input type="checkbox" checked={fila.checked} disabled={fila.disabled || ocupado} onChange={(e) => void cambiar(fila.key, e.currentTarget.checked)} />
      <span>{nombre[fila.key]}{ayuda[fila.key] && <small>{ayuda[fila.key]}</small>}</span>
    </label>)}
    {!estado.isOwner && <p>{t("ownerOnly")}</p>}
  </section>;
}
