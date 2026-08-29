// El bloque que el modelo escribe en la página para declarar sus almacenes.
//
// PURO A PROPÓSITO: sin DB, sin Next, sin red. Aquí vive la mitad de la
// seguridad del sistema —qué forma tiene un documento y quién puede tocarlo— y
// eso tiene que poder probarse sin levantar nada.
//
// La regla que gobierna todo el fichero: ante cualquier duda, MENOS permiso.
// Un modo que no reconocemos descarta el almacén entero; no se degrada al más
// abierto. Degradar convertiría una errata del modelo en una puerta abierta.

export type ModoVisitante = "propio" | "lectura" | "añadir";
export type TipoCampo = "texto" | "numero" | "booleano" | "fecha" | "lista";

export interface AlmacenDeclarado {
  readonly modo: ModoVisitante;
  /** `null` = no caduca. Sólo los almacenes de `lectura` pueden serlo. */
  readonly caducaDias: number | null;
  readonly campos: Readonly<Record<string, TipoCampo>>;
}

export type Declaracion = Readonly<Record<string, AlmacenDeclarado>>;

const MODOS = new Set<ModoVisitante>(["propio", "lectura", "añadir"]);
const TIPOS = new Set<TipoCampo>(["texto", "numero", "booleano", "fecha", "lista"]);

/** Por defecto donde escribe el visitante. */
const CADUCIDAD_DEFECTO = 90;
/** Tope duro: dos años. Más que eso no es una caducidad, es un archivo. */
const CADUCIDAD_MAX = 730;

/** Nombre de almacén: la misma forma que aceptamos como slug de página. */
const NOMBRE_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const BLOQUE_RE = /<script\b[^>]*\bdata-ol-stores\b[^>]*>([\s\S]*?)<\/script>/i;

function caducidad(crudo: unknown, modo: ModoVisitante): number | null {
  if (typeof crudo === "string") {
    const m = /^(\d{1,5})d$/.exec(crudo.trim());
    if (m) return Math.min(Number(m[1]), CADUCIDAD_MAX);
  }
  // Sin declarar: el visitante caduca, el dueño no. Borrar el menú de alguien
  // por antigüedad sería absurdo; guardar carritos para siempre, también.
  return modo === "lectura" ? null : CADUCIDAD_DEFECTO;
}

/** La declaración de la página, o `{}` si no hay, está rota, o no es un objeto.
 *  NUNCA lanza: esto corre sobre HTML que escribió un modelo. */
export function leerDeclaracion(html: string): Declaracion {
  const m = BLOQUE_RE.exec(html);
  if (!m) return {};

  let crudo: unknown;
  try {
    crudo = JSON.parse(m[1]);
  } catch {
    return {};
  }
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return {};

  const salida: Record<string, AlmacenDeclarado> = {};
  for (const [nombre, valor] of Object.entries(crudo as Record<string, unknown>)) {
    if (!NOMBRE_RE.test(nombre)) continue;
    if (!valor || typeof valor !== "object" || Array.isArray(valor)) continue;

    const v = valor as Record<string, unknown>;
    const modo = v.visitante;
    if (typeof modo !== "string" || !MODOS.has(modo as ModoVisitante)) continue;

    const campos: Record<string, TipoCampo> = {};
    const declarados = v.campos;
    if (declarados && typeof declarados === "object" && !Array.isArray(declarados)) {
      for (const [campo, tipo] of Object.entries(declarados as Record<string, unknown>)) {
        if (typeof tipo === "string" && TIPOS.has(tipo as TipoCampo)) {
          campos[campo] = tipo as TipoCampo;
        }
      }
    }

    salida[nombre] = {
      modo: modo as ModoVisitante,
      caducaDias: caducidad(v.caduca, modo as ModoVisitante),
      campos,
    };
  }
  return salida;
}

function cuadra(tipo: TipoCampo, valor: unknown): boolean {
  switch (tipo) {
    case "texto":
      return typeof valor === "string";
    case "numero":
      return typeof valor === "number" && Number.isFinite(valor);
    case "booleano":
      return typeof valor === "boolean";
    case "fecha":
      return typeof valor === "string" && !Number.isNaN(Date.parse(valor));
    case "lista":
      return Array.isArray(valor);
  }
}

export type Validacion =
  | { ok: true; doc: Record<string, unknown> }
  | { ok: false; razon: string };

/** Valida contra la forma declarada.
 *
 *  DOS REGLAS DISTINTAS a propósito:
 *   · un campo declarado con el tipo equivocado RECHAZA — es un error de quien
 *     escribe y hay que decírselo;
 *   · un campo NO declarado se DESCARTA en silencio — es una errata del modelo,
 *     y tirar la escritura del visitante por eso le rompe la página a alguien
 *     que no tiene culpa ni forma de arreglarlo. */
export function validaDocumento(almacen: AlmacenDeclarado, doc: unknown): Validacion {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, razon: "documento_invalido" };
  }
  const limpio: Record<string, unknown> = {};
  for (const [campo, valor] of Object.entries(doc as Record<string, unknown>)) {
    const tipo = almacen.campos[campo];
    if (!tipo) continue;
    if (!cuadra(tipo, valor)) return { ok: false, razon: `campo_invalido:${campo}` };
    limpio[campo] = valor;
  }
  return { ok: true, doc: limpio };
}
