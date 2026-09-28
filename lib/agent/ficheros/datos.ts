/**
 * LOS ALMACENES DE LA PÁGINA, COMO FICHEROS (H3 de Len 2.x).
 *
 * Claude Code no tiene una herramienta para «guardar un dato»: todo es un
 * fichero. Aquí cada almacén que la página declara es `/datos/<almacen>.json`,
 * la lista de sus filas con su `id`, y se lee y se edita con Read/Edit/Write
 * como cualquier otro fichero. Este módulo es la mitad PURA: el texto del
 * almacén, y lo que significa un texto editado —altas, cambios y bajas—,
 * VALIDADO ENTERO antes de que nada se aplique. La mitad con base vive en
 * `lib/agent/herramientas-de-ficheros.ts` (`guardarDatos`), que llama a las escrituras de siempre
 * (`lib/page-data/agente.ts`): permisos y cuota no se tocan.
 *
 * Decidido en voz alta: un campo que el almacén no declara es un ERROR, no se
 * descarta en silencio como hace `validaDocumento`. Con ficheros el modelo
 * cree que su copia dice lo que escribió; tirar el campo haría mentir al
 * fichero y fallar su siguiente Edit sin que supiera por qué.
 */
import { validaDocumento, type AlmacenDeclarado } from "@/lib/page-data/declaracion";

const CARPETA = "/datos/";

/** La marca de una fila que escribió un VISITANTE. Informativa: no se guarda. */
const ORIGEN = "_origen";

export interface FilaDeAlmacen {
  readonly id: string;
  readonly doc: Readonly<Record<string, unknown>>;
  readonly deVisitante: boolean;
}

export interface PlanDeAlmacen {
  readonly cambios: { readonly id: string; readonly doc: Record<string, unknown> }[];
  readonly altas: Record<string, unknown>[];
  readonly bajas: string[];
}

export function rutaDeAlmacen(nombre: string): string {
  return `${CARPETA}${nombre}.json`;
}

/** El almacén de una ruta, o `null` si no es un fichero de datos. */
export function almacenDeRuta(ruta: string): string | null {
  const m = /^\/datos\/([^/]+)\.json$/.exec(ruta);
  return m ? m[1]! : null;
}

/** Lo que se contesta al escribir el fichero de un almacén que la página no
 *  declara: el almacén no se crea por aquí, se declara en la página. */
export function noDeclarado(nombre: string): string {
  return `The store «${nombre}» is not declared. Declare it in the page's <script type="application/json" data-ol-stores> block first; then ${rutaDeAlmacen(nombre)} exists.`;
}

/** El fichero: la lista de filas, cada una con su `id` delante. */
export function textoDelAlmacen(filas: readonly FilaDeAlmacen[]): string {
  const lista = filas.map((f) => ({ id: f.id, ...f.doc, ...(f.deVisitante ? { [ORIGEN]: "visitante" } : {}) }));
  return `${JSON.stringify(lista, null, 2)}\n`;
}

/** Igualdad de documentos sin depender del orden de las claves. */
function igual(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
  const ordena = (o: Readonly<Record<string, unknown>>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  return ordena(a) === ordena(b);
}

/**
 * Lo que significa el texto editado frente a las filas de ahora, o por qué no
 * se puede aplicar. Todo o nada: el primer problema devuelve el error y el
 * plan no existe.
 */
export function planDelAlmacen(
  antes: readonly FilaDeAlmacen[],
  texto: string,
  almacen: AlmacenDeclarado,
  nombre: string,
): { readonly ok: true; readonly plan: PlanDeAlmacen } | { readonly ok: false; readonly error: string } {
  const ruta = rutaDeAlmacen(nombre);
  let lista: unknown;
  try {
    lista = JSON.parse(texto);
  } catch (err) {
    return { ok: false, error: `${ruta} is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!Array.isArray(lista)) return { ok: false, error: `${ruta} must be a JSON list of rows ([ … ]).` };

  const porId = new Map(antes.map((f) => [f.id, f]));
  const vistos = new Set<string>();
  const declarados = Object.keys(almacen.campos);
  const plan: PlanDeAlmacen = { cambios: [], altas: [], bajas: [] };

  for (const [i, fila] of lista.entries()) {
    if (!fila || typeof fila !== "object" || Array.isArray(fila)) {
      return { ok: false, error: `Row ${i + 1} of ${ruta} is not an object.` };
    }
    const { id, [ORIGEN]: _origen, ...doc } = fila as Record<string, unknown>;
    const ajenos = Object.keys(doc).filter((c) => !(c in almacen.campos));
    if (ajenos.length > 0) {
      return {
        ok: false,
        error: `Row ${i + 1} of ${ruta} has fields the store «${nombre}» does not declare: ${ajenos.map((c) => `«${c}»`).join(", ")}. Declared fields: ${declarados.join(", ")}. Declare them in the page's data-ol-stores block, or remove them.`,
      };
    }
    const v = validaDocumento(almacen, doc);
    if (!v.ok) {
      const campo = v.razon.startsWith("campo_invalido:") ? v.razon.slice("campo_invalido:".length) : v.razon;
      return { ok: false, error: `Row ${i + 1} of ${ruta}: the value of «${campo}» does not match its declared type (${almacen.campos[campo] ?? "?"}).` };
    }
    if (id === undefined) {
      plan.altas.push(v.doc);
      continue;
    }
    if (typeof id !== "string" || !porId.has(id)) {
      return { ok: false, error: `Row ${i + 1} of ${ruta} has id «${String(id)}», which does not exist. To add a row, leave out its id.` };
    }
    if (vistos.has(id)) return { ok: false, error: `The id «${id}» appears twice in ${ruta}.` };
    vistos.add(id);
    if (!igual(porId.get(id)!.doc, v.doc)) plan.cambios.push({ id, doc: v.doc });
  }
  for (const f of antes) if (!vistos.has(f.id)) plan.bajas.push(f.id);
  return { ok: true, plan };
}
