import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { crearSustituto, explicarRechazo } from "./sustituto";

/** Una página con un almacén declarado, como la que escribe Len. */
function pagina(almacenes: Record<string, unknown>): string {
  return `<!doctype html><html><head><title>x</title></head><body>
<script type="application/json" data-ol-stores>${JSON.stringify(almacenes)}</script>
<main>hola</main></body></html>`;
}

const CARRITO_EN_LISTA = pagina({
  carrito: { visitante: "propio", campos: { items: "lista" } },
});

/** La que escribió Len en producción el 2026-09-18 (proyecto «Volcánica»). */
const CARRITO_POR_CAMPOS = pagina({
  carrito: {
    visitante: "propio",
    campos: { producto: "texto", precio: "numero", cantidad: "numero" },
  },
});

function post(url: string, cuerpo: unknown) {
  return { metodo: "POST", url, cuerpo: JSON.stringify(cuerpo) };
}
function get(url: string) {
  return { metodo: "GET", url, cuerpo: "" };
}

describe("el sustituto de /api/d aplica las reglas del servidor real", () => {
  it("en `propio` un POST guarda y un GET devuelve lo del visitante", () => {
    const s = crearSustituto(CARRITO_EN_LISTA, { sub: "volcanica" });
    const escrito = s.responder(post("/api/d/volcanica/carrito", { items: [{ p: "a" }, { p: "b" }] }));
    expect(escrito.status).toBe(200);

    const leido = s.responder(get("/api/d/volcanica/carrito"));
    expect(leido.status).toBe(200);
    const docs = (leido.cuerpo as { documentos: { doc: { items: unknown[] } }[] }).documentos;
    expect(docs).toHaveLength(1);
    expect(docs[0]!.doc.items).toHaveLength(2);
  });

  it("en `propio` cada POST REEMPLAZA el documento del visitante: con campos sueltos sólo queda el último producto", () => {
    const s = crearSustituto(CARRITO_POR_CAMPOS, { sub: "volcanica" });
    s.responder(post("/api/d/volcanica/carrito", { producto: "Chiapas", precio: 180, cantidad: 1 }));
    s.responder(post("/api/d/volcanica/carrito", { producto: "Oaxaca", precio: 200, cantidad: 1 }));

    const docs = s.documentos("carrito");
    expect(docs).toHaveLength(1);
    expect(docs[0]!.doc.producto).toBe("Oaxaca");
  });

  it("un subdominio que no es el de la página se rechaza como en la publicada (403 origen_invalido)", () => {
    const s = crearSustituto(CARRITO_POR_CAMPOS, { sub: "volcanica" });
    const r = s.responder(post("/api/d/carrito/carrito", { producto: "a", precio: 1, cantidad: 1 }));
    expect(r.status).toBe(403);
    expect(r.cuerpo).toEqual({ error: "origen_invalido" });
    expect(s.documentos("carrito")).toHaveLength(0);
  });

  it("en un borrador sin subdominio, CUALQUIER subdominio escrito a mano es incorrecto", () => {
    const s = crearSustituto(CARRITO_POR_CAMPOS, { sub: null });
    const r = s.responder(post("/api/d/carrito/carrito", { producto: "a", precio: 1, cantidad: 1 }));
    expect(r.status).toBe(403);
    expect(r.cuerpo).toEqual({ error: "origen_invalido" });
  });

  it("si quien mide NO SABE el subdominio, no acusa al que escribió la página", () => {
    const s = crearSustituto(CARRITO_EN_LISTA);
    expect(s.responder(post("/api/d/volcanica/carrito", { items: [1] })).status).toBe(200);
  });

  it("un almacén que la página no declara es 404", () => {
    const s = crearSustituto(CARRITO_EN_LISTA, { sub: "volcanica" });
    const r = s.responder(get("/api/d/volcanica/pedidos"));
    expect(r.status).toBe(404);
    expect(r.cuerpo).toEqual({ error: "almacen_no_declarado" });
  });

  it("un campo con el tipo equivocado es 422 y dice cuál", () => {
    const s = crearSustituto(CARRITO_POR_CAMPOS, { sub: "volcanica" });
    const r = s.responder(post("/api/d/volcanica/carrito", { producto: "a", precio: "180" }));
    expect(r.status).toBe(422);
    expect(r.cuerpo).toEqual({ error: "campo_invalido:precio" });
  });

  it("un cuerpo que no es JSON es 422 documento_invalido", () => {
    const s = crearSustituto(CARRITO_EN_LISTA, { sub: "volcanica" });
    const r = s.responder({ metodo: "POST", url: "/api/d/volcanica/carrito", cuerpo: "no-json" });
    expect(r.status).toBe(422);
    expect(r.cuerpo).toEqual({ error: "documento_invalido" });
  });

  it("en `lectura` el visitante lee y no escribe", () => {
    const s = crearSustituto(
      pagina({ menu: { visitante: "lectura", campos: { plato: "texto" } } }),
      { sub: "volcanica" },
    );
    expect(s.responder(post("/api/d/volcanica/menu", { plato: "x" })).status).toBe(403);
    expect(s.responder(get("/api/d/volcanica/menu")).status).toBe(200);
  });

  it("DELETE sin id es 422; con el id del visitante borra", () => {
    const s = crearSustituto(CARRITO_EN_LISTA, { sub: "volcanica" });
    s.responder(post("/api/d/volcanica/carrito", { items: [1] }));
    const id = s.documentos("carrito")[0]!.id;

    expect(s.responder({ metodo: "DELETE", url: "/api/d/volcanica/carrito", cuerpo: "" }).status).toBe(422);
    expect(
      s.responder({ metodo: "DELETE", url: `/api/d/volcanica/carrito?id=${id}`, cuerpo: "" }).status,
    ).toBe(200);
    expect(s.documentos("carrito")).toHaveLength(0);
  });

  it("apunta cada llamada con su método, ruta, estado y código de error", () => {
    const s = crearSustituto(CARRITO_POR_CAMPOS, { sub: null });
    s.responder(post("/api/d/carrito/carrito", { producto: "a", precio: 1, cantidad: 1 }));
    s.responder(get("/api/d/carrito/carrito?x=1"));
    expect(s.llamadas()).toEqual([
      { metodo: "POST", ruta: "/api/d/carrito/carrito", status: 403, error: "origen_invalido" },
      { metodo: "GET", ruta: "/api/d/carrito/carrito", status: 403, error: "origen_invalido" },
    ]);
  });

  it("/api/d/<almacén>, sin subdominio, es SIEMPRE esta página — también en un borrador", () => {
    const s = crearSustituto(CARRITO_EN_LISTA, { sub: null });
    expect(s.responder(post("/api/d/carrito", { items: [1, 2] })).status).toBe(200);
    expect(s.responder(get("/api/d/carrito")).status).toBe(200);
    expect(s.documentos("carrito")).toHaveLength(1);
  });

  it("una ruta que el servidor real no tiene es 404", () => {
    const s = crearSustituto(CARRITO_EN_LISTA, { sub: "volcanica" });
    const r = s.responder(get("/api/d/volcanica/carrito/extra"));
    expect(r.status).toBe(404);
    expect(s.llamadas()[0]).toMatchObject({ status: 404, error: "ruta_inexistente" });
  });
});

// EL SUSTITUTO Y LA RUTA NO PUEDEN SEPARARSE. Si mañana la ruta cambia una
// regla y el sustituto no, la medición vuelve a mentir —en la otra dirección—.
// Se ata por el texto de los ficheros, como `route-contract.test.ts`.
describe("el sustituto encadena lo mismo que la ruta pública", () => {
  const leer = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
  const ruta = leer("app", "api", "d", "[sub]", "[store]", "route.ts");
  const sustituto = leer("lib", "page-data", "sustituto.ts");

  it.each(["validaDocumento", "permite(", "cabe(", "MAX_FILAS_VISITANTE", 'modo === "propio"'])(
    "los dos usan %s",
    (pieza) => {
      expect(ruta).toContain(pieza);
      expect(sustituto).toContain(pieza);
    },
  );

  it("existen las dos formas que el sustituto acepta", () => {
    expect(existsSync(join(process.cwd(), "app", "api", "d", "[sub]", "route.ts"))).toBe(true);
    expect(existsSync(join(process.cwd(), "app", "api", "d", "[sub]", "[store]", "route.ts"))).toBe(true);
  });
});

describe("explicarRechazo — lo que se le dice al modelo", () => {
  it("el subdominio inventado: por qué, y la forma que sí funciona", () => {
    const frase = explicarRechazo({ metodo: "POST", ruta: "/api/d/carrito/carrito", status: 403, error: "origen_invalido" });
    expect(frase).toContain("`POST /api/d/carrito/carrito`");
    expect(frase).toContain("403 origen_invalido");
    expect(frase).toContain("`/api/d/<almacén>`, sin subdominio");
  });

  it("el campo con el tipo equivocado lo nombra", () => {
    expect(
      explicarRechazo({ metodo: "POST", ruta: "/api/d/carrito", status: 422, error: "campo_invalido:precio" }),
    ).toContain("«precio»");
  });
});
