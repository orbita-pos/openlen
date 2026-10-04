// Entrar como un usuario de la página en la visita de Len (`usar_pagina`).
//
// Es lo que hace Lovable (su changelog, 08/08/2026): si la app tiene un solo
// usuario, entra como ése; si tiene varios y no se le dijo cuál, pregunta en el
// chat antes de entrar; nunca crea una cuenta para probar. Y como en Lovable, la
// visita usa la base REAL: la de la página publicada.
//
// La sesión es una de verdad de GoTrue (`auth.sessions` + su refresh token),
// abierta como la abriría `admin.generateLink` + `verifyOtp` —por eso su método
// es `otp`, el mismo que deja `/verify`—, pero sin escribir la ficha en el
// usuario: así no pisa un enlace de recuperación que tenga pendiente. Se cierra
// al acabar la visita (`end`).

import type { BackendProject } from "../router";
import { issueSession, type AuthContext } from "./handler";
import { deleteSessions, findRefreshToken, findUserByEmail, listEmailUsers } from "./store";

/** Lo que Len pasa cuando no sabe el correo: entra como el único usuario. */
export const ONLY_USER = "only_user";

const AUD = "authenticated";
/** Cuántos correos se nombran cuando hay que elegir. */
const LISTED = 10;
/** Lo que queda en `auth.sessions.user_agent`: quien mire las sesiones del
 *  usuario sabe que ésta fue la visita de Len. */
const VISIT_USER_AGENT = "OpenLen (Len's visit)";

/** La clave del `localStorage` donde supabase-js guarda la sesión: la suya por
 *  defecto, `sb-${baseUrl.hostname.split(".")[0]}-auth-token` (SupabaseClient). */
export function supabaseStorageKey(projectUrl: string): string {
  return `sb-${new URL(projectUrl).hostname.split(".")[0]}-auth-token`;
}

export type VisitSignIn =
  | {
      readonly ok: true;
      readonly email: string;
      /** La `Session` tal como la guarda supabase-js. */
      readonly session: Record<string, unknown>;
      /** Cierra la sesión: su token deja de valer. */
      end(): Promise<void>;
    }
  | { readonly ok: false; readonly reason: "no_users" }
  | { readonly ok: false; readonly reason: "banned" }
  | { readonly ok: false; readonly reason: "pick_one"; readonly emails: readonly string[]; readonly total: number }
  | { readonly ok: false; readonly reason: "not_found"; readonly emails: readonly string[]; readonly total: number };

type Opened =
  | Exclude<VisitSignIn, { ok: true }>
  | { readonly ok: true; readonly email: string; readonly session: Record<string, unknown> };

export async function signInForVisit(project: BackendProject, who: string): Promise<VisitSignIn> {
  const ctx: AuthContext = {
    db: project.db,
    config: project.auth.config,
    sendMail: project.auth.sendMail,
    jwtSecret: project.jwtSecret,
    keyRole: "service_role",
    apikey: null,
  };
  const req = new Request(`${project.auth.config.externalUrl}/token`, { headers: { "user-agent": VISIT_USER_AGENT } });
  const wanted = who.trim();
  const opened = await project.db.transaction(async (q): Promise<Opened> => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    let email: string;
    if (wanted.toLowerCase() === ONLY_USER) {
      const { emails, total } = await listEmailUsers(q, AUD, LISTED);
      if (total === 0) return { ok: false, reason: "no_users" };
      if (total > 1) return { ok: false, reason: "pick_one", emails, total };
      email = emails[0]!;
    } else {
      email = wanted;
    }
    const user = await findUserByEmail(q, email, AUD);
    if (!user || user.deleted_at || user.is_anonymous) {
      const { emails, total } = await listEmailUsers(q, AUD, LISTED);
      return { ok: false, reason: "not_found", emails, total };
    }
    if (user.banned_until && new Date(user.banned_until).getTime() > Date.now()) return { ok: false, reason: "banned" };
    const session = await issueSession(ctx, q, req, user.id, "otp");
    return { ok: true, email: user.email ?? email, session };
  });
  if (!opened.ok) return opened;
  const refreshToken = String(opened.session.refresh_token);
  return {
    ...opened,
    end: () =>
      project.db.transaction(async (q) => {
        await q(`select set_config('role', 'supabase_auth_admin', true)`);
        // Por el refresh token con el que se abrió: si la página lo rotó, la
        // fila vieja sigue con su sesión.
        const rt = await findRefreshToken(q, refreshToken);
        if (rt?.session_id) await deleteSessions(q, rt.user_id, rt.session_id, "local");
      }),
  };
}
