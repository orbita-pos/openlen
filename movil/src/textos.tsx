// Los textos: los mismos ficheros de messages/ que la web, con use-intl (la
// base de next-intl). Se cargan sólo los del idioma del teléfono.
import { useEffect, useState, type ReactNode } from "react";
import { IntlProvider } from "use-intl";
import type { Idioma } from "./config";

const cargas = import.meta.glob<{ default: Record<string, unknown> }>("../../messages/*/{movil,llamada}.json");

async function mensajesDe(idioma: Idioma): Promise<Record<string, unknown>> {
  const [movil, llamada] = await Promise.all([
    cargas[`../../messages/${idioma}/movil.json`]!(),
    cargas[`../../messages/${idioma}/llamada.json`]!(),
  ]);
  return { movil: movil.default, llamada: llamada.default };
}

export function Textos({ idioma, children }: { idioma: Idioma; children: ReactNode }) {
  const [m, setM] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    void mensajesDe(idioma).then(setM);
  }, [idioma]);
  if (!m) return null;
  return (
    <IntlProvider locale={idioma} messages={m} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}>
      {children}
    </IntlProvider>
  );
}
