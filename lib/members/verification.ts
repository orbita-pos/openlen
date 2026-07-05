// Decisión pura del reclamo anti-okupa. Sin I/O — unit-testeada exhaustivamente
// porque guarda la propiedad de la cuenta.

export interface ReclaimInput {
  /** Intención del token del magic-link que se está consumiendo. */
  tokenKind: "login" | "confirm";
  /** ¿La fila destino ya carga un hash de contraseña? */
  hasPassword: boolean;
  /** ¿El correo de la fila ya estaba verificado antes de este click? */
  alreadyVerified: boolean;
}

/** True → la contraseña se puso en una fila NO verificada por alguien que nunca
 *  probó propiedad, y este magic-link (un link de acceso fresco, no la
 *  auto-confirmación mandada al registrarse) es el dueño real reclamando →
 *  borra esa contraseña + mata sus sesiones. Un token 'confirm' es la misma
 *  persona confirmando su propio signup → conserva su contraseña. */
export function shouldClearPassword(input: ReclaimInput): boolean {
  return input.tokenKind === "login" && input.hasPassword && !input.alreadyVerified;
}
