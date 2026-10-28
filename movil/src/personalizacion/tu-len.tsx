import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "use-intl";
import { Cara } from "../cara";
import { useAtras } from "../atras";
import { aplicarLook, leerLook, type Look } from "./preferencia";
import "./tu-len.css";

type Catalogo = NonNullable<Window["LenCara"]>;
export function TuLen({ onCerrar }: { onCerrar: () => void }) {
  const t = useTranslations("movil.personalizacion");
  const [catalogo, setCatalogo] = useState<Catalogo>();
  const [borrador, setBorrador] = useState<Look>({ cabeza: "", cara: "" });
  const [error, setError] = useState(false);
  const [intento, setIntento] = useState(0);
  const dialogo = useRef<HTMLElement>(null);
  const titulo = useId();
  const descripcion = useId();
  useAtras(true, onCerrar);
  useEffect(() => {
    let vivo = true;
    void import("@/brand/len-cara/cara.js").then(() => {
      if (!vivo) return;
      if (!window.LenCara) throw new Error("Motor no disponible");
      setBorrador(leerLook(window.LenCara));
      setCatalogo(window.LenCara); setError(false);
    }).catch(() => { if (vivo) setError(true); });
    return () => { vivo = false; };
  }, [intento]);
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    dialogo.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previo?.isConnected) previo.focus(); };
  }, []);
  const teclado = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCerrar(); }
    if (e.key !== "Tab") return;
    const botones = Array.from(dialogo.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const primero = botones[0], ultimo = botones.at(-1);
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo?.focus(); }
    if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero?.focus(); }
  };
  const seleccionado = catalogo?.LOOKS.findIndex(p => p.cabeza === borrador.cabeza && p.cara === borrador.cara) ?? -1;
  const elegir = (look: Look) => { setBorrador({ cabeza: look.cabeza, cara: look.cara }); setError(false); };
  const avanzar = (paso: number) => {
    if (!catalogo?.LOOKS.length) return;
    const index = seleccionado < 0 ? (paso > 0 ? 0 : catalogo.LOOKS.length - 1) : (seleccionado + paso + catalogo.LOOKS.length) % catalogo.LOOKS.length;
    elegir(catalogo.LOOKS[index]);
  };
  const aplicar = () => {
    if (!catalogo) return;
    try { aplicarLook(borrador, catalogo); onCerrar(); } catch { setError(true); }
  };
  return <section ref={dialogo} className="tu-len lm-m lm-marca" role="dialog" aria-modal="true" aria-labelledby={titulo} aria-describedby={descripcion} onKeyDown={teclado}>
    <header className="tu-len-top">
      <button type="button" className="tu-len-close" onClick={onCerrar} aria-label={t("cancelar")}><span aria-hidden>×</span></button>
      <div><h1 id={titulo}>{t("titulo")}</h1><p id={descripcion}>{t("descripcion")}</p></div>
    </header>
    <div className="tu-len-scroll">
      {catalogo ? <>
        <div className="tu-len-hero">
          <button type="button" className="tu-len-arrow" onClick={() => avanzar(-1)} aria-label={t("anterior")}><span aria-hidden>‹</span></button>
          <div role="img" aria-label={t("vista")} className="tu-len-personaje"><Cara estado="reposo" className="tu-len-preview" look={borrador} /></div>
          <button type="button" className="tu-len-arrow" onClick={() => avanzar(1)} aria-label={t("siguiente")}><span aria-hidden>›</span></button>
        </div>
        <h2 className="tu-len-name">Len</h2>
        <p className="tu-len-tag" aria-live="polite">{seleccionado < 0 ? t("personalizado") : t(`looks.${catalogo.LOOKS[seleccionado].id}`)}</p>
        <div className="tu-len-cards" role="group" aria-label={t("estilos")}>
          {catalogo.LOOKS.map((look, i) => <button type="button" key={look.id} className="tu-len-card" aria-pressed={i === seleccionado} onClick={() => elegir(look)}>
            <span className="tu-len-icon" aria-hidden dangerouslySetInnerHTML={{ __html: catalogo.icon(look.cabeza, look.cara) }} />
            <span>{t(`looks.${look.id}`)}</span>
          </button>)}
        </div>
        {(["cabeza", "cara"] as const).map(slot => <fieldset className="tu-len-options" key={slot}>
          <legend>{t(slot)}</legend>
          <div className="tu-len-row">{["", ...Object.keys(slot === "cabeza" ? catalogo.HEAD : catalogo.FACE)].map(id => {
            const nombre = id ? t(`${slot === "cabeza" ? "cabezas" : "caras"}.${id}`) : t("nada");
            return <button type="button" key={id} aria-label={nombre} title={nombre} aria-pressed={borrador[slot] === id} onClick={() => elegir({ ...borrador, [slot]: id })}>
              <span aria-hidden dangerouslySetInnerHTML={{ __html: catalogo.icon(slot === "cabeza" ? id : "", slot === "cara" ? id : "") }} />
            </button>;
          })}</div>
        </fieldset>)}
      </> : !error && <p role="status" className="tu-len-message">{t("cargando")}</p>}
      {error && <div className="tu-len-message"><p role="alert">{t("error")}</p>{!catalogo && <button type="button" onClick={() => { setError(false); setIntento(i => i + 1); }}>{t("reintentar")}</button>}</div>}
    </div>
    <footer className="tu-len-footer"><button type="button" className="tu-len-apply" disabled={!catalogo} onClick={aplicar}>{t("aplicar")}</button></footer>
  </section>;
}
