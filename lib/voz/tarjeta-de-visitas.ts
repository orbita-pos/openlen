// Los datos de la tarjeta de visitas salen del MISMO resumen que lee Len con
// `get_visits`: si la tarjeta los calculara por su cuenta, la pantalla podría
// contradecir lo que la voz acaba de decir.
import type { ResumenDeVisitas } from "@/lib/resultados/visitas";

export interface DatosDeVisitas {
  vistas: number;
  personas: number;
  hoy: number;
  porDia: { dia: string; vistas: number }[];
  origen: { origen: string; deCadaDiez: number } | null;
}

export function datosDeVisitas(r: ResumenDeVisitas): DatosDeVisitas {
  const total = r.rango.total.vistas;
  const primero = r.rango.deDonde[0];
  return {
    vistas: r.ultimos7.vistas,
    personas: r.ultimos7.personas,
    hoy: r.hoy.vistas,
    porDia: r.rango.porDia,
    origen: primero && total > 0 ? { origen: primero.origen, deCadaDiez: Math.round((10 * primero.vistas) / total) } : null,
  };
}
