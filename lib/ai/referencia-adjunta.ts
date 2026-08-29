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
