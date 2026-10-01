// La HORA DEL DUEÑO para sembrar (plans/len-resultados/). Puro: los casos de
// resultados plantan visitas, formularios y mensajes en un día y una hora de
// la zona del dueño, y la cuenta de Len tiene que salir exacta.
import { fechaLocal, restarDias } from "@/lib/resultados/zona";
import type { Siembra } from "../../tipos";

/** Minutos que la zona va por delante de UTC en ese instante (México: −360).
 *  Con `formatToParts` y no leyendo un `toLocaleString`, que es texto. */
function desfaseEnMinutos(instante: Date, zona: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zona,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instante)
      .map((x) => [x.type, x.value]),
  );
  const comoSiFueraUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return Math.round((comoSiFueraUtc - instante.getTime()) / 60_000);
}

/** El instante de «hace N días, a tal hora» en la zona del dueño. */
export function aLas(s: Pick<Siembra, "zona" | "ahora">, diasAtras: number, hora: number, minuto = 0): Date {
  const dia = restarDias(fechaLocal(s.ahora, s.zona), diasAtras);
  const comoUtc = new Date(`${dia}T${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}:00Z`);
  // Dos pasadas: el desfase se mide en el instante bueno, no en el tentativo
  // (en una zona con cambio de hora, los dos pueden caer a lados distintos).
  const primera = new Date(comoUtc.getTime() - desfaseEnMinutos(comoUtc, s.zona) * 60_000);
  return new Date(comoUtc.getTime() - desfaseEnMinutos(primera, s.zona) * 60_000);
}

/** Hoy, «hace un rato»: 20 minutos antes de ahora, pero nunca antes de la
 *  medianoche del dueño (pasada la medianoche por un minuto). */
export function haceUnRato(s: Pick<Siembra, "zona" | "ahora">): Date {
  const medianoche = aLas(s, 0, 0, 1);
  const rato = new Date(s.ahora.getTime() - 20 * 60_000);
  return rato < medianoche ? medianoche : rato;
}
