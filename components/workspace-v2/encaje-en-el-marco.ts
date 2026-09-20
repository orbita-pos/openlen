// EL MARCO ES DE LA PÁGINA, LOS PÍXELES SON DE LA FOTO.
//
// Un editor visual trata el hueco donde vive una foto como propiedad de la
// PÁGINA y la foto como contenido: cambiar la foto no mueve el marco. En HTML
// eso no sale gratis. Con el preflight de Tailwind (`img { height: auto }`) una
// foto de otra proporción encoge en cuanto le cambias el `src`, y por debajo
// asoma el fondo del hueco — la banda que Jesús vio el 19/09/2026 en una
// tarjeta de viaje.
//
// Aquí vive la regla, en un sitio, porque son TRES los gestos que mueven una
// foto dentro de su marco y los tres tenían el mismo agujero:
//
//   • reemplazar una foto          (use-image-replace.ts)
//   • intercambiar dos fotos       (use-element-inspect.ts, arrastrar una
//                                   encima de otra)
//   • arrastrar el asa de tamaño   (use-image-replace.ts)
//
// LO QUE NO HACE, Y ES LA MITAD DEL DISEÑO. No le pone `object-cover` a todo:
// eso sería re-decidir por encima del modelo, y un logo que la página declaró
// `object-contain` acabaría recortado. Se MIDE el hueco antes del gesto y sólo
// se restaura si el gesto rompió algo que ya cuadraba.
//
// Estas funciones se serializan con `.toString()` dentro de los scripts que se
// inyectan en el iframe (el patrón de `CORE_SRC`), así que tienen que ser
// AUTOSUFICIENTES: nada de closures, nada de imports. `ajustarAlMarco` llama a
// `cajaContenido`, así que las dos van juntas en el mismo `CORE_SRC` — igual
// que `editChildTags` con `isEditorNode` en edit-path.ts.
//
// Y NO POSTEA LA EDICIÓN. Devuelve si tocó algo y el inyector decide cuándo
// guardar: el reemplazo postea al momento, el asa sólo al soltar. Meter el post
// aquí dentro mandaría una edición por cada píxel de arrastre.

/** El hueco donde vive la foto: la caja de contenido de su padre. */
export type Marco = { w: number; h: number };

/** Ancho y alto de la caja de CONTENIDO (sin padding), o null si no la hay. */
export function cajaContenido(el: Element | null): Marco | null {
  if (!el) return null;
  const cs = getComputedStyle(el);
  const w =
    el.clientWidth -
    (parseFloat(cs.paddingLeft) || 0) -
    (parseFloat(cs.paddingRight) || 0);
  const h =
    el.clientHeight -
    (parseFloat(cs.paddingTop) || 0) -
    (parseFloat(cs.paddingBottom) || 0);
  return { w: w, h: h };
}

/**
 * El marco que hay que devolverle a esta foto después del gesto — o null.
 *
 * Null cuando la foto NO llenaba su hueco: entonces su tamaño no lo manda el
 * marco (una foto a media anchura, una miniatura centrada) y no hay nada que
 * restaurar. Se mide ANTES de tocar nada, que es cuando la respuesta existe.
 */
export function medirMarco(img: Element): Marco | null {
  const padre = img.parentElement;
  if (!padre) return null;
  const caja = cajaContenido(padre);
  if (!caja || caja.w <= 0 || caja.h <= 0) return null;
  const r = img.getBoundingClientRect();
  // EXACTO, no «al menos». Una foto que ya desbordaba su hueco antes del gesto
  // no es asunto nuestro: encajarla sería re-decidir algo que no hemos roto.
  if (Math.abs(caja.w - r.width) > 1 || Math.abs(caja.h - r.height) > 1) {
    return null;
  }
  return caja;
}

/**
 * Devuelve la foto a su marco si el gesto la sacó de él. `true` si tocó algo.
 *
 * Tres condiciones, las tres necesarias — `marco` no nulo ya dice la primera
 * (antes llenaba el hueco):
 *
 *  2. la caja del padre NO ha cambiado. Si cambió, el alto lo marcaba la foto
 *     y la página debe seguir fluyendo: no hay marco que respetar.
 *  3. ahora no la llena.
 *
 * El recorte lo decide la página si ya lo había declarado: sólo se escribe
 * `object-fit` cuando vale `fill`, que es el valor por defecto y significa que
 * nadie eligió.
 *
 * `conservarAncho` es para el asa de tamaño: ahí la anchura LA PONE EL USUARIO
 * y devolvérsela al 100 % dejaría el arrastre sin efecto. Se le restaura sólo
 * el alto, que es lo que no pidió tocar.
 */
export function ajustarAlMarco(
  img: HTMLImageElement,
  marco: Marco,
  conservarAncho: boolean,
): boolean {
  if (!img.parentElement || !img.naturalWidth) return false;
  const caja = cajaContenido(img.parentElement);
  if (!caja) return false;
  if (Math.abs(caja.h - marco.h) > 1 || Math.abs(caja.w - marco.w) > 1) {
    return false;
  }
  const r = img.getBoundingClientRect();
  // Descuadre en CUALQUIER dirección: quedarse corta deja ver el fondo del
  // hueco, y pasarse lo desborda — con `overflow:hidden` la recorta por donde
  // caiga, y sin él se come lo que venga debajo. Las dos son el mismo fallo.
  const altoMal = Math.abs(caja.h - r.height) > 1;
  const anchoMal = !conservarAncho && Math.abs(caja.w - r.width) > 1;
  if (!altoMal && !anchoMal) return false;
  if (getComputedStyle(img).objectFit === "fill") img.style.objectFit = "cover";
  if (!conservarAncho) img.style.width = "100%";
  img.style.height = "100%";
  return true;
}

/**
 * Corre `fn` cuando la foto nueva ya tiene tamaño — antes no se puede medir.
 *
 * También en `error`: ahí `naturalWidth` es 0 y `ajustarAlMarco` se planta
 * sola, pero el oyente hay que soltarlo igual.
 */
export function trasCargar(img: HTMLImageElement, fn: () => void): void {
  if (img.complete && img.naturalWidth > 0) {
    fn();
    return;
  }
  // NI UNA FUNCIÓN DENTRO, y no es estilo. esbuild con `keepNames` envuelve
  // toda función interna en `__name(fn, "nombre")` — la declarada TAMBIÉN, con
  // la llamada puesta detrás— y ese envoltorio viaja dentro del `.toString()`
  // hasta la página, donde `__name` no existe. La llamada revienta y el ajuste
  // no corre NUNCA, en silencio. Medido el 19/09 con el arnés de `.claude/qa`.
  //
  // Por eso el oyente es `fn` a pelo con `{ once: true }`: se quita solo al
  // dispararse. El otro se queda colgando, y da igual — si alguna vez dispara
  // será con la foto rota, y ahí `ajustarAlMarco` se planta sola por
  // `naturalWidth === 0`.
  img.addEventListener("load", fn, { once: true });
  img.addEventListener("error", fn, { once: true });
}
