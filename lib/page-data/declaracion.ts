// El bloque que el modelo escribe en la página para declarar sus almacenes.
//
// PURO A PROPÓSITO: sin DB, sin Next, sin red. Aquí vive la mitad de la
// seguridad del sistema —qué forma tiene un documento y quién puede tocarlo— y
// eso tiene que poder probarse sin levantar nada.
//
// La regla que gobierna todo el fichero: ante cualquier duda, MENOS permiso.
// Un modo que no reconocemos descarta el almacén entero; no se degrada al más
// abierto. Degradar convertiría una errata del modelo en una puerta abierta.

import type { Accion } from "./permisos";

/** `propio`   — cada visitante escribe y lee LO SUYO (un carrito).
 *  `lectura`  — lo mantiene el dueño, el visitante sólo lee (un menú).
 *  `añadir`   — el visitante crea y NO lee lo de otros (un formulario de
 *               inscripción: los datos que deja son suyos y de nadie más).
 *  `publico`  — cualquiera escribe y TODOS leen (reseñas, un muro).
 *
 *  🔴 `publico` NO ES `añadir` CON LA LECTURA ABIERTA, aunque el código se
 *  parezca. Son dos intenciones opuestas y por eso son dos modos y no una
 *  bandera: en `añadir` lo que el visitante escribe es PRIVADO —el comentario
 *  de `permisos.ts` lo dice sin rodeos: abrir su lectura convertiría un
 *  formulario de inscripción en la lista de correos de cualquiera que sepa la
 *  URL—, y en `publico` es público por definición y el dueño lo eligió sabiendo
 *  que se ve.
 *
 *  Existe porque sin él no se podían hacer reseñas, que es el caso que lo pidió
 *  (2026-08-31): el visitante dejaba la suya y NO LA VEÍA ni al recargar, así
 *  que parecía que se perdía. Como en Mercado Libre: se publica al momento y la
 *  ve todo el mundo, sin que el dueño apruebe nada.
 *
 *  `privado`  — el visitante anónimo no alcanza NADA; sólo las cuentas a cuyo
 *               papel el almacén se lo da (`papeles`) y el dueño. Las ventas
 *               de una caja (plans/page-accounts/design.md, 03/10/2026). */
export type ModoVisitante = "propio" | "lectura" | "añadir" | "publico" | "privado";
export type TipoCampo = "texto" | "numero" | "booleano" | "fecha" | "lista";

/** Lo que un almacén le da a cada papel de cuenta: acción → alcance. Una acción
 *  que no aparece no se le da. */
export type RoleGrants = Readonly<
  Record<string, Readonly<Partial<Record<Accion, "todos" | "propios">>>>
>;

export interface AlmacenDeclarado {
  readonly modo: ModoVisitante;
  /** Sólo si la página lo declara: `{"cajero":["leer","crear"]}` (todo con
   *  alcance `todos`) o `{"cajero":{"leer":"propios"}}`. Ausente en todos los
   *  almacenes anteriores al 03/10/2026. */
  readonly papeles?: RoleGrants;
  /** `null` = no caduca. Sólo los almacenes de `lectura` pueden serlo. */
  readonly caducaDias: number | null;
  readonly campos: Readonly<Record<string, TipoCampo>>;
}

export type Declaracion = Readonly<Record<string, AlmacenDeclarado>>;

const MODOS = new Set<ModoVisitante>(["propio", "lectura", "añadir", "publico", "privado"]);
const ACCIONES = new Set<Accion>(["leer", "crear", "modificar", "borrar"]);
const ALCANCES = new Set(["todos", "propios"]);

/** El nombre de un papel: el que use la página («cajero», «socio»), en
 *  minúsculas, con acentos y ñ. `data-ol-accounts` acepta lo mismo
 *  (lib/page-accounts/declaration.ts lo importa de aquí). */
export const ROLE_NAME_RE = /^[\p{Ll}\p{Lo}\p{N}][\p{Ll}\p{Lo}\p{N}_-]{0,31}$/u;
const TIPOS = new Set<TipoCampo>(["texto", "numero", "booleano", "fecha", "lista"]);

/** Por defecto donde escribe el visitante. */
const CADUCIDAD_DEFECTO = 90;
/** Tope duro: dos años. Más que eso no es una caducidad, es un archivo. */
const CADUCIDAD_MAX = 730;

/** Nombre de almacén: la misma forma que aceptamos como slug de página. */
const NOMBRE_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const BLOQUE_RE = /<script\b[^>]*\bdata-ol-stores\b[^>]*>([\s\S]*?)<\/script>/i;

// ⚰️ AQUÍ VIVÍA `DONDE_SE_DECLARA_UN_ALMACEN` («con editar_html,
// op="insert_before" sobre el data-op-id del PRIMER elemento dentro del
// <body>…»), la frase que compartían la receta de `guardar_dato` y el rechazo
// de la cabecera. Len 2.0 dejó de citarla (edita con Edit, sin ids) y el
// rechazo, su último lector, se retiró el 2026-09-25. Lo que se aprendió con
// ella —el bloque va en el <body> y fuera de cualquier sección que se pueda
// borrar— lo dice hoy la sección ALMACENES del prompt de Len.

/** `papeles` de un almacén. `null` = el almacén se DESCARTA entero: un papel o
 *  una acción que no reconocemos es una errata del modelo, y la regla del
 *  fichero es no convertirla en una puerta. `undefined` = no declara ninguno. */
function readRoleGrants(crudo: unknown): RoleGrants | null | undefined {
  if (crudo === undefined) return undefined;
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return null;
  const grants: Record<string, Partial<Record<Accion, "todos" | "propios">>> = {};
  for (const [papel, valor] of Object.entries(crudo as Record<string, unknown>)) {
    if (!ROLE_NAME_RE.test(papel)) return null;
    const grant: Partial<Record<Accion, "todos" | "propios">> = {};
    if (Array.isArray(valor)) {
      // La forma corta: `["leer","crear"]` es todo con alcance `todos`.
      for (const accion of valor) {
        if (typeof accion !== "string" || !ACCIONES.has(accion as Accion)) return null;
        grant[accion as Accion] = "todos";
      }
    } else if (valor && typeof valor === "object") {
      for (const [accion, alcance] of Object.entries(valor as Record<string, unknown>)) {
        if (!ACCIONES.has(accion as Accion)) return null;
        if (typeof alcance !== "string" || !ALCANCES.has(alcance)) return null;
        grant[accion as Accion] = alcance as "todos" | "propios";
      }
    } else {
      return null;
    }
    grants[papel] = grant;
  }
  return grants;
}

function caducidad(crudo: unknown, modo: ModoVisitante): number | null {
  if (typeof crudo === "string") {
    const m = /^(\d{1,5})d$/.exec(crudo.trim());
    if (m) return Math.min(Number(m[1]), CADUCIDAD_MAX);
  }
  // Sin declarar: lo EFÍMERO caduca, lo que es contenido de la página no.
  // Borrar el menú de alguien por antigüedad sería absurdo; guardar carritos
  // para siempre, también.
  //
  // `publico` va con `lectura` y no con los otros dos, aunque lo escriba el
  // visitante: una reseña ES contenido de la página. Con los 90 días por
  // defecto, las reseñas de un negocio se irían borrando solas y el dueño vería
  // su sección vaciarse sin que nadie tocara nada — que es justo el fallo mudo
  // que este sistema evita en todo lo demás. Quien quiera caducidad la declara.
  //
  // `privado` tampoco: son las ventas de una caja, el registro del negocio.
  return modo === "lectura" || modo === "publico" || modo === "privado" ? null : CADUCIDAD_DEFECTO;
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

    const papeles = readRoleGrants(v.papeles);
    if (papeles === null) continue;

    salida[nombre] = {
      modo: modo as ModoVisitante,
      caducaDias: caducidad(v.caduca, modo as ModoVisitante),
      campos,
      ...(papeles ? { papeles } : {}),
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
