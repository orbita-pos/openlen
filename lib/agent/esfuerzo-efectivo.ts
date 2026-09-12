import { ESFUERZOS, type EsfuerzoAgente } from "./esfuerzo";

/**
 * Las cuatro capas, en el orden de Claude Code.
 *
 * `CLAUDE_CODE_EFFORT_LEVEL` «overrides effort for this session» y está POR
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
  const deEntorno = ESFUERZOS.find((e) => e === o.env?.trim().toLowerCase());
  if (deEntorno) return deEntorno;
  if (o.delTurno) return o.delTurno;
  if (o.delUsuario) return o.delUsuario;
  return "auto";
}
