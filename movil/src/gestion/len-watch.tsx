// LEN WATCH en Gestión → Publicar (spec local 2026-10-30-len-watch, §5.7): si la publicada no carga,
// dónde va su arreglo con su botón, y los tres interruptores. La misma lógica que la web
// (components/workspace-v2/len-watch/view-model.ts); un 428 al aprobar se revisa con «Publicar».
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { bannerState, patchFor, settingsRows, type SettingKey } from "@/components/workspace-v2/len-watch/view-model";
import type { LenWatchStatus } from "@/lib/len-watch/types";
import type { Idioma } from "../config";
import { ErrorGestion, lenWatchAjustes, lenWatchAprobar, lenWatchArreglar, lenWatchEstado } from "./api";

export function LenWatch({ cliente, projectId, idioma }: { cliente: ClienteDeOpenLen; projectId: string; idioma: Idioma }) {
  const t = useTranslations("movil.lenWatch");
  const [estado, setEstado] = useState<LenWatchStatus | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [nota, setNota] = useState<"review" | "failed" | null>(null);
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

  const vista = bannerState(estado.incident);
  const actuar = async (accion: "fix" | "approve") => {
    setOcupado(true);
    setNota(null);
    try {
      await (accion === "fix" ? lenWatchArreglar(cliente, projectId) : lenWatchAprobar(cliente, projectId));
    } catch (e) {
      setNota(e instanceof ErrorGestion && e.status === 428 ? "review" : "failed");
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
    {vista.kind !== "hidden" && <div className="gestion-len-watch-aviso" role="status">
      <p>{vista.kind === "working" ? t("working") : vista.kind === "down" ? t("down") : t("ready")}{vista.kind === "ready" && vista.shipsUnpublished && <> {t("shipsUnpublished")}</>}</p>
      {vista.kind !== "working" && <button className="gestion-principal" disabled={ocupado} onClick={() => void actuar(vista.kind === "ready" ? "approve" : "fix")}>{vista.kind === "ready" ? t("approve") : t("fix")}</button>}
      {nota === "review" && <p>{t("review")}</p>}
      {nota === "failed" && <p>{t("failed")}</p>}
    </div>}
    <p>{t("intro")}</p>
    {settingsRows(estado.settings, estado.isOwner).map((fila) => <label key={fila.key} className="gestion-len-watch-interruptor">
      <input type="checkbox" checked={fila.checked} disabled={fila.disabled || ocupado} onChange={(e) => void cambiar(fila.key, e.currentTarget.checked)} />
      <span>{nombre[fila.key]}{ayuda[fila.key] && <small>{ayuda[fila.key]}</small>}</span>
    </label>)}
    {!estado.isOwner && <p>{t("ownerOnly")}</p>}
  </section>;
}
