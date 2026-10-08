import { beforeEach, describe, expect, it } from "vitest";
import {
  CADUCIDAD_MS,
  TOPE_GLOBAL_BYTES,
  TOPE_POR_USUARIO,
  guardarDocumento,
  leerDocumento,
  proyectoDeEtiqueta,
  vaciarAlmacenParaPruebas,
} from "./almacen";
import { etiquetaDeLienzo } from "./host";

const base = { html: "<p>hola</p>", projectId: "p1", userId: "u1", pagina: null };

beforeEach(() => vaciarAlmacenParaPruebas());

describe("el almacén del lienzo", () => {
  it("devuelve lo guardado por su id, y el id no se adivina", () => {
    const id = guardarDocumento(base, 1_000);
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(leerDocumento(id, 1_000)?.html).toBe("<p>hola</p>");
    expect(leerDocumento("otro", 1_000)).toBeNull();
  });

  it("caduca a los 30 min SIN USO, y leer renueva", () => {
    const id = guardarDocumento(base, 0);
    expect(leerDocumento(id, CADUCIDAD_MS - 1)).not.toBeNull();
    expect(leerDocumento(id, 2 * CADUCIDAD_MS - 2)).not.toBeNull();
    expect(leerDocumento(id, 3 * CADUCIDAD_MS)).toBeNull();
  });

  it("al pasar el tope tira el menos usado DEL MISMO usuario", () => {
    const primero = guardarDocumento(base, 0);
    const ajeno = guardarDocumento({ ...base, userId: "u2" }, 0);
    const segundo = guardarDocumento(base, 1);
    for (let i = 2; i < TOPE_POR_USUARIO; i++) guardarDocumento(base, i);
    // LEER RENUEVA, y por eso este caso se escribe así: al tocar `primero`
    // pasa a ser el más RECIENTE, y el menos usado pasa a ser `segundo`. La
    // primera versión de esta prueba leía `primero` y luego esperaba que fuera
    // él quien se cayera, que es justo lo contrario de lo que significa
    // «menos usado».
    expect(leerDocumento(primero, TOPE_POR_USUARIO)).not.toBeNull();
    guardarDocumento(base, TOPE_POR_USUARIO + 1);
    expect(leerDocumento(segundo, TOPE_POR_USUARIO + 2)).toBeNull();
    expect(leerDocumento(primero, TOPE_POR_USUARIO + 2)).not.toBeNull();
    expect(leerDocumento(ajeno, TOPE_POR_USUARIO + 2)).not.toBeNull();
  });
});

// EL TECHO GLOBAL (H5). `TOPE_POR_USUARIO` acota a UN usuario y no la suma:
// 20 x 8 MB son 184 MB de RSS medidos, y dieciocho sesiones asi se comen el
// `MemoryMax=3400M` entero y el kernel mata la unidad. Esto es la red.
describe("el techo global de bytes", () => {
  // ~1 MB por documento, con contenido distinto por si algun dia se deduplica.
  const gordo = (i: number) => "x".repeat(512 * 1024 - 8) + String(i).padStart(8, "0");

  it("🔴 desaloja por uso mas antiguo hasta caber, y NO mira de quien es", () => {
    const cabenJustos = Math.floor(TOPE_GLOBAL_BYTES / (512 * 1024 * 2));
    const ids: string[] = [];
    // Repartidos entre muchos usuarios: ninguno llega a TOPE_POR_USUARIO, asi
    // que lo unico que puede desalojar aqui es el techo global.
    for (let i = 0; i < cabenJustos + 4; i++) {
      ids.push(guardarDocumento({ ...base, html: gordo(i), userId: `u${i % 50}` }, 1_000 + i));
    }
    const ahora = 2_000 + cabenJustos;
    const vivos = ids.filter((id) => leerDocumento(id, ahora) !== null);
    expect(vivos.length).toBeLessThan(ids.length);
    // Los que caen son los PRIMEROS (uso mas antiguo) y el ultimo sigue vivo:
    // el que acaba de llegar es el mas reciente y es el ultimo en caerse.
    expect(leerDocumento(ids[0]!, ahora)).toBeNull();
    expect(leerDocumento(ids[ids.length - 1]!, ahora)).not.toBeNull();
  });

  it("BRAZO DE CONTROL: el uso normal no lo toca JAMAS", () => {
    // 20 documentos de 30 KB —la mediana real de 231 plantillas— son ~1 MB.
    // Si esta prueba se pusiera roja, el techo estaria desalojando a gente
    // normal y seria una averia, no una red.
    const normal = "y".repeat(30 * 1024);
    const ids: string[] = [];
    for (let i = 0; i < TOPE_POR_USUARIO; i++) {
      ids.push(guardarDocumento({ ...base, html: normal, userId: "normal" }, 1_000 + i));
    }
    for (const id of ids) expect(leerDocumento(id, 2_000)).not.toBeNull();
  });

  it("el techo esta en una fraccion del cgroup, no pegado a el", () => {
    // 256 MB sobre los 3400M del MemoryMax, compartidos con Next y los
    // Chromium. Si alguien lo sube cerca del presupuesto, esto avisa.
    expect(TOPE_GLOBAL_BYTES).toBeLessThanOrEqual(512 * 1024 * 1024);
    expect(TOPE_GLOBAL_BYTES).toBeGreaterThanOrEqual(64 * 1024 * 1024);
  });
});

// DE QUÉ PROYECTO ES UN HOST LIENZO (pieza 9 de Len 2.5). Los ficheros de la
// carpeta se sirven en el host del lienzo; sólo responden mientras el dueño
// tiene un documento VIVO de ese proyecto.
describe("el proyecto de una etiqueta", () => {
  const env = { AUTH_SECRET: "s3cr3t" };
  const P1 = "4f9c10cb-8781-48f1-b291-c5d146579f09";
  const P2 = "0e0c4d1a-1b2c-4d3e-8f90-a1b2c3d4e5f6";

  it("🔴 con un documento vivo, la etiqueta dice su proyecto y su dueño", () => {
    guardarDocumento({ ...base, projectId: P1 }, 1_000);
    expect(proyectoDeEtiqueta(etiquetaDeLienzo(P1, env)!, 1_000, env)).toEqual({
      projectId: P1,
      userId: "u1",
      app: null,
      entorno: undefined,
    });
  });

  it("una APP: la etiqueta trae su app y su entorno, los del documento MÁS RECIENTE", () => {
    const app = { catalogo: "2026-10", entrada: "/src/main.jsx" };
    guardarDocumento({ ...base, projectId: P1 }, 1_000);
    guardarDocumento({ ...base, projectId: P1, app, entorno: { VITE_SUPABASE_URL: "https://x.openlen.app" } }, 2_000);
    expect(proyectoDeEtiqueta(etiquetaDeLienzo(P1, env)!, 2_000, env)).toEqual({
      projectId: P1,
      userId: "u1",
      app,
      entorno: { VITE_SUPABASE_URL: "https://x.openlen.app" },
    });
  });

  it("🔴 sin documento vivo de ESE proyecto, nada — aunque haya de otro", () => {
    guardarDocumento({ ...base, projectId: P2 }, 1_000);
    expect(proyectoDeEtiqueta(etiquetaDeLienzo(P1, env)!, 1_000, env)).toBeNull();
  });

  it("caducado, nada; y no lo renueva", () => {
    const id = guardarDocumento({ ...base, projectId: P1 }, 0);
    expect(proyectoDeEtiqueta(etiquetaDeLienzo(P1, env)!, CADUCIDAD_MS + 1, env)).toBeNull();
    expect(leerDocumento(id, CADUCIDAD_MS + 1)).toBeNull();
  });

  it("una etiqueta inventada, nada", () => {
    guardarDocumento({ ...base, projectId: P1 }, 1_000);
    expect(proyectoDeEtiqueta(`lienzo-${"0".repeat(32)}`, 1_000, env)).toBeNull();
  });
});
