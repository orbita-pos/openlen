// EL SUSTITUTO DE /api/a EN LA MEDICIÓN — el hermano de lib/page-data/sustituto.ts.
//
// En la medición no hay base de datos, así que cuando Len mira y usa una página
// con cuentas (`usar_pagina`, los ojos), a `/api/a/*` le contesta esto. Sin él,
// la pantalla de entrar que Len acaba de escribir recibía 404 —el servidor de
// medida no conocía la ruta—, y Len la habría «arreglado» rompiéndola.
//
// Guarda en memoria, durante UNA visita, lo que haría la base, y contesta con
// las MISMAS reglas que las rutas de app/api/a/: encadena los mismos módulos
// (la declaración, las entradas, el actor). Lo que la visita va haciendo —el
// dueño entra, da de alta a una cajera, sale, entra ella— cambia quién es el
// actor de `/api/d`, que le pregunta a esto con `actor()`.
//
// Lo que NO imita: el `Origin` (la medición es siempre la propia página), los
// límites de intentos y el bcrypt —aquí la contraseña se compara tal cual, en
// memoria y durante una visita—. `page-accounts-substitute-mirror.test.ts`
// compara este fichero con las rutas, caso por caso.

import { randomUUID } from "node:crypto";

import type { Actor } from "@/lib/page-data/permisos";
import { actorFromSession } from "./actor";
import { readAccountsDeclaration } from "./declaration";
import { cleanName, isValidPassword, normalizeEmail, roleFromInput } from "./input";

export interface AccountsCall {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly error?: string;
}

export interface AccountsSubstitute {
  /** `location` va sólo en las redirecciones (la vuelta del dueño). */
  respond(req: { method: string; url: string; body: string }): { status: number; body: unknown; location?: string };
  /** Quién es, ahora mismo, el que usa la página: lo que `/api/d` tiene que ver. */
  actor(): Actor;
  calls(): readonly AccountsCall[];
}

interface Account {
  readonly id: string;
  email: string;
  name: string | null;
  role: string | null;
  password: string;
  readonly createdAt: string;
  lastLoginAt: string | null;
}

/** El dueño de la medición: no hay uno de verdad, y no hace falta. */
const OWNER = "dueno-de-la-medida";

export function createAccountsSubstitute(
  html: string,
  options: {
    /** El visitante anónimo de la medición, el mismo que usa el de /api/d. */
    readonly visitorId: string;
    /** A dónde vuelve el dueño tras «Entrar como dueño»: el documento medido. */
    readonly documentUrl: string;
  },
): AccountsSubstitute {
  const accounts = readAccountsDeclaration(html);
  const rows: Account[] = [];
  let session: { memberId: string | null; ownerUserId: string | null } | null = null;
  const log: AccountsCall[] = [];

  const answer = (method: string, path: string, status: number, body: Record<string, unknown>, location?: string) => {
    const error = typeof body.error === "string" ? body.error : undefined;
    log.push({ method, path, status, ...(error ? { error } : {}) });
    return { status, body, ...(location ? { location } : {}) };
  };

  function signedIn() {
    if (!session) return null;
    const account = session.memberId ? (rows.find((a) => a.id === session!.memberId) ?? null) : null;
    const actor = actorFromSession({ accounts, session, projectOwnerId: OWNER, account });
    return actor ? { actor, account } : null;
  }

  const publicAccount = (a: Account, papel?: string | null) => ({
    id: a.id,
    email: a.email,
    name: a.name,
    role: papel === undefined ? a.role : papel,
  });

  function parse(body: string): Record<string, unknown> | null {
    try {
      const v: unknown = JSON.parse(body);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  return {
    actor(): Actor {
      return signedIn()?.actor ?? { tipo: "visitante", id: options.visitorId };
    },

    calls: () => [...log],

    respond({ method: raw, url, body }) {
      const method = raw.toUpperCase();
      const [path = ""] = url.split("?");
      const tail = path.replace(/^\/api\/a\/?/, "").split("/").filter(Boolean);
      const route = tail.join("/");

      // «Entrar como dueño»: en producción pasa por openlen.com y vuelve con un
      // código; aquí vuelve directamente al documento medido, ya dentro.
      if (route === "owner-start" && method === "GET") {
        if (accounts) session = { memberId: null, ownerUserId: OWNER };
        return answer(method, path, 303, {}, options.documentUrl);
      }

      if (!accounts) return answer(method, path, 404, { error: "accounts_not_declared" });

      if (route === "me" && method === "GET") {
        const s = signedIn();
        if (!s) return answer(method, path, 200, { account: null, owner: false });
        if (s.actor.tipo === "dueño") return answer(method, path, 200, { account: null, owner: true });
        return answer(method, path, 200, { account: publicAccount(s.account!, s.actor.tipo === "cuenta" ? s.actor.papel : null), owner: false });
      }

      if (route === "login" && method === "POST") {
        const b = parse(body);
        if (!b) return answer(method, path, 400, { error: "bad_request" });
        const email = normalizeEmail(b.email);
        const password = typeof b.password === "string" ? b.password : "";
        if (!email || !isValidPassword(password)) return answer(method, path, 401, { error: "invalid_credentials" });
        const a = rows.find((x) => x.email === email);
        if (!a || a.password !== password) return answer(method, path, 401, { error: "invalid_credentials" });
        session = { memberId: a.id, ownerUserId: null };
        a.lastLoginAt = new Date().toISOString();
        const s = signedIn();
        return answer(method, path, 200, { account: publicAccount(a, s?.actor.tipo === "cuenta" ? s.actor.papel : null), owner: false });
      }

      if (route === "logout" && method === "POST") {
        session = null;
        return answer(method, path, 200, { ok: true });
      }

      if (route === "password" && method === "POST") {
        const s = signedIn();
        if (!s) return answer(method, path, 401, { error: "not_signed_in" });
        if (s.actor.tipo !== "cuenta" || !s.account) return answer(method, path, 400, { error: "owner_uses_openlen" });
        const b = parse(body);
        if (!b) return answer(method, path, 400, { error: "bad_request" });
        const next = typeof b.next === "string" ? b.next : "";
        if (!isValidPassword(next)) return answer(method, path, 422, { error: "weak_password" });
        if (b.current !== s.account.password) return answer(method, path, 401, { error: "invalid_credentials" });
        s.account.password = next;
        return answer(method, path, 200, { ok: true });
      }

      if (tail[0] === "accounts" && tail.length <= 2) {
        if (signedIn()?.actor.tipo !== "dueño") return answer(method, path, 403, { error: "owner_only" });

        if (tail.length === 1 && method === "GET") {
          return answer(method, path, 200, {
            accounts: rows.map((a) => ({
              ...publicAccount(a),
              role: a.role !== null && accounts.papeles.includes(a.role) ? a.role : null,
              createdAt: a.createdAt,
              lastLoginAt: a.lastLoginAt,
            })),
          });
        }
        const b = method === "DELETE" ? {} : parse(body);
        if (!b) return answer(method, path, 400, { error: "bad_request" });

        if (tail.length === 1 && method === "POST") {
          const email = normalizeEmail(b.email);
          if (!email) return answer(method, path, 422, { error: "invalid_email" });
          const password = typeof b.password === "string" ? b.password : "";
          if (!isValidPassword(password)) return answer(method, path, 422, { error: "weak_password" });
          const role = roleFromInput(b.role, accounts);
          if (role === false) return answer(method, path, 422, { error: "unknown_role", roles: accounts.papeles });
          if (rows.some((a) => a.email === email)) return answer(method, path, 409, { error: "email_taken" });
          const a: Account = {
            id: randomUUID(),
            email,
            name: cleanName(b.name),
            role: role ?? null,
            password,
            createdAt: new Date().toISOString(),
            lastLoginAt: null,
          };
          rows.push(a);
          return answer(method, path, 201, { account: publicAccount(a) });
        }

        const id = decodeURIComponent(tail[1] ?? "");
        if (tail.length === 2 && method === "PATCH") {
          const role = roleFromInput(b.role, accounts);
          if (role === false) return answer(method, path, 422, { error: "unknown_role", roles: accounts.papeles });
          if (b.password !== undefined && !isValidPassword(b.password)) return answer(method, path, 422, { error: "weak_password" });
          if (role === undefined && b.name === undefined && b.password === undefined) {
            return answer(method, path, 422, { error: "nothing_to_change" });
          }
          const a = rows.find((x) => x.id === id);
          if (!a) return answer(method, path, 404, { error: "not_found" });
          if (role !== undefined) a.role = role;
          if (b.name !== undefined) a.name = cleanName(b.name);
          if (typeof b.password === "string") {
            a.password = b.password;
            if (session?.memberId === a.id) session = null;
          }
          return answer(method, path, 200, { account: publicAccount(a) });
        }
        if (tail.length === 2 && method === "DELETE") {
          const i = rows.findIndex((x) => x.id === id);
          if (i >= 0) rows.splice(i, 1);
          return answer(method, path, i >= 0 ? 200 : 404, { ok: i >= 0 });
        }
      }

      return answer(method, path, 404, { error: "not_found" });
    },
  };
}
