// Los textos: los mismos ficheros de messages/ que la web, con use-intl (la
// base de next-intl). Se cargan sólo los del idioma del teléfono.
import { useEffect, useState, type ReactNode } from "react";
import { IntlProvider } from "use-intl";
import type { Idioma } from "./config";
import { textosGestion } from "./textos-gestion";
import { textosAvisos } from "./textos-avisos";
import { textosPersonalizacion } from "./textos-personalizacion";
import { textosEntrega } from "./textos-entrega";
import { textosEquipo } from "./textos-equipo";
import { Cargando } from "./pantallas/cargando";
import { textosInterfaz } from "./textos-interfaz";
import { textosAdjuntos } from "./textos-adjuntos";
import { textosLenWatch } from "./textos-len-watch";
import { deliveredTexts } from "./delivered-texts";
import { overviewTexts } from "./overview-texts";

const cargas = import.meta.glob<{ default: Record<string, unknown> }>("../../messages/*/{movil,llamada}.json");

async function mensajesDe(idioma: Idioma): Promise<Record<string, unknown>> {
  const [movil, llamada] = await Promise.all([
    cargas[`../../messages/${idioma}/movil.json`]!(),
    cargas[`../../messages/${idioma}/llamada.json`]!(),
  ]);
  return { movil: { ...movil.default, interfaz: textosInterfaz[idioma], chat: { ...(movil.default.chat as Record<string, unknown>), irAlUltimo: textosInterfaz[idioma].irAlUltimo }, gestion: textosGestion[idioma], avisos: textosAvisos[idioma], personalizacion: textosPersonalizacion[idioma], entrega: textosEntrega[idioma], equipo: textosEquipo[idioma], adjuntos: textosAdjuntos[idioma], lenWatch: textosLenWatch[idioma], entregado: deliveredTexts[idioma], resumen: overviewTexts[idioma] }, llamada: llamada.default };
}

export function Textos({ idioma, children }: { idioma: Idioma; children: ReactNode }) {
  const [m, setM] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let vigente = true;
    void mensajesDe(idioma).then((m) => { if (vigente) setM(m); });
    return () => { vigente = false; };
  }, [idioma]);
  if (!m) return <Cargando />;
  return (
    <IntlProvider locale={idioma} messages={m} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}>
      {children}
    </IntlProvider>
  );
}
