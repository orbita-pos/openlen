// @vitest-environment node
//
// EL SUSTITUTO TIENE QUE CONTESTAR COMO LA RUTA, CASO POR CASO.
//
// 🔴 POR QUÉ EXISTE. En la medición no hay base de datos, así que a `/api/d` le
// contesta un sustituto (`sustituto.ts`). Eso es una SEGUNDA VERDAD, y es
// exactamente lo que Claude Code NO hace: allí las herramientas tocan la
// máquina de verdad y el error vuelve tal cual, sin copia que mantener. Aquí,
// si el sustituto se separa de la ruta pública, Len aprende a contentar a la
// copia: la medición sale en verde, el turno se cierra, y el carrito del dueño
// sigue roto en el sitio. Es el fallo mudo que costó el 0/5 del 2026-09-18 con
// otro disfraz.
//
// Hasta hoy separarse no costaba nada: los dos ficheros compilan, las pruebas
// de al lado siguen verdes y nadie se entera hasta producción. Esto pone el
// precio donde tiene que estar — una prueba roja el mismo día.
//
// QUÉ COMPARA: el par (status, error) de las dos, sobre la misma tabla. Y
// contra un `esperado` escrito a mano, para que moverlas LAS DOS a la vez
// tampoco cuele.
//
// QUÉ NO: los cuerpos con éxito —ids y fechas son distintos por definición—, el
// límite por IP y minuto, y el plan del dueño, que el sustituto ya declara que
// no imita (aquí las dos miden con el gratuito, que es lo que él asume).
//
// La base de datos de la ruta se cambia por una en memoria, y SÓLO eso:
// `permite`, `cabe` y `validaDocumento` corren de verdad en los dos lados, que
// es donde viven las decisiones que se pueden separar.
import { describe, expect, it, vi } from "vitest";

import { BYTES_POR_PLAN, bytesDe, MAX_BYTES_DOCUMENTO } from "@/lib/page-data/cuota";
import { leerDeclaracion } from "@/lib/page-data/declaracion";
import { crearSustituto, type Sustituto } from "@/lib/page-data/sustituto";

process.env.OPENLEN_INTERNAL_SECRET ||= "secreto-de-prueba";

/** El subdominio con el que se publica la página de las pruebas. */
const PAGINA = "tienda";

// ─── La base de datos de la ruta, en memoria ────────────────────────────────
// No imita decisiones: guarda filas. Todo lo que se puede separar —permisos,
// cuota, validación, procedencia— lo siguen decidiendo los módulos de verdad.
const estado = vi.hoisted(() => ({
  declaracion: {} as Record<string, unknown>,
  filas: [] as {
    id: string;
    store: string;
    visitorId: string | null;
    doc: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }[],
  n: 0,
}));

vi.mock("@/lib/projects", () => ({
  getSubdomainOwner: async () => ({ userId: "u1", projectId: "p1" }),
}));

vi.mock("@/lib/page-data/publicada", () => ({
  declaracionPublicada: async () => estado.declaracion,
}));

vi.mock("@/lib/limits", () => ({
  checkAndConsume: async () => ({ ok: true }),
  getClientIp: () => "10.0.0.1",
  ipLimitKey: (ip: string, que: string) => `${que}:${ip}`,
}));

vi.mock("@/lib/db", () => {
  const cadena: Record<string, unknown> = {};
  cadena.from = () => cadena;
  cadena.where = () => cadena;
  cadena.limit = async () => [{ plan: "free" }];
  return {
    db: { select: () => cadena },
    schema: { users: { id: "id", plan: "plan" } },
  };
});

vi.mock("@/lib/page-data/store", async () => {
  const cuota = await vi.importActual<typeof import("@/lib/page-data/cuota")>(
    "@/lib/page-data/cuota",
  );
  const suyas = (store: string, alcance: string, visitorId: string | null) =>
    estado.filas.filter(
      (f) => f.store === store && (alcance === "todos" || f.visitorId === visitorId),
    );
  return {
    MAX_FILAS_VISITANTE: cuota.MAX_FILAS_VISITANTE,
    listar: async (a: {
      store: string;
      alcance: string;
      visitorId: string | null;
      limite?: number;
    }) => {
      if (a.alcance === "ninguno") return [];
      const filas = suyas(a.store, a.alcance, a.visitorId);
      // Mismo orden que `store.ts`: con tope, las más nuevas primero.
      return (a.limite ? [...filas].reverse().slice(0, a.limite) : filas).map((f) => ({
        id: f.id,
        doc: f.doc,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      }));
    },
    bytesUsados: async () => estado.filas.reduce((n, f) => n + cuota.bytesDe(f.doc), 0),
    escribir: async (a: {
      store: string;
      visitorId: string | null;
      doc: Record<string, unknown>;
      reemplazaId?: string;
    }) => {
      const ahora = new Date().toISOString();
      const previa = a.reemplazaId ? estado.filas.find((f) => f.id === a.reemplazaId) : undefined;
      if (previa) {
        previa.doc = a.doc;
        previa.updatedAt = ahora;
        return { id: previa.id, doc: previa.doc, createdAt: previa.createdAt, updatedAt: ahora };
      }
      const fila = {
        id: `f${++estado.n}`,
        store: a.store,
        visitorId: a.visitorId,
        doc: a.doc,
        createdAt: ahora,
        updatedAt: ahora,
      };
      estado.filas.push(fila);
      return { id: fila.id, doc: fila.doc, createdAt: ahora, updatedAt: ahora };
    },
    borrar: async (a: { store: string; id: string; alcance: string; visitorId: string | null }) => {
      const alcanzables = suyas(a.store, a.alcance, a.visitorId);
      const i = estado.filas.findIndex((f) => f.id === a.id && alcanzables.includes(f));
      if (i < 0) return false;
      estado.filas.splice(i, 1);
      return true;
    },
  };
});

// El import de la ruta va DESPUÉS de los mocks a propósito: `vi.mock` se iza,
// pero el orden deja escrito qué depende de qué.
import { DELETE, GET, POST } from "@/app/api/d/[sub]/[store]/route";

// ─── La tabla ───────────────────────────────────────────────────────────────

interface Peticion {
  readonly metodo: "GET" | "POST" | "DELETE";
  /** El tramo del subdominio que ESCRIBE la página. Ausente = el suyo. */
  readonly sub?: string;
  readonly almacen: string;
  readonly cuerpo?: string;
  readonly query?: string;
}

interface Respuesta {
  readonly status: number;
  readonly error?: string;
}

interface Caso {
  readonly nombre: string;
  readonly html: string;
  /** Llamadas que preparan el terreno. Corren en los DOS lados. */
  readonly preludio?: readonly Peticion[];
  readonly peticion: Peticion;
  readonly esperado: Respuesta;
}

const pagina = (stores: Record<string, unknown>) =>
  `<!doctype html><html><body><script type="application/json" data-ol-stores>${JSON.stringify(
    stores,
  )}</script><h1>Tienda</h1></body></html>`;

const CARRITO = pagina({
  carrito: { visitante: "propio", campos: { lista: "lista", total: "numero" } },
});
const RESENAS = pagina({ resenas: { visitante: "publico", campos: { texto: "texto" } } });
const BUZON = pagina({ buzon: { visitante: "añadir", campos: { correo: "texto" } } });
const MENU = pagina({ menu: { visitante: "lectura", campos: { plato: "texto" } } });

const doc = (d: Record<string, unknown>) => JSON.stringify(d);
/** Un documento que pasa del tope por documento. */
const GORDO = doc({ lista: ["x".repeat(MAX_BYTES_DOCUMENTO)] });

const CASOS: readonly Caso[] = [
  {
    nombre: "un almacén que la página no declaró",
    html: CARRITO,
    peticion: { metodo: "POST", almacen: "pedidos", cuerpo: doc({ total: 1 }) },
    esperado: { status: 404, error: "almacen_no_declarado" },
  },
  {
    nombre: "el subdominio escrito a mano no es el de esta página",
    html: CARRITO,
    peticion: { metodo: "POST", sub: "otra", almacen: "carrito", cuerpo: doc({ total: 1 }) },
    esperado: { status: 403, error: "origen_invalido" },
  },
  {
    nombre: "leer un almacén `añadir` no lo permite el modo",
    html: BUZON,
    peticion: { metodo: "GET", almacen: "buzon" },
    esperado: { status: 403, error: "no_permitido" },
  },
  {
    nombre: "escribir en un almacén `lectura` no lo permite el modo",
    html: MENU,
    peticion: { metodo: "POST", almacen: "menu", cuerpo: doc({ plato: "sopa" }) },
    esperado: { status: 403, error: "no_permitido" },
  },
  {
    nombre: "borrar en `publico` no lo permite el modo, aunque escribir sí",
    html: RESENAS,
    peticion: { metodo: "DELETE", almacen: "resenas", query: "?id=f1" },
    esperado: { status: 403, error: "no_permitido" },
  },
  {
    nombre: "un cuerpo que no es JSON",
    html: CARRITO,
    peticion: { metodo: "POST", almacen: "carrito", cuerpo: "esto no es json" },
    esperado: { status: 422, error: "documento_invalido" },
  },
  {
    nombre: "un cuerpo que es JSON pero no un objeto",
    html: CARRITO,
    peticion: { metodo: "POST", almacen: "carrito", cuerpo: "[1,2,3]" },
    esperado: { status: 422, error: "documento_invalido" },
  },
  {
    nombre: "un campo declarado con el tipo equivocado",
    html: CARRITO,
    peticion: { metodo: "POST", almacen: "carrito", cuerpo: doc({ total: "doce" }) },
    esperado: { status: 422, error: "campo_invalido:total" },
  },
  {
    nombre: "un documento que pasa del tope por documento",
    html: CARRITO,
    peticion: { metodo: "POST", almacen: "carrito", cuerpo: GORDO },
    esperado: { status: 413, error: "documento_grande" },
  },
  {
    nombre: "borrar sin decir cuál",
    html: CARRITO,
    peticion: { metodo: "DELETE", almacen: "carrito" },
    esperado: { status: 422, error: "falta_id" },
  },
  {
    nombre: "el carrito de siempre: guardar, y volver a guardar sobre lo suyo",
    html: CARRITO,
    preludio: [{ metodo: "POST", almacen: "carrito", cuerpo: doc({ lista: ["a"], total: 1 }) }],
    peticion: { metodo: "POST", almacen: "carrito", cuerpo: doc({ lista: ["a", "b"], total: 2 }) },
    esperado: { status: 200 },
  },
  {
    nombre: "leer lo que aún no existe",
    html: MENU,
    peticion: { metodo: "GET", almacen: "menu" },
    esperado: { status: 200 },
  },
];

// La cuota llena va aparte porque necesita LLENARLA: el preludio se calcula del
// tope del plan gratuito, no se escribe a mano. Es el caso que más fácil se
// separa —413 y 507 son dos cosas distintas para quien escribe el JS— y el que
// nadie probaría a mano.
const RESENA = { texto: "r".repeat(8 * 1024) };
const CUOTA_LLENA: Caso = {
  nombre: "el proyecto lleno da 507, que no es lo mismo que un documento grande",
  html: RESENAS,
  preludio: Array.from(
    { length: Math.ceil(BYTES_POR_PLAN.free / bytesDe(RESENA)) },
    () => ({ metodo: "POST" as const, almacen: "resenas", cuerpo: doc(RESENA) }),
  ),
  peticion: { metodo: "POST", almacen: "resenas", cuerpo: doc(RESENA) },
  esperado: { status: 507, error: "cuota_llena" },
};

// ─── Los dos lados ──────────────────────────────────────────────────────────

async function porLaRuta(caso: Caso): Promise<Respuesta> {
  estado.declaracion = leerDeclaracion(caso.html) as unknown as Record<string, unknown>;
  estado.filas = [];
  estado.n = 0;
  // La cookie del visitante vuelve a la siguiente llamada: sin ella la segunda
  // sería OTRO visitante, y en `propio` no reemplazaría nada.
  const galleta: { valor?: string } = {};
  for (const p of caso.preludio ?? []) await unaLlamada(p, galleta);
  return unaLlamada(caso.peticion, galleta);
}

async function unaLlamada(p: Peticion, galleta: { valor?: string }): Promise<Respuesta> {
  const sub = p.sub ?? PAGINA;
  const cabeceras: Record<string, string> = { host: `${PAGINA}.openlen.app` };
  if (galleta.valor) cabeceras.cookie = galleta.valor;
  const req = new Request(
    `https://${PAGINA}.openlen.app/api/d/${sub}/${p.almacen}${p.query ?? ""}`,
    {
      method: p.metodo,
      headers: cabeceras,
      ...(p.cuerpo !== undefined ? { body: p.cuerpo } : {}),
    },
  );
  const ctx = { params: Promise.resolve({ sub, store: p.almacen }) };
  const r =
    p.metodo === "GET"
      ? await GET(req, ctx)
      : p.metodo === "DELETE"
        ? await DELETE(req, ctx)
        : await POST(req, ctx);
  const puesta = r.headers.get("set-cookie");
  if (puesta) galleta.valor = puesta.split(";")[0];
  return leerRespuesta(r.status, await r.json().catch(() => ({})));
}

function porElSustituto(caso: Caso, envolver: (s: Sustituto) => Sustituto = (s) => s): Respuesta {
  const sustituto = envolver(crearSustituto(caso.html, { sub: PAGINA }));
  for (const p of caso.preludio ?? []) responder(sustituto, p);
  return responder(sustituto, caso.peticion);
}

function responder(sustituto: Sustituto, p: Peticion): Respuesta {
  const r = sustituto.responder({
    metodo: p.metodo,
    url: `/api/d/${p.sub ?? PAGINA}/${p.almacen}${p.query ?? ""}`,
    cuerpo: p.cuerpo ?? "",
  });
  return leerRespuesta(r.status, r.cuerpo);
}

function leerRespuesta(status: number, cuerpo: unknown): Respuesta {
  const error = (cuerpo as { error?: unknown } | null)?.error;
  return { status, ...(typeof error === "string" ? { error } : {}) };
}

// ─── La prueba ──────────────────────────────────────────────────────────────

describe("el sustituto de la medición contesta como la ruta pública", () => {
  for (const caso of [...CASOS, CUOTA_LLENA]) {
    it(caso.nombre, async () => {
      const ruta = await porLaRuta(caso);
      const sustituto = porElSustituto(caso);
      expect({ ruta, sustituto }).toEqual({ ruta: caso.esperado, sustituto: caso.esperado });
    });
  }

  // CONTRA-PRUEBA: sin esto, la tabla de arriba podría estar comparando dos
  // cosas que nunca se miran y pasaría igual de verde. Aquí se tuerce el
  // sustituto a propósito —un 403 contestado como 404, que es justo la clase de
  // deriva que esto vigila— y la comparación TIENE que romperse.
  it("CONTRA-PRUEBA: un sustituto torcido rompe la tabla", () => {
    const torcer = (s: Sustituto): Sustituto => ({
      ...s,
      responder: (p) => {
        const r = s.responder(p);
        return r.status === 403 ? { status: 404, cuerpo: r.cuerpo } : r;
      },
    });
    const losDe403 = CASOS.filter((c) => c.esperado.status === 403);
    expect(losDe403.length).toBeGreaterThan(0);
    for (const caso of losDe403) {
      expect(porElSustituto(caso, torcer)).not.toEqual(caso.esperado);
    }
  });
});
