// lib/publish/collection-template.ts — repetir la tarjeta que escribió el
// MODELO, en vez de dibujar la nuestra.
//
// POR QUÉ EXISTE. Hasta hoy el contrato con el modelo era: «deja un hueco vacío
// (`<section data-ol-collection-section></section>`) y OpenLen lo rellena». El
// relleno lo pintaba `collections-block.ts` con SUS propias paletas: el único
// trozo de una página publicada que OpenLen dibujaba con su gusto y no con el
// de la página. Contra el norte «nacen bellas», ése era el agujero.
//
// Y el hueco partía el cerebro en dos: el modelo no veía tarjeta alguna, así
// que ante «pon el menú en dos columnas» FABRICABA una rejilla inventada que al
// publicar salía junto a la horneada. La prótesis que avisaba de eso
// (`lib/collections/catalog-block.ts`) existía sólo por esa partición.
//
// Ahora el modelo escribe tarjetas de verdad, en el idioma visual de su página,
// y las marca. Al publicar tomamos la PRIMERA como plantilla y la repetimos con
// los ítems del dueño: el gusto es de la página, los datos son del dueño, y el
// Google Sheet sigue entrando por donde entraba.
//
// La ruta vieja NO se borra. Una página anterior a este cambio lleva el hueco
// vacío y sin plantilla: `bakeCollections` delega aquí primero y sólo cae a la
// rejilla de siempre cuando no hay plantilla. Ninguna página ya publicada se
// queda en blanco por el cambio.

import { parse } from "node-html-parser";
import type { HTMLElement as ParsedElement } from "node-html-parser";
import type { ItemRow } from "@/lib/collections/store";

/** La tarjeta repetible. */
export const ITEM_ATTR = "data-ol-item";
/** Un hueco DE TEXTO dentro de la tarjeta. Ojo: `data-ol-item` no es prefijo
 *  suyo a efectos de selector — `[data-ol-item]` NO casa con un elemento que
 *  sólo lleva `data-ol-item-field` (los selectores de atributo van por nombre
 *  exacto; verificado contra el parser). */
export const FIELD_ATTR = "data-ol-item-field";

export type ItemField =
  | "title"
  | "price"
  | "subtitle"
  | "description"
  | "badge"
  | "image"
  | "cta";

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

// Mismas listas blancas que la rejilla vieja: el API ya las valida, pero una
// fila escrita a mano en la base no debe poder meter `javascript:` en un href.
const SAFE_HREF_RE = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;
const SAFE_IMG_RE = /^(https?:\/\/|\/(?!\/))/i;
// Para `background-image:url(...)` escapar como HTML no sirve: del paréntesis
// se sale con un `)` o una comilla. En vez de escapar se RECHAZA lo que lleve
// cualquiera de esos caracteres — una URL legítima de R2/Unsplash no los tiene,
// y fallar aquí sólo significa «deja la imagen que dibujó el modelo».
const CSS_SAFE_URL_RE = /^[^"'()\\\s;]+$/;

function safeHref(s: string | null): string | null {
  const v = s?.trim();
  return v && SAFE_HREF_RE.test(v) ? v : null;
}
function safeImg(s: string | null): string | null {
  const v = s?.trim();
  return v && SAFE_IMG_RE.test(v) ? v : null;
}

// `hidden` a secas NO basta en estas páginas: la regla del navegador
// (`[hidden]{display:none}`) empata en especificidad con una utilidad de
// Tailwind (`.flex`) y pierde por orden, porque preflight va antes que las
// utilidades. El `display:none` INLINE gana siempre. Por eso van los dos.
const HIDDEN_STYLE = "display:none;";

function hideSlot(el: ParsedElement): void {
  el.setAttribute("hidden", "");
  const style = el.getAttribute("style") ?? "";
  if (!style.startsWith(HIDDEN_STYLE)) el.setAttribute("style", HIDDEN_STYLE + style);
}

function showSlot(el: ParsedElement): void {
  el.removeAttribute("hidden");
  const style = el.getAttribute("style") ?? "";
  if (!style.startsWith(HIDDEN_STYLE)) return;
  const rest = style.slice(HIDDEN_STYLE.length);
  if (rest) el.setAttribute("style", rest);
  else el.removeAttribute("style");
}

/** El elemento marcado se trata como HUECO DE TEXTO: su interior se sustituye
 *  entero, así que un `data-ol-item-field="price"` con diseño anidado dentro
 *  pierde ese diseño. Es el contrato, y el prompt lo dice así: se marca el nodo
 *  que LLEVA el texto, no su envoltorio. */
function setText(el: ParsedElement, value: string): void {
  el.set_content(escapeHtml(value));
}

/** Marcas de proporción: si el envoltorio lleva una, es él quien reserva la
 *  altura y es él quien tiene que desaparecer. Cubre las utilidades de Tailwind
 *  (`aspect-[4/3]`, `aspect-video`, `h-48`, `min-h-…`) y el CSS a mano. */
const RESERVA_ALTURA =
  /\b(?:aspect-|h-\d|h-\[|min-h-)|aspect-ratio\s*:|(?:^|;)\s*height\s*:/i;

/**
 * El elemento que de verdad ocupa el sitio de la foto.
 *
 * Sube UN nivel como mucho: el padre inmediato cuenta como marco sólo si la
 * imagen es su único hijo elemento y él es quien fija la proporción. Subir más
 * arriesga esconder media tarjeta, y quedarse corto sólo cuesta un hueco.
 */
function marcoDeLaFoto(el: ParsedElement): ParsedElement {
  const padre = el.parentNode;
  if (!padre || typeof padre.querySelectorAll !== "function") return el;
  const clase = `${padre.getAttribute?.("class") ?? ""} ${padre.getAttribute?.("style") ?? ""}`;
  if (!RESERVA_ALTURA.test(clase)) return el;
  // Un padre con hermanos —título, precio— NO es un marco de foto: es la
  // tarjeta entera, y esconderla borraría el producto.
  const hijos = padre.querySelectorAll("*").filter((n) => n.parentNode === padre);
  if (hijos.length !== 1) return el;
  return padre;
}

function fillImage(el: ParsedElement, item: ItemRow): void {
  const src = safeImg(item.imageUrl);
  const marco = marcoDeLaFoto(el);
  // El reset de `fillCard` sólo destapa el hueco marcado; el marco lo tiene que
  // destapar quien lo escondió. Sin esto, un ítem sin foto dejaba el marco
  // oculto para TODOS los siguientes cuando el molde salía de una tarjeta ya
  // rellenada — el mismo modo de fallo que ya cazamos con las insignias.
  if (marco !== el) showSlot(marco);
  // Sin foto propia se ESCONDE el hueco. La tentación era conservar la que
  // dibujó el modelo —la página nace con fotos reales, así que siempre hay
  // una— pero MEDIDO en el render: un «Agua de horchata» con la foto de tacos
  // de la tarjeta de muestra. La página estaría mintiendo sobre el producto, y
  // eso la doctrina de degradación lo prohíbe aunque quede más vacío.
  if (!src) {
    // Se esconde el ENVOLTORIO de la foto, no sólo la `<img>`.
    //
    // MEDIDO en el render de una generación real: el modelo puso la proporción
    // en un `<div class="aspect-[4/3]">` y la `<img>` dentro. Escondiendo sólo
    // la imagen, el envoltorio seguía reservando su altura y la tarjeta salía
    // con un marco vacío enorme. El prompt le pide que ponga la proporción en
    // la propia `<img>`, pero un prompt no es una garantía — y esto sí.
    hideSlot(marco);
    return;
  }
  const esImg = (el.rawTagName ?? "").toLowerCase() === "img";
  if (esImg) {
    el.setAttribute("src", src);
    el.setAttribute("alt", item.title);
    return;
  }
  // No es <img>: es la caja con degradado que el modelo usa de marcador de
  // foto. Con foto del dueño se convierte en fondo.
  if (!CSS_SAFE_URL_RE.test(src)) return;
  const style = el.getAttribute("style") ?? "";
  el.setAttribute(
    "style",
    `${style};background-image:url(${src});background-size:cover;background-position:center;`,
  );
}

function fillCta(el: ParsedElement, item: ItemRow): void {
  const href = safeHref(item.ctaUrl);
  if (!href || !item.ctaLabel) {
    // Un botón que no lleva a ningún sitio es una promesa falsa: se esconde,
    // no se deja muerto.
    hideSlot(el);
    return;
  }
  if ((el.rawTagName ?? "").toLowerCase() === "a") el.setAttribute("href", href);
  setText(el, item.ctaLabel);
}

/** Rellena UNA tarjeta ya clonada con los datos de un ítem. */
function fillCard(card: ParsedElement, item: ItemRow): void {
  for (const slot of card.querySelectorAll(`[${FIELD_ATTR}]`)) {
    const campo = (slot.getAttribute(FIELD_ATTR) ?? "").trim().toLowerCase();
    // Reset primero: la plantilla puede venir de una tarjeta YA rellenada (una
    // segunda pasada sobre la misma salida), y un hueco escondido para el ítem
    // anterior tiene que volver a existir para éste. Sin esto el horneado no
    // sería idempotente: un ítem 1 sin insignia mataría la insignia de todos.
    showSlot(slot);
    switch (campo) {
      case "title":
        setText(slot, item.title);
        break;
      case "price":
        if (item.priceDisplay) setText(slot, item.priceDisplay);
        else hideSlot(slot);
        break;
      case "subtitle":
        if (item.subtitle) setText(slot, item.subtitle);
        else hideSlot(slot);
        break;
      case "description":
        if (item.description) setText(slot, item.description);
        else hideSlot(slot);
        break;
      case "badge":
        if (item.badge) setText(slot, item.badge);
        else hideSlot(slot);
        break;
      case "image":
        fillImage(slot, item);
        break;
      case "cta":
        fillCta(slot, item);
        break;
      default:
        // Campo desconocido (el modelo se inventó un nombre): se deja tal cual.
        // Borrarlo perdería diseño por un error de nomenclatura suyo.
        break;
    }
  }
}

/** ¿La página trae tarjetas escritas por el modelo? Cuando sí, ninguna
 *  superficie debe dibujar la rejilla genérica ni las tarjetas fantasma encima:
 *  la sección ya es contenido diseñado. */
export function hasCollectionTemplate(html: string): boolean {
  if (!html.includes(ITEM_ATTR)) return false;
  return parse(html).querySelectorAll(`[${ITEM_ATTR}]`).length > 0;
}

/**
 * El molde: la tarjeta con MÁS huecos marcados, no la primera.
 *
 * MEDIDO en una generación real: de 11 tarjetas que escribió el modelo, sólo
 * UNA llevaba hueco de insignia. Cayó en la primera y salió bien de casualidad
 * — si hubiera caído en la tercera, ningún ítem del dueño habría podido enseñar
 * su insignia jamás, y nada lo habría avisado. El modelo escribe cada tarjeta
 * con los campos que ese platillo de muestra necesitaba, no con todos.
 *
 * Empate ⇒ la primera, que es el orden en que el modelo las pensó.
 */
function moldeMasCompleto(cards: readonly ParsedElement[]): string {
  let mejor = cards[0];
  let max = -1;
  for (const c of cards) {
    const n = c.querySelectorAll(`[${FIELD_ATTR}]`).length;
    if (n > max) {
      max = n;
      mejor = c;
    }
  }
  return mejor.toString();
}

/** Una tarjeta rellena por ítem, a partir del molde. */
function cardsFor(
  molde: string,
  items: readonly ItemRow[],
  extra?: Record<string, string>,
): string {
  return items
    .map((item) => {
      const clon = parse(molde).querySelector(`[${ITEM_ATTR}]`);
      if (!clon) return "";
      fillCard(clon, item);
      if (extra) for (const [k, v] of Object.entries(extra)) clon.setAttribute(k, v);
      return clon.toString();
    })
    .join("");
}

export interface TemplateFillResult {
  html: string;
  /** ¿El documento traía plantilla? `true` obliga al llamador a NO caer a la
   *  rejilla vieja — ni siquiera para «limpiar» la banda: aquí la banda es
   *  contenido diseñado, no un marcador de posición. */
  touched: boolean;
  /** Cuántas tarjetas se emitieron. 0 con `touched: true` = hay plantilla pero
   *  el dueño todavía no ha cargado ítems. */
  filled: number;
}

/**
 * Repite la tarjeta marcada del documento, una vez por ítem publicado.
 *
 * Con 0 ítems devuelve el HTML **intacto**: las tarjetas que escribió el modelo
 * son diseño y texto suyos, igual que cualquier otra sección que inventó, y
 * vaciarlas dejaría un hueco donde había una página. El dueño las sustituye en
 * cuanto carga su catálogo.
 */
export function fillCollectionTemplate(
  html: string,
  items: readonly ItemRow[],
): TemplateFillResult {
  // Atajo de cadena: si el atributo ni aparece, no se parsea. El round-trip
  // parse→toString NO es identidad (pierde comentarios, normaliza `/>`), así
  // que sólo se paga cuando de verdad hay algo que rellenar — mismo criterio
  // que `lib/live/bake-values.ts`.
  if (!html.includes(ITEM_ATTR)) return { html, touched: false, filled: 0 };

  const dom = parse(html);
  const marcadas = dom.querySelectorAll(`[${ITEM_ATTR}]`);
  if (marcadas.length === 0) return { html, touched: false, filled: 0 };
  if (items.length === 0) return { html, touched: true, filled: 0 };

  const plantilla = marcadas[0];
  const padre = plantilla.parentNode;
  if (!padre) return { html, touched: true, filled: 0 };

  // Sólo la primera tanda: las tarjetas hermanas de la plantilla. Una marca
  // suelta en otra parte del documento no se toca — repetir a ciegas por todo
  // el árbol duplicaría el catálogo en cada sección que la llevara.
  const tanda = marcadas.filter((n) => n.parentNode === padre);

  // La PRIMERA marca el sitio; el molde sale de la más completa de la tanda.
  plantilla.insertAdjacentHTML("beforebegin", cardsFor(moldeMasCompleto(tanda), items));
  for (const vieja of tanda) vieja.remove();

  return { html: dom.toString(), touched: true, filled: items.length };
}

/**
 * Variante para el LIENZO del editor: enseña el catálogo real sin tocar lo que
 * el modelo escribió.
 *
 * El contrato de persistencia del lienzo (ver `module-preview.ts`) es que TODO
 * lo inyectado lleve el sello y el guardado lo borre: la vista previa jamás
 * puede acabar en `data.html`. Por eso aquí no se rellena en el sitio —eso
 * reescribiría las tarjetas del modelo y el guardado las persistiría con el
 * texto de la base— sino que se INSERTAN copias selladas junto a la plantilla
 * y se esconden las originales con un `<style>` igualmente sellado. Al guardar
 * se van las copias y el estilo, y la plantilla vuelve intacta.
 */
export function previewCollectionCards(
  html: string,
  items: readonly ItemRow[],
  opts: { marker: string; attrs?: Record<string, string> },
): string {
  if (!html.includes(ITEM_ATTR) || items.length === 0) return html;
  const dom = parse(html);
  const marcadas = dom.querySelectorAll(`[${ITEM_ATTR}]`);
  const plantilla = marcadas[0];
  if (!plantilla) return html;

  const hermanas = marcadas.filter((n) => n.parentNode === plantilla.parentNode);
  const tarjetas = cardsFor(moldeMasCompleto(hermanas), items, {
    [opts.marker]: "",
    ...(opts.attrs ?? {}),
  });
  if (!tarjetas) return html;
  plantilla.insertAdjacentHTML("beforebegin", tarjetas);

  const oculta = `<style ${opts.marker}>[${ITEM_ATTR}]:not([${opts.marker}]){display:none!important}</style>`;
  const out = dom.toString();
  const head = out.indexOf("</head>");
  return head === -1 ? oculta + out : out.slice(0, head) + oculta + out.slice(head);
}
