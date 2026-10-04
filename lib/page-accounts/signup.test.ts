// @vitest-environment node
//
// F2 de las cuentas (plans/page-accounts/design.md), «como Supabase» (Jesús,
// 04/10): registro ABIERTO con confirmación de correo, el enlace de un uso que
// lo confirma (`/api/a/verify`) y recuperar la contraseña por correo. Como
// routes.test.ts: se sustituye SÓLO lo que guarda filas (`store`), el bcrypt y
// el envío del correo; la declaración, la sesión y la procedencia corren de
// verdad.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readAccountsDeclaration } from "@/lib/page-accounts/declaration";
import { hashToken, newSessionToken } from "@/lib/page-accounts/session";

process.env.OPENLEN_INTERNAL_SECRET ||= "secreto-de-prueba";
process.env.PUBLISH_BASE_HOST = "openlen.app";
process.env.OPENLEN_LEGACY_BASE_HOSTS = "openlen.app";

const ABIERTA = `<!doctype html><html lang="es"><body>
<script type="application/json" data-ol-accounts>{"registro":"abierto","papeles":["cliente"]}</script></body></html>`;

type Cuenta = {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  passwordHash: string | null;
  status: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  lastLoginAt: Date | null;
};

const estado = vi.hoisted(() => ({
  accounts: null as unknown,
  cuentas: [] as Cuenta[],
  sesiones: new Map<string, { projectId: string; memberId: string | null; ownerUserId: string | null }>(),
  fichas: new Map<string, { projectId: string; email: string; purpose: string; backPath: string; used: boolean; expires: number }>(),
  correos: [] as { to: string; kind: string; link: string; lang: string; role?: string | null }[],
  correoDisponible: true,
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
  cadena.limit = async () => [{ data: { accounts: estado.accounts }, plan: "free" }];
  return { db: { select: () => cadena }, schema: { users: { id: "id", plan: "plan" }, projects: { id: "id", data: "data" } } };
});
vi.mock("@/lib/auth/visitor-password", () => ({
  DUMMY_HASH: "h:\u0000",
  hashPassword: async (p: string) => `h:${p}`,
  verifyPassword: async (p: string, h: string) => h === `h:${p}`,
  isValidPassword: (p: unknown) => typeof p === "string" && p.length >= 8 && p.length <= 200,
}));
vi.mock("@/lib/page-accounts/mail", () => ({
  accountEmailAvailable: () => estado.correoDisponible,
  sendAccountEmail: async (m: { to: string; kind: string; link: string; lang: string; role?: string | null }) => {
    estado.correos.push({ to: m.to, kind: m.kind, link: m.link, lang: m.lang, role: m.role ?? null });
  },
}));
vi.mock("@/lib/page-accounts/store", () => {
  const publica = (c: Cuenta) => ({ id: c.id, email: c.email, name: c.name, role: c.role, createdAt: c.createdAt, lastLoginAt: c.lastLoginAt });
  const de = (email: string) => estado.cuentas.find((c) => c.email === email);
  return {
    findAccountForLogin: async (_p: string, email: string) => de(email) ?? null,
    createUnconfirmedAccount: async (a: { email: string; name: string | null; passwordHash: string }) => {
      if (de(a.email)) return "exists";
      const c: Cuenta = { id: `m${++estado.n}`, role: null, status: "unconfirmed", emailVerifiedAt: null, createdAt: new Date(), lastLoginAt: null, ...a };
      estado.cuentas.push(c);
      return publica(c);
    },
    createInvitedAccount: async (a: { email: string; name: string | null; role: string | null }) => {
      if (de(a.email)) return "exists";
      const c: Cuenta = { id: `m${++estado.n}`, passwordHash: null, status: "invited", emailVerifiedAt: null, createdAt: new Date(), lastLoginAt: null, ...a };
      estado.cuentas.push(c);
      return publica(c);
    },
    updateAccount: async (_p: string, id: string, patch: { role?: string | null }) => {
      const c = estado.cuentas.find((x) => x.id === id);
      if (!c) return null;
      if (patch.role !== undefined) c.role = patch.role;
      return publica(c);
    },
    createEmailToken: async (a: { projectId: string; email: string; purpose: string; backPath: string; ttlMs: number }) => {
      const { raw, hash } = newSessionToken();
      estado.fichas.set(hash, { projectId: a.projectId, email: a.email, purpose: a.purpose, backPath: a.backPath, used: false, expires: Date.now() + a.ttlMs });
      return raw;
    },
    redeemEmailToken: async (projectId: string, raw: string, purposes: readonly string[]) => {
      const f = estado.fichas.get(hashToken(raw));
      if (!f || f.used || f.projectId !== projectId || !purposes.includes(f.purpose) || f.expires < Date.now()) return null;
      f.used = true;
      return { email: f.email, purpose: f.purpose, backPath: f.backPath };
    },
    confirmAccount: async (_p: string, email: string) => {
      const c = de(email);
      if (!c || c.status !== "unconfirmed") return c && c.status === "active" ? publica(c) : null;
      c.status = "active";
      c.emailVerifiedAt = new Date();
      return publica(c);
    },
    setAccountPassword: async (_p: string, email: string, passwordHash: string) => {
      const c = de(email);
      if (!c) return null;
      c.passwordHash = passwordHash;
      c.status = "active";
      c.emailVerifiedAt ??= new Date();
      return publica(c);
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
    getAccount: async (_p: string, id: string) => {
      const c = estado.cuentas.find((x) => x.id === id);
      return c ? publica(c) : null;
    },
    deleteSession: async (raw: string) => void estado.sesiones.delete(raw),
    deleteAccountSessions: async (_p: string, memberId: string) => {
      for (const [k, s] of estado.sesiones) if (s.memberId === memberId) estado.sesiones.delete(k);
    },
  };
});

import { POST as register } from "@/app/api/a/register/route";
import { POST as recover } from "@/app/api/a/recover/route";
import { GET as verify } from "@/app/api/a/verify/route";
import { POST as password } from "@/app/api/a/password/route";
import { POST as login } from "@/app/api/a/login/route";
import { GET as me } from "@/app/api/a/me/route";
import { POST as invite } from "@/app/api/a/invites/route";

const DE_AQUI = "https://tienda.openlen.app";
const HERMANA = "https://malo.openlen.app";

function pide(url: string, { method = "GET", origin, cookie, body }: { method?: string; origin?: string; cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { host: "tienda.openlen.app" };
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  return new Request(`${DE_AQUI}${url}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
const galleta = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0];
/** A dónde manda la redirección, resuelto como lo resuelve el navegador: desde
 *  la página. La `Location` es RELATIVA (como la de `/api/a/owner`): el
 *  navegador se queda en el host por el que llegó, también el del proxy del
 *  E2E, que le reescribe el `Host`. Una que empieza por `//` sería otro host. */
const destino = (r: Response) => {
  const location = r.headers.get("location")!;
  expect(location).toMatch(/^\/(?![/\\])/);
  return new URL(location, DE_AQUI).href;
};
/** La ficha cruda del último correo mandado. */
const fichaDelCorreo = () => new URL(estado.correos.at(-1)!.link).searchParams.get("token")!;
const registrarse = (body: Record<string, unknown> = {}) =>
  register(pide("/api/a/register", { method: "POST", origin: DE_AQUI, body: { email: "ana@correo.mx", password: "contraseña-larga", ...body } }));

beforeEach(() => {
  estado.accounts = readAccountsDeclaration(ABIERTA);
  estado.cuentas = [];
  estado.sesiones.clear();
  estado.fichas.clear();
  estado.correos = [];
  estado.correoDisponible = true;
  estado.n = 0;
});

describe("registrarse (registro abierto), con confirmación de correo", () => {
  it("🔴 crea la cuenta SIN papel y SIN entrar, y le manda el enlace para confirmar", async () => {
    const r = await registrarse({ lang: "es", back: "/mi-cuenta" });
    expect([r.status, await r.json()]).toEqual([200, { ok: true, confirm: "sent" }]);
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(estado.cuentas).toMatchObject([{ email: "ana@correo.mx", role: null, status: "unconfirmed" }]);
    expect(estado.correos).toMatchObject([{ to: "ana@correo.mx", kind: "confirm", lang: "es" }]);
    expect(estado.correos[0]!.link).toMatch(/^https:\/\/tienda\.openlen\.app\/api\/a\/verify\?token=[A-Za-z0-9_-]{43}$/);
  });

  it("🔴 sin confirmar no puede entrar", async () => {
    await registrarse();
    const r = await login(pide("/api/a/login", { method: "POST", origin: DE_AQUI, body: { email: "ana@correo.mx", password: "contraseña-larga" } }));
    expect(r.status).toBe(401);
  });

  it("con registro cerrado o por invitación, no se registra nadie", async () => {
    for (const registro of ["cerrado", "invitacion"]) {
      estado.accounts = readAccountsDeclaration(ABIERTA.replace('"abierto"', `"${registro}"`));
      const r = await registrarse();
      expect([r.status, await r.json()]).toEqual([403, { error: "signup_closed" }]);
    }
    expect(estado.cuentas).toEqual([]);
  });

  // Decir «ese correo ya tiene cuenta» enseña qué correos la tienen.
  it("un correo que ya tiene cuenta responde IGUAL y no le cambia nada", async () => {
    estado.cuentas.push({ id: "m-ana", email: "ana@correo.mx", name: null, role: "cliente", passwordHash: "h:la-de-siempre", status: "active", emailVerifiedAt: new Date(), createdAt: new Date(), lastLoginAt: null });
    const r = await registrarse();
    expect([r.status, await r.json()]).toEqual([200, { ok: true, confirm: "sent" }]);
    expect(estado.cuentas[0]!.passwordHash).toBe("h:la-de-siempre");
    expect(estado.correos).toEqual([]);
  });

  // Como Supabase (GoTrue, `signup`): a una cuenta SIN confirmar se le vuelve a
  // mandar el enlace —el primero se perdió, o un filtro de correo lo gastó—,
  // pero no se le cambia nada: quien se registra otra vez no ha probado que
  // ese correo sea suyo.
  it("una cuenta SIN confirmar recibe otro enlace, y su contraseña no cambia", async () => {
    await registrarse();
    const r = await registrarse({ password: "otra-contraseña-larga" });
    expect([r.status, await r.json()]).toEqual([200, { ok: true, confirm: "sent" }]);
    expect(estado.cuentas).toHaveLength(1);
    expect(estado.cuentas[0]!.passwordHash).toBe("h:contraseña-larga");
    expect(estado.correos.map((c) => c.kind)).toEqual(["confirm", "confirm"]);
    // El nuevo vale.
    const v = await verify(pide(`/api/a/verify?token=${fichaDelCorreo()}`));
    expect(destino(v)).toBe(`${DE_AQUI}/#ol-auth=confirmed`);
  });

  it("sin correo configurado lo dice, y no finge", async () => {
    estado.correoDisponible = false;
    const r = await registrarse();
    expect([r.status, await r.json()]).toEqual([503, { error: "email_unavailable" }]);
    expect(estado.cuentas).toEqual([]);
  });

  it("desde una página hermana, no", async () => {
    const r = await register(pide("/api/a/register", { method: "POST", origin: HERMANA, body: { email: "ana@correo.mx", password: "contraseña-larga" } }));
    expect(r.status).toBe(403);
  });

  it("contraseña corta: 422; correo que no lo parece: 400", async () => {
    expect((await registrarse({ password: "corta" })).status).toBe(422);
    expect((await registrarse({ email: "no-es-un-correo" })).status).toBe(400);
  });
});

describe("el enlace del correo (/api/a/verify)", () => {
  it("🔴 confirmar: activa la cuenta, la deja dentro y vuelve a la página", async () => {
    await registrarse({ back: "/mi-cuenta" });
    const r = await verify(pide(`/api/a/verify?token=${fichaDelCorreo()}`));
    expect(r.status).toBe(303);
    expect(destino(r)).toBe(`${DE_AQUI}/mi-cuenta#ol-auth=confirmed`);
    expect(estado.cuentas[0]).toMatchObject({ status: "active" });
    const cookie = galleta(r);
    expect(await (await me(pide("/api/a/me", { cookie }))).json()).toMatchObject({ account: { email: "ana@correo.mx", role: null } });
  });

  it("🔴 de UN uso: la segunda vez no vale", async () => {
    await registrarse();
    const ficha = fichaDelCorreo();
    await verify(pide(`/api/a/verify?token=${ficha}`));
    const otra = await verify(pide(`/api/a/verify?token=${ficha}`));
    expect(destino(otra)).toBe(`${DE_AQUI}/#ol-auth=invalid`);
    expect(otra.headers.get("set-cookie")).toBeNull();
  });

  it("una ficha inventada vuelve a la página diciendo que no vale", async () => {
    const r = await verify(pide(`/api/a/verify?token=${"x".repeat(43)}`));
    expect([r.status, destino(r)]).toEqual([303, `${DE_AQUI}/#ol-auth=invalid`]);
  });
});

describe("recuperar la contraseña", () => {
  const marta = (): Cuenta => ({ id: "m-marta", email: "marta@tienda.mx", name: "Marta", role: "cliente", passwordHash: "h:la-vieja-larga", status: "active", emailVerifiedAt: new Date(), createdAt: new Date(), lastLoginAt: null });
  const pedirEnlace = (email = "marta@tienda.mx") =>
    recover(pide("/api/a/recover", { method: "POST", origin: DE_AQUI, body: { email, lang: "en", back: "/entrar" } }));

  it("🔴 el enlace lleva a la página con un permiso de un uso para poner contraseña nueva, sin pedir la vieja", async () => {
    estado.cuentas.push(marta());
    expect([(await pedirEnlace()).status]).toEqual([200]);
    expect(estado.correos).toMatchObject([{ to: "marta@tienda.mx", kind: "recovery", lang: "en" }]);

    const v = await verify(pide(`/api/a/verify?token=${fichaDelCorreo()}`));
    const adonde = new URL(destino(v));
    expect(adonde.pathname).toBe("/entrar");
    const hash = new URLSearchParams(adonde.hash.slice(1));
    expect(hash.get("ol-auth")).toBe("recovery");
    const grant = hash.get("ol-grant")!;
    expect(grant).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const r = await password(pide("/api/a/password", { method: "POST", origin: DE_AQUI, body: { grant, next: "la-nueva-larga" } }));
    expect(r.status).toBe(200);
    expect(estado.cuentas[0]!.passwordHash).toBe("h:la-nueva-larga");
    // Y queda dentro.
    expect(await (await me(pide("/api/a/me", { cookie: galleta(r) }))).json()).toMatchObject({ account: { email: "marta@tienda.mx" } });
    // El permiso no vale dos veces.
    const otra = await password(pide("/api/a/password", { method: "POST", origin: DE_AQUI, body: { grant, next: "otra-mas-larga" } }));
    expect(otra.status).toBe(401);
  });

  it("al poner la nueva se cierran sus otras sesiones", async () => {
    estado.cuentas.push(marta());
    const vieja = newSessionToken().raw;
    estado.sesiones.set(vieja, { projectId: "p1", memberId: "m-marta", ownerUserId: null });
    await pedirEnlace();
    const v = await verify(pide(`/api/a/verify?token=${fichaDelCorreo()}`));
    const grant = new URLSearchParams(new URL(destino(v)).hash.slice(1)).get("ol-grant")!;
    await password(pide("/api/a/password", { method: "POST", origin: DE_AQUI, body: { grant, next: "la-nueva-larga" } }));
    expect(estado.sesiones.has(vieja)).toBe(false);
  });

  it("un correo sin cuenta responde IGUAL y no manda nada", async () => {
    const r = await pedirEnlace("nadie@tienda.mx");
    expect([r.status, await r.json()]).toEqual([200, { ok: true }]);
    expect(estado.correos).toEqual([]);
  });

  it("BRAZO DE CONTROL: la ficha de confirmar no sirve de permiso para cambiar la contraseña", async () => {
    await registrarse();
    const r = await password(pide("/api/a/password", { method: "POST", origin: DE_AQUI, body: { grant: fichaDelCorreo(), next: "la-nueva-larga" } }));
    expect(r.status).toBe(401);
  });

  it("desde una página hermana, el permiso no se puede usar", async () => {
    estado.cuentas.push(marta());
    await pedirEnlace();
    const v = await verify(pide(`/api/a/verify?token=${fichaDelCorreo()}`));
    const grant = new URLSearchParams(new URL(destino(v)).hash.slice(1)).get("ol-grant")!;
    const r = await password(pide("/api/a/password", { method: "POST", origin: HERMANA, body: { grant, next: "la-nueva-larga" } }));
    expect(r.status).toBe(403);
  });
});

describe("invitar (el dueño)", () => {
  const CERRADA = ABIERTA.replace('"abierto"', '"cerrado"').replace('["cliente"]', '["cajera","gerente"]');
  /** La cookie del dueño en su página, como la deja `/api/a/owner`. */
  const delDueno = () => {
    const raw = newSessionToken().raw;
    estado.sesiones.set(raw, { projectId: "p1", memberId: null, ownerUserId: "u-dueno" });
    return `__Host-ol_s=${raw}`;
  };
  const invitar = (body: Record<string, unknown>, { cookie = delDueno(), origin = DE_AQUI } = {}) =>
    invite(pide("/api/a/invites", { method: "POST", origin, cookie, body }));

  beforeEach(() => {
    estado.accounts = readAccountsDeclaration(CERRADA);
  });

  it("🔴 crea la cuenta invitada con su papel y sin contraseña, y le manda el enlace", async () => {
    const r = await invitar({ email: "Marta@Tienda.mx", role: "cajera", name: "Marta", lang: "es", back: "/caja" });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ account: { email: "marta@tienda.mx", role: "cajera" }, invite: "sent" });
    expect(estado.cuentas).toMatchObject([{ email: "marta@tienda.mx", role: "cajera", status: "invited", passwordHash: null }]);
    expect(estado.correos).toMatchObject([{ to: "marta@tienda.mx", kind: "invite", lang: "es", role: "cajera" }]);
    expect(estado.correos[0]!.link).toMatch(/^https:\/\/tienda\.openlen\.app\/api\/a\/verify\?token=[A-Za-z0-9_-]{43}$/);
  });

  it("🔴 la invitada abre el enlace, pone su contraseña y queda dentro con su papel", async () => {
    await invitar({ email: "marta@tienda.mx", role: "cajera", back: "/caja" });
    // Antes de aceptar no entra: no tiene contraseña.
    const antes = await login(pide("/api/a/login", { method: "POST", origin: DE_AQUI, body: { email: "marta@tienda.mx", password: "cualquiera-larga" } }));
    expect(antes.status).toBe(401);

    const v = await verify(pide(`/api/a/verify?token=${fichaDelCorreo()}`));
    const adonde = new URL(destino(v));
    expect(adonde.pathname).toBe("/caja");
    const hash = new URLSearchParams(adonde.hash.slice(1));
    expect(hash.get("ol-auth")).toBe("invite");
    const r = await password(pide("/api/a/password", { method: "POST", origin: DE_AQUI, body: { grant: hash.get("ol-grant"), next: "la-de-marta-larga" } }));
    expect(r.status).toBe(200);
    expect(estado.cuentas[0]).toMatchObject({ status: "active", passwordHash: "h:la-de-marta-larga" });
    expect(await (await me(pide("/api/a/me", { cookie: galleta(r) }))).json()).toMatchObject({ account: { email: "marta@tienda.mx", role: "cajera" } });
  });

  it("invitar vale con cualquier registro: es cosa del dueño", async () => {
    for (const registro of ["abierto", "invitacion", "cerrado"]) {
      estado.accounts = readAccountsDeclaration(CERRADA.replace('"cerrado"', `"${registro}"`));
      const r = await invitar({ email: `${registro}@tienda.mx`, role: "cajera" });
      expect(r.status, registro).toBe(201);
    }
  });

  it("BRAZO DE CONTROL: sólo el dueño; una cuenta de la página no invita, y sin sesión tampoco", async () => {
    estado.cuentas.push({ id: "m-cajera", email: "cajera@tienda.mx", name: null, role: "cajera", passwordHash: "h:x-larga-x", status: "active", emailVerifiedAt: new Date(), createdAt: new Date(), lastLoginAt: null });
    const suya = newSessionToken().raw;
    estado.sesiones.set(suya, { projectId: "p1", memberId: "m-cajera", ownerUserId: null });
    const r = await invitar({ email: "otra@tienda.mx", role: "gerente" }, { cookie: `__Host-ol_s=${suya}` });
    expect([r.status, await r.json()]).toEqual([403, { error: "owner_only" }]);
    const sin = await invite(pide("/api/a/invites", { method: "POST", origin: DE_AQUI, body: { email: "otra@tienda.mx" } }));
    expect(sin.status).toBe(403);
    expect(estado.correos).toEqual([]);
  });

  it("desde una página hermana, ni el dueño", async () => {
    const r = await invitar({ email: "otra@tienda.mx", role: "cajera" }, { origin: HERMANA });
    expect(r.status).toBe(403);
    expect(estado.cuentas).toEqual([]);
  });

  it("un papel que la página no declara: 422, y dice cuáles hay", async () => {
    const r = await invitar({ email: "otra@tienda.mx", role: "cajero" });
    expect([r.status, await r.json()]).toEqual([422, { error: "unknown_role", roles: ["cajera", "gerente"] }]);
  });

  it("un correo con cuenta activa: 409; uno invitado que no aceptó: otro enlace, con el papel nuevo", async () => {
    estado.cuentas.push({ id: "m-ana", email: "ana@tienda.mx", name: null, role: "cajera", passwordHash: "h:x-larga-x", status: "active", emailVerifiedAt: new Date(), createdAt: new Date(), lastLoginAt: null });
    expect((await invitar({ email: "ana@tienda.mx", role: "gerente" })).status).toBe(409);
    expect(estado.cuentas[0]!.role).toBe("cajera");

    await invitar({ email: "marta@tienda.mx", role: "cajera" });
    const otra = await invitar({ email: "marta@tienda.mx", role: "gerente" });
    expect(otra.status).toBe(200);
    expect(estado.cuentas.find((c) => c.email === "marta@tienda.mx")).toMatchObject({ role: "gerente", status: "invited" });
    expect(estado.correos.map((c) => c.role)).toEqual(["cajera", "gerente"]);
  });

  it("sin correo configurado lo dice, y no crea la cuenta", async () => {
    estado.correoDisponible = false;
    const r = await invitar({ email: "otra@tienda.mx", role: "cajera" });
    expect([r.status, await r.json()]).toEqual([503, { error: "email_unavailable" }]);
    expect(estado.cuentas).toEqual([]);
  });
});
