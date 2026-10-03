import { fechaLocal } from "@/lib/resultados/zona";

/**
 * Qué día es hoy, para cualquier prompt que escriba texto en la página.
 *
 * Un modelo no sabe la fecha y cuenta desde su entrenamiento. Medido dos veces
 * en dos superficies distintas: el Agente escribió una cuenta regresiva DOS
 * MESES vencida, y la puerta de generar convirtió "desde 1998" en "26 años de
 * oficio" — la cuenta desde 2024.
 *
 * Vive en un solo sitio a propósito. Arreglado por superficie, cada puerta
 * nueva nace ciega otra vez: cuando esto se escribió había siete que redactan
 * copy del usuario y sólo dos sabían la fecha.
 *
 * `zona` (IANA): el día del USUARIO. Sin ella, el de UTC, que desde las 18:00
 * de México ya es mañana — medido el 30/09 en Len: llamó «ayer» a un mensaje
 * de ese mismo día (plans/len-2/corridas/2026-10-01-resultados-humo). Hoy sólo
 * Len la tiene: la manda el panel con cada turno.
 */
export function todayLine(now: Date = new Date(), zona?: string): string {
  // En inglés desde la traducción de lo que lee Len (2026-10-02), para todas las
  // superficies a la vez: Jesús decidió traducir lo compartido con Crear.
  const dia = zona ? fechaLocal(now, zona) : now.toISOString().slice(0, 10);
  return `TODAY IS ${dia}. Any figure or date you write —years of experience, "since 1998", the copyright year, countdowns, seasons— is worked out from today, not from any other time.\n\n`;
}
