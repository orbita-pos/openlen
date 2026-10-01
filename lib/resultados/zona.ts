/**
 * LA HORA DEL USUARIO (plans/len-resultados/diseno.md §7).
 *
 * Los eventos se guardan en UTC y los días se cortaban en UTC: a las 19:00 de
 * Ciudad de México el «hoy» del servidor ya es mañana, y Len diría «hoy llevas
 * 0 visitas». «Hoy» es el día del usuario, en su zona.
 */

/** Sin zona conocida, se cuenta en UTC y la herramienta lo dice. */
export const ZONA_SIN_DATO = "UTC";

export function zonaValida(crudo: unknown): string | null {
  if (typeof crudo !== "string") return null;
  const zona = crudo.trim();
  if (zona.length === 0 || zona.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zona });
    return zona;
  } catch {
    return null;
  }
}

/** El día (AAAA-MM-DD) de un instante en una zona. `en-CA` formatea así. */
export function fechaLocal(instante: Date, zona: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

/** Días de calendario, no instantes: se ancla a mediodía para que ningún
 *  cambio de hora mueva el día. */
export function restarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

export function fechaValida(crudo: unknown): string | null {
  if (typeof crudo !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(crudo)) return null;
  const d = new Date(`${crudo}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== crudo ? null : crudo;
}
