// lib/agent/enlaces-desfasados.ts — un enlace que DICE un número y MARCA otro.
//
// EL FALLO QUE LO TRAE (2026-09-03, escenario `copy`, primera corrida). Jesús
// pidió «el teléfono está mal, el bueno es 81 1234 5678, cámbialo en todos
// lados». El Agente cambió los dos TEXTOS visibles y dejó el
// `href="tel:+528188880000"` con el número viejo. Y lo reportó como hecho:
// «lo cambié en los dos sitios donde aparecía».
//
// El contador de ops lo prueba sin lugar a dudas: ese turno emitió `text×2` y
// CERO `attrs`, y un href sólo se puede cambiar con `attrs`.
//
// POR QUÉ IMPORTA MÁS QUE UN FALLO DE COPY. La página enseña el número nuevo y
// el botón marca el viejo. Es invisible en la captura, invisible para el
// crítico con visión, invisible para el dueño — hasta que un cliente llama a un
// número muerto. Misma familia que `metaDesfasada` (el teléfono viejo que se
// queda en la meta description), y misma consecuencia: llamadas que no entran.
//
// ⚠️ Y probablemente lo facilitó `op="text"`, del mismo día. Antes, cambiar el
// texto de un `<a>` obligaba a `replace`, que reteclea la etiqueta entera — y
// el href pasaba por delante. Con un verbo que cambia el texto sin tocar los
// atributos, olvidarlos sale gratis. El verbo no está mal; lo que faltaba era
// esto.
//
// SE MIDE SOBRE EL DOCUMENTO FINAL, no comparando antes y después. Un enlace
// que dice un número y marca otro está mal viniera de donde viniera, y así
// también caza el que ya estaba torcido de antes.
//
// PURO: una cadena a una lista. Sin red, sin base, sin navegador.

/** Un enlace cuyo texto visible y cuyo destino no dicen lo mismo. */
export interface EnlaceDesfasado {
  readonly tipo: "tel" | "correo";
  /** El texto visible, recortado. */
  readonly texto: string;
  /** El destino real del enlace. */
  readonly href: string;
}

/** Cuántos se le nombran al modelo. Con cuatro ya sabe qué arreglar. */
const MAX_NOMBRADOS = 4;

/** Mínimo de dígitos para que un texto cuente como número de teléfono. Por
 *  debajo son horarios («9 a 19»), precios o un «24/7», y avisar de eso enseña
 *  a ignorar el aviso. */
const MIN_DIGITOS = 7;

const ANCLA_RE = /<a\b[^>]*\shref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const CORREO_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

function digitos(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * ¿Uno es el final del otro?
 *
 * `tel:+528112345678` y el texto «81 1234 5678» son EL MISMO número: el href
 * lleva el prefijo de país y el texto no. Exigir igualdad exacta convertiría en
 * hallazgo la forma correcta de escribir un teléfono, que es justo lo que la
 * doctrina de este repo prohíbe — una duda no se vuelve hallazgo.
 */
function mismoNumero(a: string, b: string): boolean {
  return a.endsWith(b) || b.endsWith(a);
}

/** Los enlaces `tel:`/`mailto:` cuyo texto no casa con su destino. */
export function enlacesDesfasados(html: string): EnlaceDesfasado[] {
  const salida: EnlaceDesfasado[] = [];
  for (const m of html.matchAll(ANCLA_RE)) {
    const href = m[1]!.trim();
    // El texto visible: sin etiquetas de dentro (un `<span>` alrededor del
    // número es corriente) y sin espacios de sobra.
    const texto = m[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!texto) continue;

    if (/^tel:/i.test(href)) {
      const enTexto = digitos(texto);
      // Sin dígitos suficientes el texto no promete ningún número («Llámanos»,
      // «Pide cita»), así que no puede contradecir al destino.
      if (enTexto.length < MIN_DIGITOS) continue;
      const enHref = digitos(href);
      if (enHref.length < MIN_DIGITOS) continue;
      if (!mismoNumero(enHref, enTexto)) {
        salida.push({ tipo: "tel", texto: texto.slice(0, 40), href });
      }
      continue;
    }

    if (/^mailto:/i.test(href)) {
      const enTexto = CORREO_RE.exec(texto)?.[0];
      // Un botón que dice «Escríbenos» no promete ninguna dirección.
      if (!enTexto) continue;
      const enHref = href.slice("mailto:".length).split("?")[0]!.trim();
      if (enTexto.toLowerCase() !== enHref.toLowerCase()) {
        salida.push({ tipo: "correo", texto: texto.slice(0, 40), href });
      }
    }
  }
  return salida;
}

/**
 * El aviso PARA EL MODELO, en el mismo turno.
 *
 * Se avisa, no se rechaza: la edición que hizo es correcta en lo que hizo — le
 * falta la otra mitad. Y se le dice CON QUÉ arreglarlo, porque el verbo no es
 * obvio: el texto se cambia con `text` y el destino con `attrs`, y son dos ops
 * distintas sobre el mismo elemento.
 */
export function avisoEnlacesDesfasados(lista: readonly EnlaceDesfasado[]): string {
  const nombrados = lista
    .slice(0, MAX_NOMBRADOS)
    .map((e) => `«${e.texto}» → ${e.href}`)
    .join(" · ");
  const resto = lista.length > MAX_NOMBRADOS ? ` (y ${lista.length - MAX_NOMBRADOS} más)` : "";
  return (
    `${lista.length} enlace(s) DICEN un dato y LLEVAN a otro: ${nombrados}${resto}. ` +
    `La página enseña lo nuevo y el botón sigue marcando lo viejo — es invisible en una captura y ` +
    `no se nota hasta que alguien llama a un número muerto. Cambiar el texto de un enlace NO cambia ` +
    `su destino: son dos ops sobre el mismo elemento, op="text" para lo que se lee y op="attrs" ` +
    `sobre href para adónde va. Arréglalo AHORA, en este mismo turno.`
  );
}
