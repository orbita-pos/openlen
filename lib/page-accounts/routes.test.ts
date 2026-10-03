// @vitest-environment node
//
// Las rutas de cuentas (/api/a/<sub>/*) y lo que cambian en /api/d, de punta a
// punta con la base en memoria. Lo que se sustituye es SÓLO lo que guarda
// filas (`store`) y el bcrypt (por velocidad); la declaración, la sesión, la
// procedencia, el actor y `permite()` corren de verdad.
//
// La caja de una tienda: `ventas` es privado y el cajero lee y crea las suyas;
// `productos` lo lee cualquiera y el cajero puede modificarlo.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { leerDeclaracion } from "@/lib/page-data/declaracion";
import { readAccountsDeclaration } from "@/lib/page-accounts/declaration";
import { newSessionToken } from "@/lib/page-accounts/session";

process.env.OPENLEN_INTERNAL_SECRET ||= "secreto-de-prueba";
process.env.PUBLISH_BASE_HOST = "openlen.app";
process.env.OPENLEN_LEGACY_BASE_HOSTS = "openlen.app";

const PAGINA = `<!doctype html><html><body>
<script type="application/json" data-ol-accounts>{"registro":"cerrado","papeles":["cajero"]}</script>
<script type="application/json" data-ol-stores>{
  "ventas":{"visitante":"privado","papeles":{"cajero":{"leer":"propios","crear":"propios"}},"campos":{"total":"numero"}},
  "productos":{"visitante":"lectura","papeles":{"cajero":["modificar"]},"campos":{"nombre":"texto","existencias":"numero"}}
}</script></body></html>`;

const estado = vi.hoisted(() => ({
  accounts: null as unknown,
  almacenes: {} as Record<string, unknown>,
  cuentas: [] as { id: string; email: string; name: string | null; role: string | null; passwordHash: string; status: string; createdAt: Date; lastLoginAt: Date | null }[],
  sesiones: new Map<string, { projectId: string; memberId: string | null; ownerUserId: string | null }>(),
  filas: [] as { id: string; store: string; visitorId: string | null; doc: Record<string, unknown>; createdAt: string; updatedAt: string }[],
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
  // Dos lectores comparten la cadena: `publishedAccounts` (data) y el plan del
  // dueño en /api/d (plan). Cada uno toma su campo.
  cadena.limit = async () => [{ data: { accounts: estado.accounts }, plan: "free" }];
  return { db: { select: () => cadena }, schema: { users: { id: "id", plan: "plan" }, projects: { id: "id", data: "data" } } };
});

vi.mock("@/lib/page-data/publicada", () => ({
  declaracionPublicada: async () => estado.almacenes,
}));

vi.mock("@/lib/auth/visitor-password", () => ({
  DUMMY_HASH: "h:\u0000",
  hashPassword: async (p: string) => `h:${p}`,
  verifyPassword: async (p: string, h: string) => h === `h:${p}`,
  isValidPassword: (p: unknown) => typeof p === "string" && p.length >= 8 && p.length <= 200,
}));

vi.mock("@/lib/page-accounts/store", () => {
  const publica = (c: (typeof estado.cuentas)[number]) => ({
    id: c.id, email: c.email, name: c.name, role: c.role, createdAt: c.createdAt, lastLoginAt: c.lastLoginAt,
  });
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
    updateAccount: async () => null,
    deleteAccount: async () => false,
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
    deleteAccountSessions: async () => {},
  };
});

vi.mock("@/lib/page-data/store", async () => {
  const cuota = await vi.importActual<typeof import("@/lib/page-data/cuota")>("@/lib/page-data/cuota");
  const suyas = (store: string, alcance: string, visitorId: string | null) =>
    estado.filas.filter((f) => f.store === store && (alcance === "todos" || f.visitorId === visitorId));
  const vista = (f: (typeof estado.filas)[number]) => ({ id: f.id, doc: f.doc, createdAt: f.createdAt, updatedAt: f.updatedAt });
  return {
    MAX_FILAS_VISITANTE: cuota.MAX_FILAS_VISITANTE,
    listar: async (a: { store: string; alcance: string; visitorId: string | null }) =>
      a.alcance === "ninguno" ? [] : suyas(a.store, a.alcance, a.visitorId).map(vista),
    bytesUsados: async () => 0,
    escribir: async (a: { store: string; visitorId: string | null; doc: Record<string, unknown> }) => {
      const ahora = new Date().toISOString();
      const f = { id: `f${++estado.n}`, store: a.store, visitorId: a.visitorId, doc: a.doc, createdAt: ahora, updatedAt: ahora };
      estado.filas.push(f);
      return vista(f);
    },
    borrar: async () => false,
    findOne: async (a: { store: string; id: string; alcance: string; visitorId: string | null }) => {
      const f = a.alcance === "ninguno" ? undefined : suyas(a.store, a.alcance, a.visitorId).find((x) => x.id === a.id);
      return f ? vista(f) : null;
    },
    updateOne: async (a: { store: string; id: string; alcance: string; visitorId: string | null; doc: Record<string, unknown> }) => {
      const f = suyas(a.store, a.alcance, a.visitorId).find((x) => x.id === a.id);
      if (!f) return null;
      f.doc = a.doc;
      return vista(f);
    },
  };
});

import { POST as login } from "@/app/api/a/login/route";
import { GET as me } from "@/app/api/a/me/route";
import { POST as crearCuenta } from "@/app/api/a/accounts/route";
import { GET as leerDatos, PATCH as modificarDato, POST as escribirDato } from "@/app/api/d/[sub]/[store]/route";

const DE_AQUI = "https://tienda.openlen.app";
const HERMANA = "https://malo.openlen.app";

function pide(
  url: string,
  { method = "GET", origin, cookie, body }: { method?: string; origin?: string; cookie?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = { host: "tienda.openlen.app" };
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  return new Request(`${DE_AQUI}${url}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
const almacen = (store: string) => ({ params: Promise.resolve({ sub: "tienda", store }) });
const galleta = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0];

async function entraMarta(): Promise<string> {
  const r = await login(pide("/api/a/login", { method: "POST", origin: DE_AQUI, body: { email: "marta@tienda.mx", password: "contraseña-larga" } }));
  expect(r.status).toBe(200);
  return galleta(r);
}
function sesionDelDueno(): string {
  const { raw } = newSessionToken();
  estado.sesiones.set(raw, { projectId: "p1", memberId: null, ownerUserId: "u-dueno" });
  return `__Host-ol_s=${raw}`;
}

beforeEach(() => {
  estado.accounts = readAccountsDeclaration(PAGINA);
  estado.almacenes = leerDeclaracion(PAGINA) as unknown as Record<string, unknown>;
  estado.cuentas = [
    { id: "m-marta", email: "marta@tienda.mx", name: "Marta", role: "cajero", passwordHash: "h:contraseña-larga", status: "active", createdAt: new Date(), lastLoginAt: null },
  ];
  estado.sesiones.clear();
  estado.filas = [];
  estado.n = 0;
});

describe("entrar", () => {
  it("con su correo y contraseña: cookie __Host- y su papel", async () => {
    const r = await login(pide("/api/a/login", { method: "POST", origin: DE_AQUI, body: { email: " Marta@Tienda.mx", password: "contraseña-larga" } }));
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/^__Host-ol_s=[A-Za-z0-9_-]{43}; Path=\/;.*HttpOnly; Secure; SameSite=Lax$/);
    expect(await r.json()).toMatchObject({ account: { email: "marta@tienda.mx", role: "cajero" }, owner: false });
  });

  it("contraseña mala y correo que no existe dan el MISMO error", async () => {
    const mala = await login(pide("/api/a/login", { method: "POST", origin: DE_AQUI, body: { email: "marta@tienda.mx", password: "otra-cosa-larga" } }));
    const nadie = await login(pide("/api/a/login", { method: "POST", origin: DE_AQUI, body: { email: "nadie@tienda.mx", password: "contraseña-larga" } }));
    expect([mala.status, await mala.json()]).toEqual([401, { error: "invalid_credentials" }]);
    expect([nadie.status, await nadie.json()]).toEqual([401, { error: "invalid_credentials" }]);
  });

  // 🔴 El ataque del subdominio hermano: para el navegador es el mismo sitio.
  it("desde una página hermana, o sin Origin, no", async () => {
    for (const origin of [HERMANA, undefined]) {
      const r = await login(pide("/api/a/login", { method: "POST", origin, body: { email: "marta@tienda.mx", password: "contraseña-larga" } }));
      expect(r.status).toBe(403);
    }
  });

  it("en una página sin data-ol-accounts no hay a dónde entrar", async () => {
    estado.accounts = null;
    const r = await login(pide("/api/a/login", { method: "POST", origin: DE_AQUI, body: { email: "marta@tienda.mx", password: "contraseña-larga" } }));
    expect([r.status, await r.json()]).toEqual([404, { error: "accounts_not_declared" }]);
  });
});

describe("dónde", () => {
  // Sin subdominio en la ruta: el sitio sale del Host. En la app, o en un host
  // que no conocemos, no hay página de la que ser cuenta.
  it("fuera de una página publicada, 404", async () => {
    const r = await me(new Request("https://openlen.com/api/a/me", { headers: { host: "openlen.com" } }));
    expect([r.status, await r.json()]).toEqual([404, { error: "not_a_page" }]);
  });
});

describe("quién soy", () => {
  it("sin sesión, nadie; con la de Marta, Marta; con la del dueño, el dueño", async () => {
    expect(await (await me(pide("/api/a/me"))).json()).toEqual({ account: null, owner: false });
    const marta = await entraMarta();
    expect(await (await me(pide("/api/a/me", { cookie: marta }))).json()).toMatchObject({ account: { role: "cajero" }, owner: false });
    expect(await (await me(pide("/api/a/me", { cookie: sesionDelDueno() }))).json()).toEqual({ account: null, owner: true });
  });

  // 🔴 Quitar el bloque de la página tiene que bastar para cerrar las sesiones.
  it("si la página publicada ya no declara cuentas, la cookie no vale", async () => {
    const marta = await entraMarta();
    estado.accounts = null;
    expect((await me(pide("/api/a/me", { cookie: marta }))).status).toBe(404);
  });
});

describe("las cuentas, sólo el dueño", () => {
  it("el dueño crea una cajera; un papel que la página no declara se rechaza", async () => {
    const dueno = sesionDelDueno();
    const ok = await crearCuenta(pide("/api/a/accounts", { method: "POST", origin: DE_AQUI, cookie: dueno, body: { email: "luis@tienda.mx", password: "provisional-1", role: "cajero" } }));
    expect(ok.status).toBe(201);
    const raro = await crearCuenta(pide("/api/a/accounts", { method: "POST", origin: DE_AQUI, cookie: dueno, body: { email: "ana@tienda.mx", password: "provisional-1", role: "gerente" } }));
    expect([raro.status, (await raro.json()).error]).toEqual([422, "unknown_role"]);
  });

  // 🔴 BRAZO DE CONTROL: una cajera no puede dar de alta a nadie.
  it("una cajera no puede crear cuentas", async () => {
    const marta = await entraMarta();
    const r = await crearCuenta(pide("/api/a/accounts", { method: "POST", origin: DE_AQUI, cookie: marta, body: { email: "x@tienda.mx", password: "provisional-1" } }));
    expect(r.status).toBe(403);
  });
});

describe("/api/d con la caja", () => {
  it("el visitante anónimo no ve las ventas; la cajera sí, las suyas", async () => {
    expect((await leerDatos(pide("/api/d/tienda/ventas"), almacen("ventas"))).status).toBe(403);

    const marta = await entraMarta();
    const venta = await escribirDato(pide("/api/d/tienda/ventas", { method: "POST", origin: DE_AQUI, cookie: marta, body: { total: 120 } }), almacen("ventas"));
    expect(venta.status).toBe(200);
    expect(estado.filas[0]!.visitorId).toBe("cuenta:m-marta");

    const lee = await leerDatos(pide("/api/d/tienda/ventas", { cookie: marta }), almacen("ventas"));
    expect((await lee.json()).documentos).toHaveLength(1);
  });

  it("el dueño ve las ventas de todas las cajeras", async () => {
    estado.filas.push(
      { id: "v1", store: "ventas", visitorId: "cuenta:m-marta", doc: { total: 1 }, createdAt: "", updatedAt: "" },
      { id: "v2", store: "ventas", visitorId: "cuenta:m-luis", doc: { total: 2 }, createdAt: "", updatedAt: "" },
    );
    const r = await leerDatos(pide("/api/d/tienda/ventas", { cookie: sesionDelDueno() }), almacen("ventas"));
    expect((await r.json()).documentos).toHaveLength(2);
  });

  // 🔴 Con la cookie de la caja puesta, una página hermana manda el POST: la
  // sesión se IGNORA y quien escribe es un visitante, que en `privado` no puede.
  it("un POST desde una página hermana no usa la sesión de la cajera", async () => {
    const marta = await entraMarta();
    const r = await escribirDato(pide("/api/d/tienda/ventas", { method: "POST", origin: HERMANA, cookie: marta, body: { total: 1 } }), almacen("ventas"));
    expect(r.status).toBe(403);
    expect(estado.filas).toHaveLength(0);
  });

  // Lo que la comprobación de siempre deja pasar —no sabe de dónde viene— y
  // la estricta no: un `Origin: null` (un iframe aislado, un data:) o ninguno.
  // Con la cookie puesta, eso tampoco puede escribir como la cajera.
  it("un POST con Origin null o sin Origin no usa la sesión de la cajera", async () => {
    const marta = await entraMarta();
    for (const origin of ["null", undefined]) {
      const r = await escribirDato(pide("/api/d/tienda/ventas", { method: "POST", origin, cookie: marta, body: { total: 1 } }), almacen("ventas"));
      expect(r.status).toBe(403);
    }
    expect(estado.filas).toHaveLength(0);
  });

  it("sin data-ol-accounts publicado, la sesión de la cajera no abre las ventas", async () => {
    const marta = await entraMarta();
    estado.accounts = null;
    expect((await leerDatos(pide("/api/d/tienda/ventas", { cookie: marta }), almacen("ventas"))).status).toBe(403);
  });

  it("la cajera descuenta existencias de un producto por su id; el visitante no", async () => {
    estado.filas.push({ id: "p-cafe", store: "productos", visitorId: null, doc: { nombre: "Café", existencias: 5 }, createdAt: "", updatedAt: "" });
    const anonimo = await modificarDato(pide("/api/d/tienda/productos?id=p-cafe", { method: "PATCH", origin: DE_AQUI, body: { existencias: 4 } }), almacen("productos"));
    expect(anonimo.status).toBe(403);

    const marta = await entraMarta();
    const r = await modificarDato(pide("/api/d/tienda/productos?id=p-cafe", { method: "PATCH", origin: DE_AQUI, cookie: marta, body: { existencias: 4 } }), almacen("productos"));
    expect(r.status).toBe(200);
    // Mezcla, no reemplaza: el nombre sigue ahí.
    expect(estado.filas[0]!.doc).toEqual({ nombre: "Café", existencias: 4 });
  });
});
