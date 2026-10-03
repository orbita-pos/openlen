// Quién es, a efectos de permisos, el que trae una sesión. PURO: la base ya
// buscó la sesión y la cuenta; aquí sólo se decide, para poder probarlo celda
// a celda sin levantar nada.

import type { Actor } from "@/lib/page-data/permisos";
import type { AccountsDeclaration } from "./declaration";

export type SignedInActor = Extract<Actor, { tipo: "dueño" } | { tipo: "cuenta" }>;

/** `null` = la sesión no vale aquí: la página ya no declara cuentas, la del
 *  dueño es de alguien que ya no es el dueño, o la cuenta ya no existe. */
export function actorFromSession(args: {
  readonly accounts: AccountsDeclaration | null;
  readonly session: { readonly memberId: string | null; readonly ownerUserId: string | null };
  readonly projectOwnerId: string;
  readonly account: { readonly id: string; readonly role: string | null } | null;
}): SignedInActor | null {
  // Sin el bloque en lo publicado no hay cuentas, y una cookie vieja no vale
  // nada: quitar `data-ol-accounts` tiene que bastar para cerrar la puerta.
  if (!args.accounts) return null;

  if (args.session.ownerUserId !== null) {
    // Se compara con el dueño de AHORA: si el proyecto cambió de manos, la
    // sesión del anterior deja de abrir nada.
    return args.session.ownerUserId === args.projectOwnerId ? { tipo: "dueño" } : null;
  }

  if (args.session.memberId === null || !args.account || args.account.id !== args.session.memberId) return null;
  // Un papel que la página ya no declara no da nada: la cuenta sigue, sin papel.
  const papel =
    args.account.role !== null && args.accounts.papeles.includes(args.account.role) ? args.account.role : null;
  return { tipo: "cuenta", id: args.account.id, papel };
}

/** Lo que va en `pageData.visitorId` cuando escribe este actor, y lo que
 *  significa «propios» al leer. El dueño escribe documentos del dueño (null);
 *  una cuenta, los suyos —le siguen de un dispositivo a otro—; un visitante,
 *  los de su cookie. El prefijo no puede chocar con un id de visitante: ésos
 *  los firma el servidor (lib/page-data/visitante.ts). */
export function rowOwnerKey(actor: Actor): string | null {
  switch (actor.tipo) {
    case "dueño":
      return null;
    case "cuenta":
      return `cuenta:${actor.id}`;
    case "visitante":
      return actor.id;
  }
}
