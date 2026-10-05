import { ESFUERZOS, type EsfuerzoAgente } from "./esfuerzo";

/**
 * Las cuatro capas, en el orden de Claude Code.
 *
 * La variable de entorno de Claude Code manda en toda la sesión y está POR
 * ENCIMA de `/effort`, que a su vez está por encima del ajuste guardado. Aquí
 * el equivalente del primero es `OPENLEN_AGENT_EFFORT`: la palanca del
 * operador para clavar el esfuerzo en un incidente sin tocar la base ni
 * esperar a un despliegue.
 *
 * Un valor inválido se IGNORA y se sigue bajando por las capas. Romper el turno
 * del usuario por una variable de entorno mal escrita sería cambiar un problema
 * de configuración por una caída.
 */
export function esfuerzoEfectivo(o: {
  env?: string;
  delTurno?: EsfuerzoAgente | null;
  delUsuario?: EsfuerzoAgente | null;
}): EsfuerzoAgente {
  const deEntorno = operatorEffort(o.env);
  if (deEntorno) return deEntorno;
  if (o.delTurno) return o.delTurno;
  if (o.delUsuario) return o.delUsuario;
  return "auto";
}

/** La capa de arriba sola: lo que clavó el operador en `OPENLEN_AGENT_EFFORT`,
 *  o `null` si no clavó nada válido. Aparte porque Len Dynamis la necesita sola:
 *  su razonamiento máximo es la postura del TURNO, y el operador sigue mandando
 *  por encima (`brain.ts`). */
export function operatorEffort(env?: string): EsfuerzoAgente | null {
  return ESFUERZOS.find((e) => e === env?.trim().toLowerCase()) ?? null;
}
