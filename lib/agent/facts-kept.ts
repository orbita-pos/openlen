// lib/agent/facts-kept.ts — los HECHOS del dueño sobreviven a una reescritura.
//
// POR QUÉ EXISTE. El prompt del rediseño lleva la regla escrita y en mayúsculas
// («CONSERVA los hechos… y TODA URL real (href e img src)»). MEDIDO el
// 2026-08-22, n=20 con el modelo real: `redisenar_pagina` perdió la URL de la
// FOTO del dueño en 8 de 20 turnos (40%, IC 95% 22-61%) y una dirección en 2.
//
// Es la misma lección que costó el `target="runtime"`: el modelo lee el aviso,
// lo parafrasea bien y hace otra cosa. Un agujero estructural no se tapa
// pidiendo por favor — hace falta comprobarlo.
//
// QUÉ CUENTA COMO HECHO. Sólo lo que un humano tendría que volver a teclear y
// que no se puede re-derivar: una URL de imagen, un enlace externo, un teléfono.
// NO el copy, ni los titulares, ni el orden de las secciones — eso es
// justamente lo que el dueño pidió que cambiara. La lista es corta a propósito:
// una regla que dispara de más convierte todo rediseño en un rechazo, y
// entonces alguien la apaga.
//
// PURO: cadenas a cadenas, sin red, sin base, sin navegador.

/** Un dato del documento viejo que no está en el nuevo. */
export interface HechoPerdido {
  readonly tipo: "imagen" | "enlace" | "telefono";
  readonly valor: string;
}

/** Cuántos se le nombran al modelo. Con seis ya sabe qué reponer; una lista más
 *  larga es la que se hojea en vez de leerse. */
const MAX_NOMBRADOS = 6;

function urlsDeImagen(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<img\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)) {
    const u = m[1]!.trim();
    // Un data: URI no es un hecho: no hay nada que el dueño tuviera que volver
    // a buscar, y comparar cadenas de kilobytes no aporta.
    if (u && !u.startsWith("data:")) out.add(u);
  }
  // `background-image:url(...)` cuenta igual — una foto puesta por CSS es una
  // foto, y el rediseño la mueve al mismo sitio que las demás.
  for (const m of html.matchAll(/url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/gi)) {
    out.add(m[1]!.trim());
  }
  return [...out];
}

function enlacesExternos(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*\shref\s*=\s*["']([^"']+)["']/gi)) {
    const h = m[1]!.trim();
    // Sólo destinos REALES del dueño: su WhatsApp, su Instagram, su tienda. Un
    // ancla interna (#servicios) o una ruta del propio sitio (/menu) se
    // reorganizan legítimamente en un rediseño.
    if (/^(https?:|mailto:|tel:)/i.test(h)) out.add(h);
  }
  return [...out];
}

/** Teléfonos escritos en el TEXTO, no en un `tel:`. Se normalizan a dígitos
 *  porque el rediseño puede reformatear («55 1234 5678» → «(55) 1234-5678») y
 *  eso NO es perder el hecho: el número sigue ahí. */
function telefonos(html: string): string[] {
  const texto = html.replace(/<[^>]+>/g, " ");
  const out = new Set<string>();
  for (const m of texto.matchAll(/(?:\+?\d[\d\s().-]{7,17}\d)/g)) {
    const digitos = m[0].replace(/\D/g, "");
    if (digitos.length >= 8 && digitos.length <= 15) out.add(digitos);
  }
  return [...out];
}

function soloDigitos(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\D/g, "");
}

/**
 * Lo que estaba en `antes` y ya no está en `despues`.
 *
 * Vacío ⇒ nada que decir, y quien llama sigue exactamente como antes de que
 * esta comprobación existiera.
 */
export function hechosPerdidos(antes: string, despues: string): HechoPerdido[] {
  const perdidos: HechoPerdido[] = [];

  for (const u of urlsDeImagen(antes)) {
    if (!despues.includes(u)) perdidos.push({ tipo: "imagen", valor: u });
  }
  for (const h of enlacesExternos(antes)) {
    if (!despues.includes(h)) perdidos.push({ tipo: "enlace", valor: h });
  }
  // Los teléfonos se buscan sobre los dígitos del documento nuevo, así que un
  // reformateo no cuenta como pérdida.
  const digitosNuevos = soloDigitos(despues);
  for (const t of telefonos(antes)) {
    if (!digitosNuevos.includes(t)) perdidos.push({ tipo: "telefono", valor: t });
  }
  return perdidos;
}

/**
 * El aviso PARA EL MODELO, en el mismo turno.
 *
 * No se rechaza el rediseño: la página nueva es lo que el usuario pidió y
 * tirarla entera por una foto sería peor que la pérdida. Se le nombra lo que
 * falta y se le dice que lo reponga AHORA — que es lo que ya se hace con las
 * conductas mal cableadas (`aviso_critico`), y funciona.
 */
/**
 * LO MISMO, PERO PARA UNA EDICIÓN — donde SUSTITUIR es una petición normal.
 *
 * POR QUÉ NO VALE `hechosPerdidos` TAL CUAL. En un rediseño, que una foto
 * desaparezca es siempre sospechoso: nadie pide «rediseña esto» queriendo
 * perder su fachada. En una edición no: «cambia la foto por esta otra» es de
 * las peticiones más comunes que hay, y ahí la URL vieja SE VA porque se lo
 * pidieron. Avisar de eso enseña al modelo —y al dueño— a ignorar el aviso, que
 * es cómo muere una guarda.
 *
 * LA REGLA: se cuenta por tipo, y sólo se habla cuando el tipo tiene MENOS que
 * antes. Sustituir deja la cuenta igual y calla; quitar la baja y suena. Un
 * turno que sustituye una y quita otra baja la cuenta en uno y nombra las dos
 * — nombrar de más ahí es correcto: el modelo tiene el turno para decidir cuál
 * repone, y el aviso le pide exactamente eso.
 *
 * EL FALLO QUE LO TRAE (2026-09-03, medido en el conductor multiturno). Jesús
 * lo llevaba repitiendo desde hacía semanas: «¿por qué quita la foto?». La
 * respuesta era que NADIE MIRABA. La regla escrita («CONSERVA … TODA URL real»)
 * y la comprobación (`hechosPerdidos`) existían las dos — y las dos colgaban de
 * `redisenar_pagina`. El Agente vive en `editar_pagina` y no la llamó ni una vez
 * en seis turnos seguidos. Una guarda en la herramienta equivocada es
 * indistinguible de no tener guarda.
 */
export function hechosPerdidosNetos(antes: string, despues: string): HechoPerdido[] {
  const perdidos = hechosPerdidos(antes, despues);
  if (perdidos.length === 0) return [];
  const antesPorTipo: Record<HechoPerdido["tipo"], number> = {
    imagen: urlsDeImagen(antes).length,
    enlace: enlacesExternos(antes).length,
    telefono: telefonos(antes).length,
  };
  const despuesPorTipo: Record<HechoPerdido["tipo"], number> = {
    imagen: urlsDeImagen(despues).length,
    enlace: enlacesExternos(despues).length,
    telefono: telefonos(despues).length,
  };
  return perdidos.filter((p) => despuesPorTipo[p.tipo] < antesPorTipo[p.tipo]);
}

/**
 * El aviso de la EDICIÓN. Hermano de `avisoHechosPerdidos`, con otra doctrina.
 *
 * No se rechaza la edición y no se le acusa: quitar la foto pudo ser justo lo
 * que le pidieron. Se le nombra lo que ya no está y se le dan las DOS salidas
 * — reponerlo, o decírselo al usuario —, que es la misma forma que ya tiene el
 * aviso de los formularios perdidos y funciona.
 */
export function avisoHechosPerdidosEnEdicion(perdidos: readonly HechoPerdido[]): string {
  const lista = perdidos
    .slice(0, MAX_NOMBRADOS)
    .map((p) => `${p.tipo}: ${p.valor}`)
    .join(" · ");
  const resto =
    perdidos.length > MAX_NOMBRADOS ? ` (y ${perdidos.length - MAX_NOMBRADOS} más)` : "";
  return `Esta edición ha QUITADO ${perdidos.length} dato(s) real(es) del dueño que la página SÍ tenía: ${lista}${resto}. No son decoración: una foto o un enlace que desaparece es trabajo suyo borrado, y la dirección no te la puedes re-inventar. Si quitarlo NO era lo que te pidieron —pasa al arreglar el contraste: se tapa o se sustituye la imagen que estorba, y con ella se va la foto que el dueño quería—, reponlo AHORA, en este mismo turno, con la URL EXACTA. Si SÍ era lo que te pidieron, DÍSELO al usuario en tu respuesta.`;
}

/**
 * ¿LA META DESCRIPTION QUEDÓ DESFASADA?
 *
 * Devuelve los datos de contacto que la meta sigue anunciando y que ya NO
 * existen en el cuerpo del documento.
 *
 * POR QUÉ. MEDIDO el 2026-08-22 con los ataques de QA: «cambia nuestro teléfono
 * en TODA la página» actualizaba el texto, el `tel:` y el WhatsApp, y dejaba el
 * número viejo en la meta description — 3 de 3 veces. Con el objetivo
 * `target="head"` abierto pasó a 1 de 3: un camino que existe y no siempre se
 * toma. Pedirlo no basta; esto lo hace COMPROBABLE.
 *
 * No es cosmético: la meta description es el fragmento que enseña Google, así
 * que un teléfono muerto ahí son llamadas que nunca entran. Y es el fallo
 * silencioso perfecto — la página se ve impecable.
 *
 * Sólo teléfonos y correos: un dato de contacto que desapareció del cuerpo es
 * inequívocamente viejo. Del resto del texto no se puede decir lo mismo —
 * reescribir un eslogan no deja la meta «mal», la deja distinta.
 */
export function metaDesfasada(html: string): string[] {
  const meta = /<meta[^>]*\sname\s*=\s*["']description["'][^>]*\scontent\s*=\s*["']([^"']*)["']/i
    .exec(html)?.[1];
  if (!meta) return [];
  const cuerpoAt = html.toLowerCase().indexOf("<body");
  const cuerpo = cuerpoAt === -1 ? html : html.slice(cuerpoAt);
  const digitosCuerpo = cuerpo.replace(/\D/g, "");
  const fuera: string[] = [];

  for (const m of meta.matchAll(/(?:\+?\d[\d\s().-]{7,17}\d)/g)) {
    const d = m[0].replace(/\D/g, "");
    if (d.length >= 8 && d.length <= 15 && !digitosCuerpo.includes(d)) fuera.push(m[0].trim());
  }
  for (const m of meta.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)) {
    if (!cuerpo.includes(m[0])) fuera.push(m[0]);
  }
  return fuera;
}

/** El aviso PARA EL MODELO cuando la meta se quedó atrás. */
export function avisoMetaDesfasada(viejos: readonly string[]): string {
  return `La <meta name="description"> sigue anunciando ${viejos.join(" y ")}, y eso ya NO está en la página. Ese es el texto que enseña Google: ahí quedaría un dato muerto que le cuesta clientes al dueño. Corrígela AHORA, en este mismo turno, con un edit target="head" que lleve la <meta name="description"> completa y actualizada.`;
}

export function avisoHechosPerdidos(perdidos: readonly HechoPerdido[]): string {
  const lista = perdidos
    .slice(0, MAX_NOMBRADOS)
    .map((p) => `${p.tipo}: ${p.valor}`)
    .join(" · ");
  const resto =
    perdidos.length > MAX_NOMBRADOS ? ` (y ${perdidos.length - MAX_NOMBRADOS} más)` : "";
  return `El rediseño PERDIÓ ${perdidos.length} dato(s) REAL(es) del dueño que sí estaban en la página anterior: ${lista}${resto}. No son decoración: una foto o un enlace que desaparece es trabajo suyo borrado, y no puedes re-inventarlos. Repónlos AHORA, en este mismo turno, con editar_texto o editar_html (pide leer_estado incluir_documento=true para tener ids frescos) — colócalos donde encajen en el diseño nuevo, con la URL EXACTA. Y NO le digas al usuario que el rediseño está listo hasta que estén de vuelta.`;
}
