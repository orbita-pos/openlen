import type { InlineImage } from "@/lib/ai-gateway";

// ─────────────────────────────────────────────────────────────────────────────
// LA IMAGEN QUE ADJUNTA EL VISITANTE AL CREAR.
//
// El héroe deja subir una foto —su logo, su local, un tablero de referencia— y
// la página nace MIRÁNDOLA. Quien escribe ese turno es Qwen, no el razonador:
// `writerForTurn(true)` ya lo decide, y viaja por el mismo transporte.
//
// POR QUÉ ESTO NO ES UN `if` EN LA RUTA. La imagen la manda un desconocido sin
// sesión, en el cuerpo de una petición pública. Todo lo que entra por ahí se
// valida en un sitio que se pueda probar sin levantar Next, y la ruta sólo
// llama. Un límite escrito dentro de un handler de 900 líneas es un límite que
// nadie vuelve a leer.
//
// EL TAMAÑO SE MIDE EN BYTES DECODIFICADOS, no en longitud de cadena. Base64
// infla un tercio, así que un tope sobre la cadena deja pasar un 33% más de lo
// que uno cree — y ese error se descubre pagando tokens de visión.
// ─────────────────────────────────────────────────────────────────────────────

/** Formatos que el papel con visión entiende. WebP y AVIF entran porque es lo
 *  que exporta un móvil moderno; SVG NO, y a propósito: es un documento
 *  ejecutable, no una imagen, y nada aguas abajo lo trata como tal. */
const TIPOS = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);

/** 4 MB decodificados.
 *
 *  El compositor ya reduce a ~1024px antes de subir, así que lo normal son
 *  100-300 KB. Este tope no es el caso de uso: es el techo para que una
 *  petición pública no pueda mandarnos un archivo enorme por el que luego
 *  pagamos tokens. Generoso a propósito — una foto de móvil sin reducir cabe. */
export const MAX_BYTES_REFERENCIA = 4 * 1024 * 1024;

/** CUÁNTAS imágenes puede adjuntar el visitante a un brief.
 *
 *  El número NO sale del modelo. Los techos de arriba son enormes al lado de
 *  esto —Qwen por Fireworks acepta muchas más, y para comparar: la API de
 *  Claude admite 100 por petición y claude.ai 20 por mensaje—, así que 4 no es
 *  un límite técnico: es una decisión de producto y de factura.
 *
 *  Por qué 4 y no 1 (lo que había): una sola foto obliga a elegir entre el
 *  logo, el local y la referencia de estilo, y son tres cosas distintas que la
 *  página necesita a la vez. Cuatro cubre «mi logo + mi sitio + dos de
 *  inspiración» sin que nadie tenga que decidir.
 *
 *  Por qué 4 y no 20: cada imagen son ~1,5k tokens de visión que se pagan en
 *  CADA creación, y las fotos cruzan de la portada al taller por
 *  `sessionStorage`, cuya cuota ronda los 5 MB. A ~200 KB por foto reducida,
 *  cuatro caben con margen de sobra y veinte no.
 *
 *  Se comprueba en LOS DOS lados: la interfaz deja de aceptar (comodidad) y el
 *  servidor recorta (la puerta de verdad — el cuerpo lo manda un desconocido). */
export const MAX_REFERENCIAS = 4;

/** El techo de TODAS juntas, no de cada una.
 *
 *  Sin esto, `MAX_REFERENCIAS` × `MAX_BYTES_REFERENCIA` son 16 MB por petición
 *  pública: cuatro adjuntos legales por separado que sumados son un problema.
 *  12 MB deja pasar cuatro fotos de móvil SIN reducir —el caso peor legítimo—
 *  y corta el abuso. */
export const MAX_BYTES_REFERENCIAS_TOTAL = 12 * 1024 * 1024;

export type ReferenciaRechazada =
  | "tipo-no-soportado"
  | "demasiado-grande"
  | "base64-invalido"
  | "vacia";

export type ReferenciaAdjunta =
  | { readonly ok: true; readonly imagen: InlineImage; readonly bytes: number }
  | { readonly ok: false; readonly motivo: ReferenciaRechazada };

/** Cuántos bytes ocupa de verdad una cadena base64, sin decodificarla.
 *
 *  Decodificar para medir es asignar el buffer entero antes de saber si se
 *  puede aceptar — justo lo que el tope existe para impedir. */
export function bytesDeBase64(b64: string): number {
  const n = b64.length;
  if (n === 0) return 0;
  const relleno = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((n * 3) / 4) - relleno;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Lee la referencia del cuerpo de la petición. NUNCA lanza: un adjunto malo no
 * puede tumbar una creación, porque el brief del usuario vale por sí solo — la
 * ruta decide si avisar o seguir sin imagen.
 *
 * Acepta el `data:` URI entero (que es lo que produce un `FileReader`) además
 * del base64 pelado: exigirle al cliente que lo recorte es fricción por un
 * prefijo que sabemos leer.
 */
export function leerReferenciaAdjunta(crudo: unknown): ReferenciaAdjunta | null {
  if (crudo === undefined || crudo === null) return null;
  if (typeof crudo !== "object") return { ok: false, motivo: "vacia" };

  const o = crudo as { mimeType?: unknown; dataBase64?: unknown };
  let mime = typeof o.mimeType === "string" ? o.mimeType.trim().toLowerCase() : "";
  let datos = typeof o.dataBase64 === "string" ? o.dataBase64.trim() : "";

  // `data:image/png;base64,AAAA…` → el tipo de dentro MANDA sobre el declarado:
  // es el que el navegador escribió al leer el fichero de verdad.
  const m = /^data:([^;,]+);base64,(.*)$/is.exec(datos);
  if (m) {
    mime = m[1].trim().toLowerCase();
    datos = m[2];
  }
  datos = datos.replace(/\s/g, "");

  if (datos === "") return { ok: false, motivo: "vacia" };
  if (!TIPOS.has(mime)) return { ok: false, motivo: "tipo-no-soportado" };

  const bytes = bytesDeBase64(datos);
  // El tamaño ANTES que la forma: comprobar el alfabeto de 4 MB de basura es
  // trabajo tirado, y el tope es justo lo que impide ese trabajo.
  if (bytes > MAX_BYTES_REFERENCIA) return { ok: false, motivo: "demasiado-grande" };
  if (!BASE64.test(datos)) return { ok: false, motivo: "base64-invalido" };

  return { ok: true, imagen: { mimeType: mime, dataBase64: datos }, bytes };
}


/** Lo que sobrevivió de un lote de adjuntos, y lo que no. */
export interface ReferenciasAdjuntas {
  readonly imagenes: readonly InlineImage[];
  /** Bytes decodificados de todas juntas — para poder registrarlo. */
  readonly bytes: number;
  /** Por qué se cayó cada una que se cayó. Mismo orden en que venían. */
  readonly descartadas: readonly ReferenciaRechazada[];
}

/**
 * Lee el LOTE de referencias del cuerpo. La versión plural de
 * `leerReferenciaAdjunta`, y la que usa `/api/generate`.
 *
 * TRES REGLAS, y las tres son «no tumbes la creación»:
 *
 *   · Una imagen mala NO se lleva a las buenas. Se descarta ella sola y el
 *     motivo queda en `descartadas`. Quien sube cuatro fotos y una es un HEIC
 *     merece su página con las otras tres, no un 400.
 *   · Se recorta a `MAX_REFERENCIAS` en silencio. El cliente ya no deja
 *     adjuntar más; si llegan más es porque alguien habla con la ruta
 *     directamente, y a ése se le recorta, no se le explica.
 *   · Se para al pasar `MAX_BYTES_REFERENCIAS_TOTAL`, quedándose con las que
 *     ya cabían. Cortar por el total y no rechazar el lote entero mantiene la
 *     misma promesa: el brief siempre vale.
 *
 * Acepta ADEMÁS un objeto suelto, no sólo un array. Es lo que mandaba el
 * cliente antes de que esto fuera plural, y una pestaña abierta desde hace
 * media hora sigue mandándolo.
 */
export function leerReferenciasAdjuntas(crudo: unknown): ReferenciasAdjuntas {
  if (crudo === undefined || crudo === null) {
    return { imagenes: [], bytes: 0, descartadas: [] };
  }
  const lista = Array.isArray(crudo) ? crudo : [crudo];

  const imagenes: InlineImage[] = [];
  const descartadas: ReferenciaRechazada[] = [];
  let bytes = 0;

  for (const cruda of lista) {
    if (imagenes.length >= MAX_REFERENCIAS) break;
    const leida = leerReferenciaAdjunta(cruda);
    if (!leida) continue;
    if (!leida.ok) {
      descartadas.push(leida.motivo);
      continue;
    }
    if (bytes + leida.bytes > MAX_BYTES_REFERENCIAS_TOTAL) {
      descartadas.push("demasiado-grande");
      break;
    }
    imagenes.push(leida.imagen);
    bytes += leida.bytes;
  }

  return { imagenes, bytes, descartadas };
}
