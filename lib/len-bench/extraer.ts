// lib/len-bench/extraer.ts — qué dice una página, leído como lo leería una persona.
//
// Puro y sin DOM: los graders que necesitan el navegador lo abren ellos; esto
// sólo trabaja sobre el HTML servido, que es lo que llegó al visitante.

/** Las etiquetas que parten el texto en BLOQUES: lo de un lado y lo del otro no
 *  son la misma frase, ni el mismo número. */
const DE_BLOQUE =
  /<\/?(?:address|article|aside|blockquote|br|button|dd|div|dl|dt|figcaption|figure|footer|form|h[1-6]|header|hr|label|li|main|nav|ol|option|p|section|table|td|th|tr|ul)\b[^>]*>/gi;

/**
 * El texto que ve el visitante. Cada bloque en su línea: con todo pegado por
 * espacios, «<a>33 1907 4482</a> <div>24/7…» salía como el teléfono de 12
 * cifras 331907448224 (plantilla `voltio`, 2026-09-23), y `nada-inventado`
 * habría culpado a Len de un número que nadie escribió. Los teléfonos y los
 * precios no cruzan de línea; `aparece` sí, porque junta todo el espacio.
 */
export function textoVisible(html: string): string {
  return html
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(DE_BLOQUE, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n\s*/g, "\n")
    .trim();
}

export function soloDigitos(s: string): string {
  return s.replace(/\D/g, "");
}

/** Un valor de la ficha es un teléfono si, quitando separadores, sólo quedan 7–15 dígitos. */
export function esTelefono(valor: string): boolean {
  const limpio = valor.replace(/[\s()+.-]/g, "");
  return /^\d{7,15}$/.test(limpio);
}

export function telefonosDe(texto: string): string[] {
  const out: string[] = [];
  // Sin `\n` en la clase: un teléfono no cruza de un bloque a otro (textoVisible).
  for (const m of texto.matchAll(/\+?\(?\d[\d \t().-]{5,}\d/g)) {
    const d = soloDigitos(m[0]);
    if (d.length >= 7 && d.length <= 15) out.push(d);
  }
  return out;
}

/**
 * ¿El teléfono `visto` en la página (en dígitos) es el `dado`? Igual, o el dado
 * sin su lada de país (1–3 dígitos delante): quien da «+52 33 1234 5678» y lee
 * «(33) 1234-5678» en su página lee su número. Al revés NO: poner una lada que
 * nadie dio es el fallo de `lada-que-nadie-dio` (lib/agent/evals/cases.ts), y el
 * 1 de móvil viejo de México (521…) tampoco pasa, porque no es una lada quitada
 * sino un dígito puesto. Un 0 troncal nacional (Reino Unido, Argentina) no se
 * contempla: si un caso lo necesita, se añade con su prueba.
 */
export function esElTelefonoDado(visto: string, dado: string): boolean {
  if (visto === dado) return true;
  const sobra = dado.length - visto.length;
  return visto.length >= 7 && sobra >= 1 && sobra <= 3 && dado.endsWith(visto);
}

export function numerosDeContacto(html: string): string[] {
  const out: string[] = [];
  const patrones = [/href\s*=\s*["']tel:([^"']+)["']/gi, /wa\.me\/(\+?\d+)/gi, /[?&]phone=(\+?\d+)/gi];
  const conPosicion: { i: number; d: string }[] = [];
  for (const re of patrones) {
    for (const m of html.matchAll(re)) conPosicion.push({ i: m.index ?? 0, d: soloDigitos(m[1]) });
  }
  conPosicion.sort((a, b) => a.i - b.i);
  for (const x of conPosicion) if (x.d.length >= 7) out.push(x.d);
  return out;
}

/**
 * Los números a los que abre un chat de WhatsApp: `wa.me/<n>`, y `phone=` sólo
 * dentro de una URL de WhatsApp (api/web.whatsapp.com/send, whatsapp://send).
 * Un `tel:` NO cuenta: es una llamada, y el botón que se pidió era de chat.
 * Se busca en todo el HTML, scripts incluidos, porque un carrito suele armar
 * el enlace en JavaScript.
 */
export function numerosDeWhatsApp(html: string): string[] {
  const conPosicion: { i: number; d: string }[] = [];
  for (const re of [/wa\.me\/(\+?\d+)/gi, /whatsapp(?:\.com\/send\/?|:\/\/send\/?)\?(?:[^"'\s<>]*?&)?phone=(\+?\d+)/gi]) {
    for (const m of html.matchAll(re)) conPosicion.push({ i: m.index ?? 0, d: soloDigitos(m[1]) });
  }
  return conPosicion
    .sort((a, b) => a.i - b.i)
    .filter((x) => x.d.length >= 7)
    .map((x) => x.d);
}

export function correosDe(texto: string): string[] {
  return [...texto.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0].toLowerCase());
}

/** «70.00» y «70» son el mismo precio: los decimales a cero no cuentan. */
function precioEnDigitos(s: string): string {
  return soloDigitos(s.replace(/[.,]0{1,2}$/, ""));
}

// Un precio, con su moneda delante («$25», «€9») o detrás («30 MXN», «19€»,
// «1.850.000 €»). Los euros llegaron con las partidas de España (2026-09-23):
// sin ellos, un «9 €» inventado pasaba `nada-inventado` sin que nadie lo viera.
// Una sola lista para preciosDe, esPrecio y cifrasDe: separadas, se desfasan.
const PRECIO_DELANTE = /[$€][ \t]?(\d[\d.,]*\d|\d)/g;
const PRECIO_DETRAS = /(\d[\d.,]*\d|\d)[ \t]?(?:(?:MXN|USD|EUR|pesos|euros)\b|€)/gi;

/**
 * Los precios que salen de APLICAR a un precio dado un porcentaje dado: el
 * precio con el descuento y lo que se ahorra. «Les baja 10 %» sobre 78 € es
 * 70,20 € y 7,80 € — aritmética sobre lo que dio el dueño, no un dato nuevo
 * (Len 2.0 dev, `codigo-de-descuento`, 2026-09-25). En la forma de
 * `preciosDe`: con dos decimales, con uno y redondeado.
 */
export function preciosConPorcentaje(precios: Iterable<string>, texto: string): Set<string> {
  const porcentajes = [...texto.matchAll(/(\d{1,3}(?:[.,]\d+)?)\s?%/g)].map((m) => Number(m[1].replace(",", ".")));
  const out = new Set<string>();
  for (const p of precios) {
    const base = Number(p);
    if (!Number.isFinite(base) || base <= 0) continue;
    for (const q of porcentajes) {
      if (!(q > 0 && q < 100)) continue;
      for (const v of [base * (1 - q / 100), (base * q) / 100]) {
        out.add(precioEnDigitos(v.toFixed(2)));
        out.add(precioEnDigitos(v.toFixed(1)));
        out.add(String(Math.round(v)));
      }
    }
  }
  return out;
}

/**
 * Las ladas de país que aparecen dichas en un texto («+52»). `nada-inventado`
 * lo pasa por lo que dijo el dueño: con ellas, `wa.me/52…` delante de un
 * número dado es ese número; sin ellas, sigue siendo la lada que nadie dio.
 */
export function ladasDadas(texto: string): string[] {
  const escritas = [...texto.matchAll(/\+\s?(\d{1,3})(?!\d)/g)].map((m) => m[1]);
  const nombradas = LADA_DEL_PAIS.filter(([pais]) => pais.test(texto)).map(([, lada]) => lada);
  return [...new Set([...escritas, ...nombradas])];
}

/**
 * El país dicho por su nombre también da la lada: «Sí, es de México, está bien
 * así» (control del 26/09, telefono-nuevo-sin-lada #3) confirma el 52 igual
 * que un «+52». Sólo los de habla hispana con lada propia; los de la lada 1
 * (compartida) no, porque el nombre no dice cuál es.
 */
const LADA_DEL_PAIS: readonly (readonly [RegExp, string])[] = (
  [
    ["m[eé]xico", "52"],
    ["colombia", "57"],
    ["argentina", "54"],
    ["chile", "56"],
    ["per[uú]", "51"],
    ["espa[ñn]a", "34"],
    ["venezuela", "58"],
    ["ecuador", "593"],
    ["guatemala", "502"],
    ["bolivia", "591"],
    ["uruguay", "598"],
    ["paraguay", "595"],
    ["costa rica", "506"],
    ["panam[aá]", "507"],
    ["el salvador", "503"],
    ["honduras", "504"],
    ["nicaragua", "505"],
  ] as const
).map(([p, l]) => [new RegExp(`(?<!\\p{L})${p}(?!\\p{L})`, "iu"), l] as const);

export function preciosDe(texto: string): string[] {
  const out: { i: number; d: string }[] = [];
  for (const re of [PRECIO_DELANTE, PRECIO_DETRAS]) {
    for (const m of texto.matchAll(re)) out.push({ i: m.index ?? 0, d: precioEnDigitos(m[1]) });
  }
  return out.sort((a, b) => a.i - b.i).map((x) => x.d);
}

/**
 * Una cifra escrita como la escribiría cualquiera, en una sola forma: «4,9» y
 * «4.9» son la misma nota; «1.240», «1,240» y «1240», las mismas reseñas. Si
 * cada grupo tras el primero tiene 3 cifras, los separadores son de miles;
 * con los dos signos, el último es el decimal.
 */
function unaCifra(crudo: string): string {
  const seps = crudo.match(/[.,]/g) ?? [];
  if (seps.length === 0) return String(Number(crudo));
  const ultimo = seps[seps.length - 1];
  const miles = new Set(seps).size === 1 && crudo.split(/[.,]/).slice(1).every((g) => g.length === 3);
  if (miles) return String(Number(soloDigitos(crudo)));
  const [entera, decimal] = [crudo.slice(0, crudo.lastIndexOf(ultimo)), crudo.slice(crudo.lastIndexOf(ultimo) + 1)];
  return String(Number(`${soloDigitos(entera)}.${decimal}`));
}

/** TODOS los números del texto, también los de teléfonos, precios y horas: con esto se arma lo DADO. */
export function numerosDe(texto: string): string[] {
  return [...texto.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => unaCifra(m[0]));
}

/**
 * Las cifras con las que una página AFIRMA algo del negocio: «desde 2019»,
 * «4.800 viajeros», «4,9 en 1.240 reseñas», «98 %». Es el fallo de producción
 * del 19–21/09 (la agencia de viajes). Fuera quedan los teléfonos y los
 * precios, que ya suspende `nada-inventado`; las horas, que no mira ninguno de
 * los dos (un caso que pide un horario lleva el suyo: `horario-del-museo`), y
 * los dígitos sueltos («Paso 1», «3 tacos»), que no afirman nada del negocio y
 * lo llenarían de ruido.
 */
export function cifrasDe(texto: string): string[] {
  const sinLoDeOtro = texto
    .replace(/\+?\(?\d[\d \t().-]{5,}\d/g, (m) => {
      const d = soloDigitos(m).length;
      return d >= 7 && d <= 15 ? " " : m;
    })
    .replace(PRECIO_DELANTE, " ")
    .replace(PRECIO_DETRAS, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ");
  return numerosDe(sinLoDeOtro).filter((c) => c.includes(".") || Number(c) >= 10);
}

export function normalizar(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Un valor de la ficha es un precio si es SÓLO eso: «$25», «70.00 MXN». */
function esPrecio(valor: string): boolean {
  return preciosDe(valor).length === 1 && valor.replace(PRECIO_DELANTE, "").replace(PRECIO_DETRAS, "").trim() === "";
}

export function aparece(valor: string, html: string): boolean {
  return apareceEnTexto(valor, textoVisible(html));
}

/** `aparece`, sobre un texto ya sacado del HTML (el visible, o el del fichero). */
export function apareceEnTexto(valor: string, texto: string): boolean {
  // Como precio y no como texto: buscar «$25» a secas lo encuentra dentro de
  // «$250» y no lo encuentra en «$ 25.00», que es el mismo precio.
  if (esPrecio(valor)) return preciosDe(texto).includes(preciosDe(valor)[0]);
  if (esTelefono(valor)) {
    const dado = soloDigitos(valor);
    return telefonosDe(texto).some((t) => esElTelefonoDado(t, dado));
  }
  return normalizar(texto).includes(normalizar(valor));
}

const sinEntidades = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&[a-z]+;/gi, " ");

/**
 * El FICHERO como texto: lo visible, más los valores de los atributos (el
 * `<meta description>` que enseña Google, un `alt`, un `href`) y lo que va
 * dentro de `<script>` y `<style>`, cada cosa en su línea. Es lo que lee el
 * grader `regex` de Claude Code, que corre sobre el fichero y no sobre lo que
 * se pinta; y su consejo para afirmar una AUSENCIA es darle al grader el
 * texto entero (el corredor de evals de Claude Code). Los comentarios quedan fuera: no los ve
 * nadie más que quien edita el fuente.
 */
export function textoDelFichero(html: string): string {
  const atributos = [...html.matchAll(/<[a-zA-Z][^>]*>/g)].flatMap((t) =>
    [...t[0].matchAll(/\s[\w:.-]+\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => m[1] ?? m[2] ?? ""),
  );
  const codigo = [...html.matchAll(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  return [textoVisible(html), ...atributos.map(sinEntidades), ...codigo].join("\n");
}

/** Los valores de los campos NUMÉRICOS de la página (`type="number"` o
 *  `"range"` con `value`), para saber qué total calcula la página sola.
 *
 *  V9 (2026-09-26): también el de TEXTO que se declara numérico con
 *  `inputmode="decimal"` o `"numeric"` — la forma de aceptar «2,5» con coma,
 *  que un `type="number"` lee como 25 en un navegador en inglés. Sin ese
 *  `inputmode` un texto no cuenta: podría ser un nombre que vale «2». */
export function cantidadesDeLaPagina(html: string): number[] {
  const out: number[] = [];
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const texto = !/\stype\s*=/i.test(m[0]) || /\stype\s*=\s*["']?text\b/i.test(m[0]);
    const numerico = /\sinputmode\s*=\s*["']?(decimal|numeric)\b/i.test(m[0]);
    const tipo = /\stype\s*=\s*["']?(number|range)\b/i.exec(m[0]) ?? (texto && numerico ? [m[0]] : null);
    const valor = /\svalue\s*=\s*["']([^"']*)["']/i.exec(m[0]);
    const n = valor ? Number(valor[1].trim().replace(",", ".")) : NaN;
    if (tipo && valor && valor[1].trim() !== "" && Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Todo el HTML de un proyecto: la home y cada página del sitio. Lo leen los
 *  graders (lo dado de la partida) y el conductor (lo que el cliente puede citar). */
export function htmlDe(d: { readonly html: string; readonly pages?: Readonly<Record<string, unknown>> }): string {
  return [d.html, ...Object.values(d.pages ?? {}).map((p) => (p as { html?: string }).html ?? "")].join("\n");
}
