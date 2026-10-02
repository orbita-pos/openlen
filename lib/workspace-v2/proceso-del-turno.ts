/**
 * EL TURNO TERMINADO SE PLIEGA (la #13 de plans/len-agente-2026/notas/fase-5-taller.md).
 *
 * La forma de DeepSeek (`packages/client/ui-chat/src/client/conversation-nodes/README.md`,
 * «Whole-Turn folding», @639ed01): un turno que acabó bien enseña el pedido, una
 * fila «Completado en 1 min 4 s», la respuesta final y el pie con lo que cambió;
 * los pasos —las tarjetas de las herramientas— quedan detrás de esa fila,
 * plegados al principio, y se abren y cierran a mano. Claude Code hace lo mismo
 * en su vista Normal del escritorio. Las reglas, tal cual las de allí:
 *
 *   · sin cerrar (corriendo, o siguiendo en el servidor): los pasos a la vista,
 *     sin plegar;
 *   · detenido o fallido: los pasos a la vista, sin plegar;
 *   · cerrado con normalidad y con pasos: plegado al principio;
 *   · sin la hora de empezar (un turno recargado): la fila, sin duración.
 *
 * Puro: lo prueba vitest.
 */

export interface TurnoParaPlegar {
  readonly status: "streaming" | "applied" | "error" | "reverted";
  /** Sigue en el servidor y esta vista no tiene su stream. */
  readonly enServidor?: boolean | undefined;
  /** Se cortó a medias: es un turno DETENIDO, aunque cambiara la página. */
  readonly cortado?: boolean | undefined;
  readonly avisoTurno?: string | undefined;
  readonly pasos: number;
  /** Cuándo se mandó (sólo los de esta pestaña). */
  readonly startedAt?: number | undefined;
  /** Cuándo cerró: el bucle lo pone al terminar. */
  readonly appliedAt?: number | undefined;
}

export type ProcesoDelTurno =
  /** Los pasos, a la vista y sin fila: corre, se detuvo, falló o no tiene pasos. */
  | { readonly plegable: false }
  /** Cerró bien: la fila, y los pasos detrás. `duracionMs` null si no se sabe. */
  | { readonly plegable: true; readonly duracionMs: number | null };

export function procesoDelTurno(t: TurnoParaPlegar): ProcesoDelTurno {
  if (t.pasos === 0) return { plegable: false };
  if (t.status === "streaming" || t.enServidor) return { plegable: false };
  if (t.status === "error" || t.cortado || t.avisoTurno) return { plegable: false };
  const duracionMs =
    t.startedAt !== undefined && t.appliedAt !== undefined && t.appliedAt >= t.startedAt ? t.appliedAt - t.startedAt : null;
  return { plegable: true, duracionMs };
}

/** Horas, minutos y segundos, como DeepSeek: desde un segundo, con horas a partir de 60 minutos. */
export function partesDeLaDuracion(ms: number): { hours?: number; minutes?: number; seconds?: number } {
  const total = Math.max(1, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return minutes > 0 ? { hours, minutes } : { hours };
  if (minutes > 0) return seconds > 0 ? { minutes, seconds } : { minutes };
  return { seconds };
}

type FormateadorDeDuracion = { format(d: Record<string, number>): string };
type ConDurationFormat = { DurationFormat?: new (locale: string, o: { style: string }) => FormateadorDeDuracion };

/** «1min 4s», «42s», «1h 2min» (el «1m 4s» de DeepSeek), en el idioma de quien lo mira y sin ceros delante. */
export function duracionLegible(ms: number, locale: string): string {
  const partes = partesDeLaDuracion(ms);
  const DurationFormat = (Intl as unknown as ConDurationFormat).DurationFormat;
  if (DurationFormat) {
    try {
      return new DurationFormat(locale, { style: "narrow" }).format(partes);
    } catch {
      // Un idioma que no conoce: abajo, unidad a unidad.
    }
  }
  const unidad = { hours: "hour", minutes: "minute", seconds: "second" } as const;
  return (Object.keys(partes) as (keyof typeof partes)[])
    .map((k) => new Intl.NumberFormat(locale, { style: "unit", unit: unidad[k], unitDisplay: "narrow" }).format(partes[k]!))
    .join(" ");
}
