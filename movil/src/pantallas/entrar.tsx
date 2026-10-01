import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { Cara } from "../cara";
import { Icono } from "../iconos";

// El botón NO se desactiva mientras espera: si cierras el navegador sin
// entrar, tocarlo otra vez empieza de nuevo (con otro `estado`; el regreso
// viejo se ignora). Desactivado, la app se quedaría atascada.
export function PantallaEntrar({ esperando, aviso, onEntrar }: { esperando: boolean; aviso: "caducado" | null; onEntrar: () => void }) {
  const t = useTranslations("movil.entrar");
  // «saludando» es un saludo de un momento (guiña y gira el cuerpo): el
  // prototipo siempre le pone otro estado a los 1,1 s; fijo, la cara se ve ovalada.
  const [cara, setCara] = useState("saludando");
  useEffect(() => {
    const r = setTimeout(() => setCara("reposo"), 1100);
    return () => clearTimeout(r);
  }, []);
  return (
    <section className="lm-layer lm-incoming lm-m lm-marca is-on">
      <div className="lm-aura"><i /><i /><i /></div>
      <div className="lm-inc-top"><b>{t("titulo")}</b><span>{t("lema")}</span></div>
      <div className="lm-inc-face">
        <div className="lm-rings"><i /><i /><i /></div>
        <Cara estado={cara} className="lm-face-host" props="compact" />
      </div>
      {aviso && <p className="app-aviso">{t("caducado")}</p>}
      <div className="lm-inc-actions">
        <button type="button" className="lm-round lm-accept" onClick={onEntrar}>
          <span><Icono nombre="enter" /></span>
          {esperando ? t("esperando") : t("boton")}
        </button>
      </div>
    </section>
  );
}
