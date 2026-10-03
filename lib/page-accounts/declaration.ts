// El bloque que la página escribe para tener CUENTAS: gente que entra y sale
// con correo y contraseña, como en un punto de venta (plans/page-accounts/design.md).
//
//   <script type="application/json" data-ol-accounts>
//   {"registro":"cerrado","papeles":["cajero"]}
//   </script>
//
// Hermano de `data-ol-stores` (lib/page-data/declaracion.ts) y con sus mismas
// reglas: puro, sin base ni red, NUNCA lanza —corre sobre HTML que escribió un
// modelo— y ante la duda, MENOS permiso. Sus claves van en el mismo idioma que
// las de aquel bloque, porque las escribe el mismo autor en la misma página.
//
// El DUEÑO del proyecto no se declara: existe siempre y lo puede todo, como en
// `permite()`. Lo que se declara son los papeles que la página usa; qué puede
// cada uno lo dice cada almacén en su campo `papeles`.

import { ROLE_NAME_RE } from "@/lib/page-data/declaracion";

/** `cerrado`    — sólo el dueño crea cuentas (una caja con sus cajeros).
 *  `abierto`    — cualquiera se registra (los clientes de una tienda).
 *  `invitacion` — se entra con un código que da el dueño. */
export type SignupMode = "cerrado" | "abierto" | "invitacion";

export interface AccountsDeclaration {
  readonly registro: SignupMode;
  readonly papeles: readonly string[];
}

const SIGNUP_MODES = new Set<SignupMode>(["cerrado", "abierto", "invitacion"]);
const MAX_ROLES = 20;

const BLOCK_RE = /<script\b[^>]*\bdata-ol-accounts\b[^>]*>([\s\S]*?)<\/script>/i;

/** La declaración de la página, o `null` si no tiene cuentas. */
export function readAccountsDeclaration(html: string): AccountsDeclaration | null {
  const m = BLOCK_RE.exec(html);
  if (!m) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(m[1]!);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;

  // Un registro que no reconocemos es `cerrado`, el que menos abre y el único
  // que no deja entrar a nadie que el dueño no haya dado de alta.
  const registro =
    typeof v.registro === "string" && SIGNUP_MODES.has(v.registro as SignupMode)
      ? (v.registro as SignupMode)
      : "cerrado";

  const papeles: string[] = [];
  if (Array.isArray(v.papeles)) {
    for (const p of v.papeles) {
      if (typeof p !== "string" || !ROLE_NAME_RE.test(p) || papeles.includes(p)) continue;
      papeles.push(p);
      if (papeles.length === MAX_ROLES) break;
    }
  }
  return { registro, papeles };
}
