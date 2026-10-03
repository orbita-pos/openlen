// @vitest-environment node
//
// EL SUSTITUTO DE /api/a TIENE QUE CONTESTAR COMO LAS RUTAS, CASO POR CASO.
//
// Por lo mismo que lib/page-data/sustituto-espeja-la-ruta.test.ts: en la
// medición a /api/a le contesta una COPIA (substitute.ts), y si la copia se
// separa de las rutas, Len aprende a contentar a la copia —su pantalla de
// entrar «funciona» en la medición y no en la caja del dueño—.
//
// QUÉ COMPARA: el par (status, error) de los dos lados sobre la misma tabla, y
// contra un `esperado` escrito a mano, para que moverlos LOS DOS a la vez
// tampoco cuele. QUÉ NO: los cuerpos con éxito (ids y fechas), el `Origin` y
// los límites de intentos, que el sustituto declara que no imita.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readAccountsDeclaration } from "@/lib/page-accounts/declaration";
import { newSessionToken } from "@/lib/page-accounts/session";
import { createAccountsSubstitute } from "@/lib/page-accounts/substitute";

process.env.PUBLISH_BASE_HOST = "openlen.app";
process.env.OPENLEN_LEGACY_BASE_HOSTS = "openlen.app";

const CON_CUENTAS = `<body><script type="application/json" data-ol-accounts>{"registro":"cerrado","papeles":["cajero"]}</script></body>`;
const SIN_CUENTAS = `<body><h1>Sin cuentas</h1></body>`;

const estado = vi.hoisted(() => ({
  accounts: null as unknown,
  cuentas: [] as { id: string; email: string; name: string | null; role: string | null; passwordHash: string; status: string; createdAt: Date; lastLoginAt: Date | null }[],
  sesiones: new Map<string, { projectId: string; memberId: string | null; ownerUserId: string | null }>(),
  n: 0,
}));

vi.mock("@/lib/projects", () => ({
  getSubdomainOwner: async (sub: string) => (sub === "tienda" ? { userId: "u-dueno", projectId: "p1" } : null),
}));
vi.mock("@/lib/limits", () => ({
  checkAndConsume: async () => ({ ok: true }),
  getClientIp: () => "10.0.0.1",
  ipLimitKey: (ip: string, que: string) => `${que}:${ip}`,
  IP_LIMITS: { page_login: [] },
}));
vi.mock("@/lib/db", () => {
  const cadena: Record<string, unknown> = {};
  cadena.from = () => cadena;
  cadena.where = () => cadena;
  cadena.limit = async () => [{ data: { accounts: estado.accounts } }];
  return { db: { select: () => cadena }, schema: { projects: { id: "id", data: "data" } } };
});
vi.mock("@/lib/auth/visitor-password", () => ({
  DUMMY_HASH: "h:\u0000",
  hashPassword: async (p: string) => `h:${p}`,
  verifyPassword: async (p: string, h: string) => h === `h:${p}`,
  isValidPassword: (p: unknown) => typeof p === "string" && p.length >= 8 && p.length <= 200,
}));
vi.mock("@/lib/page-accounts/store", () => {
  type Fila = (typeof estado.cuentas)[number];
  const publica = (c: Fila) => ({ id: c.id, email: c.email, name: c.name, role: c.role, createdAt: c.createdAt, lastLoginAt: c.lastLoginAt });
  return {
    findAccountForLogin: async (_p: string, email: string) => estado.cuentas.find((c) => c.email === email) ?? null,
    getAccount: async (_p: string, id: string) => {
      const c = estado.cuentas.find((x) => x.id === id);
      return c ? publica(c) : null;
    },
    listAccounts: async () => estado.cuentas.map(publica),
    createAccount: async (a: { email: string; name: string | null; role: string | null; passwordHash: string }) => {
      if (estado.cuentas.some((c) => c.email === a.email)) return "exists";
      const c = { id: `m${++estado.n}`, status: "active", createdAt: new Date(), lastLoginAt: null, ...a };
      estado.cuentas.push(c);
      return publica(c);
    },
    updateAccount: async (_p: string, id: string, patch: Partial<Fila>) => {
      const c = estado.cuentas.find((x) => x.id === id);
      if (!c) return null;
      Object.assign(c, patch);
      return publica(c);
    },
    deleteAccount: async (_p: string, id: string) => {
      const i = estado.cuentas.findIndex((x) => x.id === id);
      if (i < 0) return false;
      estado.cuentas.splice(i, 1);
      return true;
    },
    markLogin: async () => {},
    createSession: async (a: { projectId: string; memberId?: string; ownerUserId?: string }) => {
      const { raw } = newSessionToken();
      estado.sesiones.set(raw, { projectId: a.projectId, memberId: a.memberId ?? null, ownerUserId: a.ownerUserId ?? null });
      return raw;
    },
    findSession: async (projectId: string, raw: string) => {
      const s = estado.sesiones.get(raw);
      return s && s.projectId === projectId ? { memberId: s.memberId, ownerUserId: s.ownerUserId } : null;
    },
    deleteSession: async (raw: string) => void estado.sesiones.delete(raw),
    deleteAccountSessions: async (_p: string, memberId: string) => {
      for (const [k, s] of estado.sesiones) if (s.memberId === memberId) estado.sesiones.delete(k);
    },
  };
});

import { GET as listAccounts, POST as createAccount } from "@/app/api/a/accounts/route";
import { DELETE as deleteAccount, PATCH as patchAccount } from "@/app/api/a/accounts/[id]/route";
import { POST as login } from "@/app/api/a/login/route";
import { POST as logout } from "@/app/api/a/logout/route";
import { GET as me } from "@/app/api/a/me/route";
import { POST as password } from "@/app/api/a/password/route";

// ─── La tabla ───────────────────────────────────────────────────────────────

type Paso =
  | { readonly dueno: true }
  | { readonly metodo: "GET" | "POST" | "PATCH" | "DELETE"; readonly ruta: string; readonly cuerpo?: unknown };
interface Respuesta {
  readonly status: number;
  readonly error?: string;
}
interface Caso {
  readonly nombre: string;
  readonly html?: string;
  readonly preludio?: readonly Paso[];
  readonly peticion: Paso;
  readonly esperado: Respuesta;
}

const DUENO = { dueno: true } as const;
const altaMarta = { metodo: "POST", ruta: "accounts", cuerpo: { email: "marta@tienda.mx", password: "contraseña-1", role: "cajero" } } as const;
const entraMarta = { metodo: "POST", ruta: "login", cuerpo: { email: "marta@tienda.mx", password: "contraseña-1" } } as const;
const sale = { metodo: "POST", ruta: "logout" } as const;

const CASOS: readonly Caso[] = [
  { nombre: "quién soy, sin sesión", peticion: { metodo: "GET", ruta: "me" }, esperado: { status: 200 } },
  { nombre: "una página sin cuentas", html: SIN_CUENTAS, peticion: { metodo: "GET", ruta: "me" }, esperado: { status: 404, error: "accounts_not_declared" } },
  { nombre: "entrar con un correo que no existe", peticion: entraMarta, esperado: { status: 401, error: "invalid_credentials" } },
  { nombre: "entrar con un cuerpo que no es JSON", peticion: { metodo: "POST", ruta: "login", cuerpo: "no es json" }, esperado: { status: 400, error: "bad_request" } },
  { nombre: "entrar con una contraseña corta", peticion: { metodo: "POST", ruta: "login", cuerpo: { email: "marta@tienda.mx", password: "corta" } }, esperado: { status: 401, error: "invalid_credentials" } },
  { nombre: "listar cuentas sin ser el dueño", peticion: { metodo: "GET", ruta: "accounts" }, esperado: { status: 403, error: "owner_only" } },
  { nombre: "el dueño lista las cuentas", preludio: [DUENO], peticion: { metodo: "GET", ruta: "accounts" }, esperado: { status: 200 } },
  { nombre: "el dueño da de alta a una cajera", preludio: [DUENO], peticion: altaMarta, esperado: { status: 201 } },
  { nombre: "un papel que la página no declara", preludio: [DUENO], peticion: { ...altaMarta, cuerpo: { ...altaMarta.cuerpo, role: "gerente" } }, esperado: { status: 422, error: "unknown_role" } },
  { nombre: "un correo que no lo parece", preludio: [DUENO], peticion: { ...altaMarta, cuerpo: { ...altaMarta.cuerpo, email: "marta" } }, esperado: { status: 422, error: "invalid_email" } },
  { nombre: "una contraseña corta al dar de alta", preludio: [DUENO], peticion: { ...altaMarta, cuerpo: { ...altaMarta.cuerpo, password: "corta" } }, esperado: { status: 422, error: "weak_password" } },
  { nombre: "el mismo correo dos veces", preludio: [DUENO, altaMarta], peticion: altaMarta, esperado: { status: 409, error: "email_taken" } },
  { nombre: "la cajera entra con lo que le dio el dueño", preludio: [DUENO, altaMarta, sale], peticion: entraMarta, esperado: { status: 200 } },
  { nombre: "la cajera no puede dar de alta a nadie", preludio: [DUENO, altaMarta, sale, entraMarta], peticion: { ...altaMarta, cuerpo: { ...altaMarta.cuerpo, email: "luis@tienda.mx" } }, esperado: { status: 403, error: "owner_only" } },
  { nombre: "cambiar la contraseña sin sesión", peticion: { metodo: "POST", ruta: "password", cuerpo: { current: "x", next: "contraseña-2" } }, esperado: { status: 401, error: "not_signed_in" } },
  { nombre: "el dueño no tiene contraseña aquí", preludio: [DUENO], peticion: { metodo: "POST", ruta: "password", cuerpo: { current: "x", next: "contraseña-2" } }, esperado: { status: 400, error: "owner_uses_openlen" } },
  { nombre: "la cajera se equivoca de contraseña actual", preludio: [DUENO, altaMarta, sale, entraMarta], peticion: { metodo: "POST", ruta: "password", cuerpo: { current: "otra-cosa-1", next: "contraseña-2" } }, esperado: { status: 401, error: "invalid_credentials" } },
  { nombre: "la cajera pone una contraseña corta", preludio: [DUENO, altaMarta, sale, entraMarta], peticion: { metodo: "POST", ruta: "password", cuerpo: { current: "contraseña-1", next: "corta" } }, esperado: { status: 422, error: "weak_password" } },
  { nombre: "la cajera cambia su contraseña", preludio: [DUENO, altaMarta, sale, entraMarta], peticion: { metodo: "POST", ruta: "password", cuerpo: { current: "contraseña-1", next: "contraseña-2" } }, esperado: { status: 200 } },
  { nombre: "el dueño cambia el papel", preludio: [DUENO, altaMarta], peticion: { metodo: "PATCH", ruta: "accounts/{ultimo}", cuerpo: { role: null } }, esperado: { status: 200 } },
  { nombre: "cambiar sin decir qué", preludio: [DUENO, altaMarta], peticion: { metodo: "PATCH", ruta: "accounts/{ultimo}", cuerpo: {} }, esperado: { status: 422, error: "nothing_to_change" } },
  { nombre: "cambiar una cuenta que no existe", preludio: [DUENO], peticion: { metodo: "PATCH", ruta: "accounts/no-esta", cuerpo: { role: "cajero" } }, esperado: { status: 404, error: "not_found" } },
  { nombre: "quitar una cuenta", preludio: [DUENO, altaMarta], peticion: { metodo: "DELETE", ruta: "accounts/{ultimo}" }, esperado: { status: 200 } },
  { nombre: "quitar una cuenta que no existe", preludio: [DUENO], peticion: { metodo: "DELETE", ruta: "accounts/no-esta" }, esperado: { status: 404 } },
];

// ─── Los dos lados ──────────────────────────────────────────────────────────

const leer = (status: number, cuerpo: unknown): Respuesta => {
  const error = (cuerpo as { error?: unknown } | null)?.error;
  return { status, ...(typeof error === "string" ? { error } : {}) };
};
const idDe = (cuerpo: unknown) => (cuerpo as { account?: { id?: unknown } } | null)?.account?.id;

async function porLasRutas(caso: Caso): Promise<Respuesta> {
  estado.accounts = readAccountsDeclaration(caso.html ?? CON_CUENTAS);
  estado.cuentas = [];
  estado.sesiones.clear();
  estado.n = 0;
  const jar: { cookie?: string; ultimo?: string } = {};
  for (const p of caso.preludio ?? []) await ruta(p, jar);
  return ruta(caso.peticion, jar);
}

async function ruta(p: Paso, jar: { cookie?: string; ultimo?: string }): Promise<Respuesta> {
  if ("dueno" in p) {
    // La vuelta de openlen.com, sin openlen.com: la sesión del dueño, puesta.
    const { raw } = newSessionToken();
    estado.sesiones.set(raw, { projectId: "p1", memberId: null, ownerUserId: "u-dueno" });
    jar.cookie = `__Host-ol_s=${raw}`;
    return { status: 303 };
  }
  const path = p.ruta.replace("{ultimo}", jar.ultimo ?? "");
  const headers: Record<string, string> = { host: "tienda.openlen.app", origin: "https://tienda.openlen.app" };
  if (jar.cookie) headers.cookie = jar.cookie;
  const body = p.cuerpo === undefined ? undefined : typeof p.cuerpo === "string" ? p.cuerpo : JSON.stringify(p.cuerpo);
  const req = new Request(`https://tienda.openlen.app/api/a/${path}`, { method: p.metodo, headers, ...(body !== undefined ? { body } : {}) });
  const [base, id] = path.split("/");
  const ctx = { params: Promise.resolve({ id: id ?? "" }) };
  const r =
    base === "me" ? await me(req)
    : base === "login" ? await login(req)
    : base === "logout" ? await logout(req)
    : base === "password" ? await password(req)
    : base === "accounts" && id === undefined ? await (p.metodo === "GET" ? listAccounts(req) : createAccount(req))
    : await (p.metodo === "PATCH" ? patchAccount(req, ctx) : deleteAccount(req, ctx));
  const puesta = r.headers.get("set-cookie");
  if (puesta) jar.cookie = puesta.split(";")[0];
  const cuerpo = await r.json().catch(() => ({}));
  if (typeof idDe(cuerpo) === "string") jar.ultimo = idDe(cuerpo) as string;
  return leer(r.status, cuerpo);
}

function porElSustituto(caso: Caso): Respuesta {
  const s = createAccountsSubstitute(caso.html ?? CON_CUENTAS, { visitorId: "v", documentUrl: "http://127.0.0.1/doc/" });
  const jar: { ultimo?: string } = {};
  const uno = (p: Paso): Respuesta => {
    const r = "dueno" in p
      ? s.respond({ method: "GET", url: "/api/a/owner-start?back=/", body: "" })
      : s.respond({
          method: p.metodo,
          url: `/api/a/${p.ruta.replace("{ultimo}", jar.ultimo ?? "")}`,
          body: p.cuerpo === undefined ? "" : typeof p.cuerpo === "string" ? p.cuerpo : JSON.stringify(p.cuerpo),
        });
    if (typeof idDe(r.body) === "string") jar.ultimo = idDe(r.body) as string;
    return leer(r.status, r.body);
  };
  for (const p of caso.preludio ?? []) uno(p);
  return uno(caso.peticion);
}

// ─── La prueba ──────────────────────────────────────────────────────────────

beforeEach(() => {
  estado.cuentas = [];
  estado.sesiones.clear();
});

describe("el sustituto de /api/a contesta como las rutas", () => {
  for (const caso of CASOS) {
    it(caso.nombre, async () => {
      const rutas = await porLasRutas(caso);
      const sustituto = porElSustituto(caso);
      expect({ rutas, sustituto }).toEqual({ rutas: caso.esperado, sustituto: caso.esperado });
    });
  }

  // Y lo que de verdad le importa a la medición: lo que pasa en /api/a cambia
  // quién es el actor de /api/d.
  it("el actor de /api/d sigue a la visita: visitante, dueño, cajera, visitante", () => {
    const s = createAccountsSubstitute(CON_CUENTAS, { visitorId: "v", documentUrl: "http://127.0.0.1/doc/" });
    expect(s.actor()).toEqual({ tipo: "visitante", id: "v" });
    s.respond({ method: "GET", url: "/api/a/owner-start", body: "" });
    expect(s.actor()).toEqual({ tipo: "dueño" });
    const alta = s.respond({ method: "POST", url: "/api/a/accounts", body: JSON.stringify(altaMarta.cuerpo) });
    s.respond({ method: "POST", url: "/api/a/logout", body: "" });
    s.respond({ method: "POST", url: "/api/a/login", body: JSON.stringify(entraMarta.cuerpo) });
    expect(s.actor()).toEqual({ tipo: "cuenta", id: idDe(alta.body), papel: "cajero" });
    s.respond({ method: "POST", url: "/api/a/logout", body: "" });
    expect(s.actor()).toEqual({ tipo: "visitante", id: "v" });
  });
});
