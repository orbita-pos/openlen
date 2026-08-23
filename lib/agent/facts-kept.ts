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
export function avisoHechosPerdidos(perdidos: readonly HechoPerdido[]): string {
  const lista = perdidos
    .slice(0, MAX_NOMBRADOS)
    .map((p) => `${p.tipo}: ${p.valor}`)
    .join(" · ");
  const resto =
    perdidos.length > MAX_NOMBRADOS ? ` (y ${perdidos.length - MAX_NOMBRADOS} más)` : "";
  return `El rediseño PERDIÓ ${perdidos.length} dato(s) REAL(es) del dueño que sí estaban en la página anterior: ${lista}${resto}. No son decoración: una foto o un enlace que desaparece es trabajo suyo borrado, y no puedes re-inventarlos. Repónlos AHORA, en este mismo turno, con editar_pagina (pide leer_estado incluir_documento=true para tener ids frescos) — colócalos donde encajen en el diseño nuevo, con la URL EXACTA. Y NO le digas al usuario que el rediseño está listo hasta que estén de vuelta.`;
}
