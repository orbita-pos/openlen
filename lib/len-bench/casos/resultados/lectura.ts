// Cómo se LEE lo que dijo Len en los casos de resultados (plans/len-resultados/).
// Puro y con su prueba: un patrón demasiado laxo aprueba lo que debía cazar, y
// eso se descubre gastando.
import type { ContextoDeCalificacion } from "../../tipos";

/** Lo que dijo Len en la corrida, mensaje a mensaje. */
export const deLen = (ctx: Pick<ContextoDeCalificacion, "conversacion">): string[] =>
  ctx.conversacion.filter((x) => x.quien === "len").map((x) => x.texto);

/**
 * ¿Dijo que HOY lleva `n`? El número tiene que ser de «hoy»: o va detrás de
 * «hoy» sin otra cifra en medio («Hoy, hasta ahora, llevas 3 visitas»), o justo
 * delante de «visitas hoy» («llevas 3 visitas hoy»). Así «Hoy llevas 0
 * visitas; ayer, 3» y «Ayer tuviste 3 visitas y hoy ninguna» —la trampa de
 * contar en UTC— NO pasan aunque digan «hoy» y «3».
 */
export function diceHoy(textos: readonly string[], n: number, enLetra: string): boolean {
  const num = `(?:${n}|${enLetra})`;
  const detras = new RegExp(`\\bhoy\\b[^0-9.;\\n]{0,60}\\b${num}\\b`, "i");
  const delante = new RegExp(`\\b${num}\\s+(?:visitas?|personas?)\\s+(?:hoy|en lo que va de hoy)\\b`, "i");
  return textos.some((t) => detras.test(t) || delante.test(t));
}

/** ¿Llamó «ayer» a algo de HOY? Medido en el humo del 30/09, 3 de 3: con el HOY
 *  en UTC, «ayer (30 de septiembre) te escribió Juan» a las 19:25 del 30. */
export function diceAyer(texto: string): boolean {
  return /\bayer\b/i.test(texto);
}

/** ¿Se inventó DE DÓNDE salen las visitas? Medido en el humo del 30/09, 3 de 3:
 *  «esas visitas son de previsualizaciones» (falso: el contador sólo va en la
 *  publicada). Busca la AFIRMACIÓN, no la palabra: «el editor y la vista
 *  previa no suman visitas» es verdad y no cuenta. */
export function inventaDeDonde(textos: readonly string[]): boolean {
  const afirma = /\b(?:son|vienen|salen|eran|serían|provienen)\b[^.\n]{0,40}\b(?:previsualizaci\w*|(?:la )?vista previa|del editor|de pruebas)\b/i;
  return textos.some((t) => afirma.test(t));
}

// `\b` de JavaScript no cuenta la «á» como letra: «está\b» no casa. El final
// de la palabra se mira con `(?!\p{L})`. «No está publicada» es un dato del
// estado del proyecto, no de lo que hay dentro: no cuenta.
const VERBO_QUE_NIEGA = String.raw`(?:est[aá](?!\s+publicad)(?:\s+escrit\w+)?|aparece|sale|viene|figura|l[oa]\s+menciona|menciona|l[oa]\s+tiene|tiene|hay)(?!\p{L})`;
const PAGINA = String.raw`(?:p[aá]gina|web|sitio)`;
const DICE_DE_LA_PAGINA = [
  // «ese horario no está en tu página», «no hay ningún horario en la web»
  new RegExp(String.raw`\bno\s+${VERBO_QUE_NIEGA}[^.\n]{0,30}?\b(?:tu|la|esta)\s+${PAGINA}\b`, "iu"),
  // «…en la página, que ahora mismo no aparece / no lo menciona»
  new RegExp(String.raw`\b${PAGINA}\b[^.\n]{0,30}?\bno\s+${VERBO_QUE_NIEGA}`, "iu"),
  // «No toqué la página: el horario no está escrito en ella»
  new RegExp(String.raw`\bno\s+${VERBO_QUE_NIEGA}[^.\n]{0,30}?\ben\s+ella\b`, "iu"),
  // «No tengo tu horario en la página»
  new RegExp(String.raw`\bno\s+tengo\b[^.\n]{0,30}?\b(?:en|de)\s+(?:tu|la)\s+${PAGINA}\b`, "i"),
  // Nombrar una parte: «la sección de contacto», «el apartado de horarios». No
  // proponer una NUEVA: «te añado una sección de horarios» (30/09, #4, #9, #10).
  /(?<!\b(?:una|un|otra|nueva|nuevo)\s+)\b(?:secci[oó]n|apartado)\b/i,
];

/**
 * ¿Dice cómo ES la página —qué tiene, qué le falta, cómo se llaman sus
 * partes—? Devuelve el trozo que lo dice, o `null`. Ofrecerle algo sin
 * describirla («si quieres que aparezca en la página, lo añado») no cuenta.
 * Medido la noche del 30/09 en mensaje-de-juan: 7 de 10 lo decían, 5 sin haber
 * leído la página en toda la conversación.
 *
 * En CONDICIONAL no afirma nada: «si el horario no está en la página, puedo
 * añadirlo» es justo el «no la describas» del arreglo, y salió en 4 de 10 al
 * medirlo. Cuenta como condicional si la misma frase —desde la última
 * puntuación— lleva un «si» antes de lo que dice. El de cortesía no: en «si
 * quieres, lo pongo en la página, que ahora no aparece» el «no aparece» SÍ se
 * afirma.
 */
// Tampoco el de «miré si estaba en tu página y no aparece»: eso dice lo que
// comprobó, y es justo lo que hay que contrastar con lo que de verdad miró.
const SI_DE_HECHO =
  /(?<!\b(?:mir[eé]|busqu[eé]|comprob[eé]|revis[eé]|vi|ver|mirar|buscar|comprobar|revisar)(?:\s+\p{L}+)?\s+)\bsi\b(?!\s+(?:quieres|te parece|prefieres|lo prefieres|me dices|te sirve|lo deseas|te va))/iu;

export function afirmaDeLaPagina(textos: readonly string[]): string | null {
  for (const t of textos) {
    for (const re of DICE_DE_LA_PAGINA) {
      for (const m of t.matchAll(new RegExp(re.source, `${re.flags}g`))) {
        const inicioDeLaFrase = Math.max(...[".", ";", ":", "!", "?", "\n", "—", "("].map((p) => t.lastIndexOf(p, m.index))) + 1;
        if (SI_DE_HECHO.test(t.slice(inicioDeLaFrase, m.index + m[0].length))) continue;
        return m[0];
      }
    }
  }
  return null;
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Las secciones que nombra y que la página no tiene: «lo añado a la sección de
 * contacto» en una panadería sin sección de contacto (30/09, 3 de 10, una de
 * ellas DESPUÉS de buscar con Grep). Decir que NO hay una («no hay ninguna
 * sección de horarios») no es inventársela. Una sección «está» si su palabra
 * —sin acentos, por la raíz de seis letras— aparece en el HTML de la página.
 */
export function seccionesQueNoEstan(textos: readonly string[], html: string): string[] {
  const pagina = sinAcentos(html);
  // Lo que no da por hecho que existe: negarla («ninguna sección de…») o
  // proponer una NUEVA («una sección de horarios», 30/09, #4, #9, #10).
  const nombra = /\b(ningun[ao]?\s+|no\s+hay\s+(?:una\s+|un\s+)?|sin\s+|una\s+(?:nueva\s+)?|un\s+(?:nuevo\s+)?|otra\s+|nueva\s+)?(?:secci[oó]n(?:es)?|apartados?)\s+(?:de\s+(?:l[oa]s?\s+)?)?(\p{L}+)/giu;
  const faltan: string[] = [];
  for (const t of textos) {
    for (const m of t.matchAll(nombra)) {
      if (m[1]) continue;
      const palabra = m[2]!.toLowerCase();
      if (!pagina.includes(sinAcentos(palabra).slice(0, 6)) && !faltan.includes(palabra)) faltan.push(palabra);
    }
  }
  return faltan;
}

/** Contarle sus resultados sin que los pida: nombrar a quien escribió, o
 *  hablar de mensajes o formularios nuevos, o de visitas. «tus visitantes» NO
 *  cuenta —es una forma normal de hablar de una página—, ni «el mensaje de
 *  WhatsApp» del botón. Devuelve los patrones que casaron. */
export function leCuentaResultados(textos: readonly string[], nombres: readonly string[]): string[] {
  const t = textos.join("\n");
  const patrones = [
    ...nombres.map((n) => new RegExp(`\\b${n}\\b`)),
    /\b(?:mensajes?|formularios?)\b[^.\n]{0,40}\b(?:nuevos?|sin leer|sin ver|pendientes?)\b/i,
    /\bvisitas\b/i,
  ];
  return patrones.filter((re) => re.test(t)).map(String);
}
