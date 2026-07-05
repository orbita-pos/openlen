// Decisión pura del reclamo anti-okupa. Sin I/O — unit-testeada exhaustivamente
// porque guarda la propiedad de la cuenta.

export interface ReclaimInput {
  /** Does the target row already carry a password hash? */
  hasPassword: boolean;
  /** Was the row's email already verified before this click? */
  alreadyVerified: boolean;
}

/** True → the row has a password set while it was NOT verified (whoever set it
 *  never proved ownership — possibly a squatter), and this magic-link click is
 *  proof of ownership → clear that password + kill its sessions. There is no
 *  "trusted" unverified password: any magic-link on an unverified row reclaims. */
export function shouldClearPassword(input: ReclaimInput): boolean {
  return input.hasPassword && !input.alreadyVerified;
}
