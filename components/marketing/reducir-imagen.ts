"use client";

// ─────────────────────────────────────────────────────────────────────────────
// REDUCIR LA FOTO ANTES DE QUE SALGA DEL NAVEGADOR.
//
// Una foto de móvil son 4-12 MB y 4000px de ancho. Al papel con visión no le
// sirve de nada ese detalle —mira composición, color y carácter, no granos— y
// mandarla entera cuesta en tres sitios: el tiempo de subida del visitante, los
// tokens de visión que pagamos nosotros, y la cuota de `sessionStorage` que
// tiene que cruzar hasta el taller.
//
// 1024px de lado mayor es donde la calidad deja de cambiar el juicio del modelo.
// Medido en ningún sitio por nosotros: es el tamaño al que trabajan las APIs de
// visión, y bajar de ahí sí empieza a perder texto pequeño de un logo.
//
// SE REENCODA SIEMPRE A JPEG, incluso si entró como PNG. Un PNG de una foto
// pesa 3-5x lo que su JPEG, y aquí no hay transparencia que preservar: es una
// referencia visual, no un activo que se vaya a publicar.
// ─────────────────────────────────────────────────────────────────────────────

const LADO_MAYOR = 1024;
const CALIDAD = 0.82;

export interface ImagenReducida {
  /** `data:image/jpeg;base64,…` */
  readonly dataUrl: string;
  readonly ancho: number;
  readonly alto: number;
  /** Bytes aproximados del resultado, para poder decirlo en la interfaz. */
  readonly bytes: number;
}

/**
 * Lee el fichero, lo reduce y lo devuelve como `data:` URI.
 *
 * NUNCA lanza por un fichero malo: devuelve `null`. Un usuario que arrastra un
 * PDF pensando que es una foto no merece una excepción sin manejar en la
 * portada; merece que no pase nada y poder elegir otra.
 */
export async function reducirImagen(file: File): Promise<ImagenReducida | null> {
  if (!file.type.startsWith("image/")) return null;

  // `createImageBitmap` decodifica FUERA del hilo principal, así que una foto
  // de 12 MP no congela la página mientras se abre. Donde no exista, se cae al
  // camino de `<img>`, que hace lo mismo bloqueando un instante.
  let bitmap: ImageBitmap | HTMLImageElement | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    bitmap = await new Promise<HTMLImageElement | null>((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }
  if (!bitmap) return null;

  const wOrig = "width" in bitmap ? bitmap.width : 0;
  const hOrig = "height" in bitmap ? bitmap.height : 0;
  if (wOrig === 0 || hOrig === 0) return null;

  // Sólo se ACHICA. Una foto pequeña ampliada a 1024 no gana información: gana
  // peso y pierde nitidez.
  const escala = Math.min(1, LADO_MAYOR / Math.max(wOrig, hOrig));
  const ancho = Math.max(1, Math.round(wOrig * escala));
  const alto = Math.max(1, Math.round(hOrig * escala));

  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext("2d");
  if (!ctx) return null;
  // Fondo blanco: un PNG con transparencia sobre JPEG sale negro, y una foto de
  // producto recortada convertida en una silueta negra es peor que no subirla.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ancho, alto);
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, ancho, alto);
  if ("close" in bitmap) bitmap.close();

  const dataUrl = lienzo.toDataURL("image/jpeg", CALIDAD);
  const coma = dataUrl.indexOf(",");
  if (coma < 0) return null;
  const b64 = dataUrl.slice(coma + 1);
  const relleno = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((b64.length * 3) / 4) - relleno;

  return { dataUrl, ancho, alto, bytes };
}
