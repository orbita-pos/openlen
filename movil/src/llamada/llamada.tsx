// La llamada de la app (escenas 3 y 9 del prototipo), sobre el MISMO
// `useLlamada` de la web con el cliente de la app. Grande: aura, «Len» +
// cronómetro, la cara con el halo que late con la voz real, subtítulo con los
// números en pastilla, tarjetas y Audio · Colgar · Silenciar. Pequeña: la
// píldora flotante del prototipo (.lm-pip) mientras ves tu página.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { useLlamada } from "@/components/llamada/use-llamada";
import { Cara } from "../cara";
import { Icono } from "../iconos";
import { palabrasDelSubtitulo } from "./subtitulo";
import { escucharNivel } from "./halo";
import { TarjetaDeLaApp } from "./tarjetas";

export interface TarjetaGuardada {
  clave: string;
  nodo: ReactNode;
}

const reloj = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

export function Llamada({ cliente, projectId, idioma, onTerminar }: {
  cliente: ClienteDeOpenLen; projectId: string; idioma: string; onTerminar: (g: TarjetaGuardada[]) => void;
}) {
  const t = useTranslations("movil.llamada");
  const tl = useTranslations("llamada");
  const ll = useLlamada({ projectId, idioma, cliente });
  const [pequena, setPequena] = useState(false);
  const [ahora, setAhora] = useState(Date.now());
  const halo = useRef<HTMLDivElement>(null);
  const arrancada = useRef(false);

  useEffect(() => {
    if (arrancada.current) return;
    arrancada.current = true;
    ll.llamar();
  }, [ll]);

  useEffect(() => {
    const r = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(r);
  }, []);

  useEffect(() => {
    if (!ll.vozDeLen) return;
    return escucharNivel(ll.vozDeLen, (n) => {
      if (halo.current) halo.current.style.transform = `scale(${1 + n * 0.35})`;
    });
  }, [ll.vozDeLen]);

  useEffect(() => {
    if (ll.fase !== "terminada") return;
    onTerminar(ll.tarjetas.map((x, i) => ({ clave: `${i}-${x.tipo}`, nodo: <TarjetaDeLaApp x={x} cliente={cliente} projectId={projectId} idioma={idioma} /> })));
    // Al terminar, una vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ll.fase]);

  const cara = ll.fase !== "en_llamada" ? (ll.aviso ? "error" : "saludando") : ll.trabajando ? "pensando" : ll.lineaLen ? "avisando" : "escuchando";
  const crono = ll.inicio ? reloj(ahora - ll.inicio) : "";
  const palabras = palabrasDelSubtitulo(ll.lineaLen);
  // Como el prototipo: Audio encendido = oyes a Len; Silenciar encendido = Len no te oye.
  const icAudio = ll.audio ? "spk" : "spkOff";
  const icMicro = ll.micro ? "mic" : "micOff";

  let pantalla: ReactNode;
  if (pequena && ll.fase === "en_llamada") {
    pantalla = (
      <div className="lm-pip lm-m lm-marca is-on">
        <button type="button" className="pip-exp" aria-label={t("agrandar")} onClick={() => setPequena(false)}><Icono nombre="expand" /></button>
        <Cara estado={cara} className="pip-face" />
        <b className="pip-name">Len</b>
        <span className="pip-t">{crono}</span>
        <div className="pip-acts">
          <button type="button" className={`pip-b${ll.audio ? " is-on" : ""}`} aria-label={tl("audio")} onClick={ll.alternarAudio}><Icono nombre={icAudio} /></button>
          <button type="button" className="pip-b is-hang" aria-label={tl("colgar")} onClick={ll.colgar}><Icono nombre="phoneDown" /></button>
          <button type="button" className={`pip-b${ll.micro ? "" : " is-on"}`} aria-label={tl("silenciar")} onClick={ll.alternarMicro}><Icono nombre={icMicro} /></button>
        </div>
      </div>
    );
  } else if (ll.fase !== "en_llamada") {
    pantalla = (
      <section className="lm-layer lm-incoming lm-m lm-marca is-on">
        <div className="lm-aura"><i /><i /><i /></div>
        <div className="lm-inc-top"><b>Len</b><span>{ll.aviso ? tl(ll.aviso) : t("llamando")}</span></div>
        <div className="lm-inc-face"><div className="lm-rings"><i /><i /><i /></div><Cara estado={cara} className="lm-face-host" props="compact" /></div>
        {ll.aviso === "sinMicro" && <p className="app-aviso">{t("microAjustes")}</p>}
        <div className="lm-inc-actions">
          <button type="button" className="lm-round lm-decline" onClick={() => onTerminar([])}><span><Icono nombre="x" /></span>{tl("colgar")}</button>
        </div>
      </section>
    );
  } else {
    pantalla = (
      <section className={`lm-layer lm-stage lm-m lm-marca is-on${ll.tarjetas.length ? " has-res" : ""}`} data-mode="call" data-talk={ll.lineaLen ? "1" : "0"}>
        <div className="lm-aura"><i /><i /><i /></div>
        <div className="lm-stage-top"><b>Len</b><span>{crono}</span></div>
        <button type="button" className="lm-callmin" aria-label={t("minimizar")} onClick={() => setPequena(true)}><Icono nombre="shrink" /></button>
        <div className="lm-stage-face">
          <div className="lm-halo" ref={halo}><i /></div>
          <div className="lm-talker"><Cara estado={cara} className="lm-face-host" props="compact" /></div>
        </div>
        <div className="lm-res">
          {ll.tarjetas.map((x, i) => <TarjetaDeLaApp key={`${i}-${x.tipo}`} x={x} cliente={cliente} projectId={projectId} idioma={idioma} />)}
        </div>
        <p className="lm-subs" aria-live="polite">
          {palabras.map((w, i) => (
            <span key={i} className={`lm-w is-said${w.clave ? " is-key" : ""}`}>{w.texto} </span>
          ))}
          {ll.lineaTu && <span className="lm-you"><b>{t("tu")}</b>{ll.lineaTu}</span>}
        </p>
        <div className="lm-call-actions">
          <button type="button" className={`lm-round lm-rb${ll.audio ? " is-on" : ""}`} onClick={ll.alternarAudio}><span><Icono nombre={icAudio} /></span>{tl("audio")}</button>
          <button type="button" className="lm-round lm-hang" onClick={ll.colgar}><span><Icono nombre="phoneDown" /></span>{tl("colgar")}</button>
          <button type="button" className={`lm-round lm-rb${ll.micro ? "" : " is-on"}`} onClick={ll.alternarMicro}><span><Icono nombre={icMicro} /></span>{tl("silenciar")}</button>
        </div>
      </section>
    );
  }

  // UN solo <audio>, fuera de las tres pantallas: la voz de Len se engancha al
  // que existe cuando llega la pista; si cada pantalla tuviera el suyo, al
  // pasar de «Llamando…» a la llamada, o al minimizar, Len se quedaría mudo.
  return (
    <>
      {pantalla}
      <audio ref={ll.audioRef} autoPlay />
    </>
  );
}
