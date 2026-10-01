// Las fotos del teléfono pasan de los 5 MB que acepta /api/upload: se achican
// antes de subirlas (JPEG, lado mayor ≤ 2048 px). createImageBitmap respeta el
// giro de la foto (EXIF) en Chrome y en el WebView.
export const LADO_MAXIMO = 2048;

export function medidasAchicadas(ancho: number, alto: number, max = LADO_MAXIMO): { ancho: number; alto: number } {
  const mayor = Math.max(ancho, alto);
  if (mayor <= max) return { ancho, alto };
  const k = max / mayor;
  return { ancho: Math.round(ancho * k), alto: Math.round(alto * k) };
}

export async function achicarFoto(foto: Blob): Promise<Blob> {
  const img = await createImageBitmap(foto);
  const m = medidasAchicadas(img.width, img.height);
  const lienzo = document.createElement("canvas");
  lienzo.width = m.ancho;
  lienzo.height = m.alto;
  lienzo.getContext("2d")!.drawImage(img, 0, 0, m.ancho, m.alto);
  img.close();
  return new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error("no se pudo achicar la foto"))), "image/jpeg", 0.85));
}
