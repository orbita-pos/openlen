// LO QUE EL MODELO APRENDE DEL NEGOCIO, escrito donde el CÓDIGO puede usarlo.
//
// EL PROBLEMA. Le dices tu WhatsApp al Agente y él lo pone en la página — pero
// no lo guarda en ningún sitio. Mañana, en otro proyecto, te lo vuelve a
// preguntar. Y el botón flotante de WhatsApp, la banda de plataformas y el
// pie que se hornea al publicar leen el PERFIL, no la conversación: un teléfono
// que sólo vive en el HTML de una página es un teléfono que ninguna de esas
// tres cosas encuentra.
//
// Hasta hoy el perfil sólo se llenaba a mano, en un formulario. Jesús,
// 2026-08-27: la lección de v0 no es «usa markdown», es que **el usuario nunca
// rellena un formulario para enseñarle algo a la IA**.
//
// POR QUÉ CAMPOS Y NO PROSA. Estos datos tienen un consumidor de CÓDIGO:
// `contact.whatsapp` es lo que `contact-widget.ts` mete en el `wa.me`;
// `socials` es lo que arma la banda de plataformas. Un teléfono en prosa es un
// teléfono que no se puede enlazar. Lo que no tiene consumidor —«vendemos
// blackwork, no color»— es otra cosa y va en otro sitio.

import type { BusinessProfileData } from "./types";

/**
 * Los campos que el Agente puede escribir. Lista CERRADA, y a propósito.
 *
 * Con claves libres el modelo inventaría `color_favorito` o `horario_verano`:
 * se guardarían, nadie los leería, y el usuario creería que se tuvieron en
 * cuenta. Un campo sin consumidor es una promesa que no se cumple.
 *
 * Todos éstos los lee `buildBusinessFacts` —que se los da al modelo marcados
 * como «NOT invented»— y la mayoría, además, código de publicación.
 */
export const CAMPOS_APRENDIBLES = [
  "nombre",
  "rubro",
  "lema",
  "whatsapp",
  "telefono",
  "email",
  "direccion",
  "instagram",
  "facebook",
  "tiktok",
  "web",
] as const;

export type CampoAprendible = (typeof CAMPOS_APRENDIBLES)[number];

export type ResultadoAprender =
  | { ok: true; data: BusinessProfileData; anterior: string | null; cambio: boolean }
  | { ok: false; motivo: "campo_desconocido" | "valor_vacio" | "valor_largo" };

/** Un dato de contacto no es un párrafo. Corta lo que sea un texto disfrazado
 *  de dato —«llámanos de 9 a 6 y si no contesta escribe al otro»— que no cabe
 *  en un `wa.me` ni en un `mailto:`. */
const MAX_VALOR = 200;

/**
 * Escribe UN dato en el perfil y devuelve el perfil nuevo.
 *
 * PURA: no toca la base. Quien llama guarda — así esto se prueba sin bindings
 * y la decisión de «qué se escribe» queda separada de «dónde se guarda».
 *
 * SOBRESCRIBE, y devuelve lo que había. Un teléfono tiene un valor, no una
 * lista: acumularlos daría un perfil con tres WhatsApps y ninguna forma de
 * saber cuál es el bueno. Pero `anterior` viaja de vuelta para que el Agente
 * pueda decir «cambié el WhatsApp, antes tenías otro» — pisar un dato en
 * silencio es cómo se pierde el número que sí funcionaba.
 */
export function aprenderDelNegocio(
  data: BusinessProfileData,
  campo: string,
  valor: string,
): ResultadoAprender {
  if (!(CAMPOS_APRENDIBLES as readonly string[]).includes(campo)) {
    return { ok: false, motivo: "campo_desconocido" };
  }
  const limpio = valor.trim().replace(/\s*\n+\s*/g, " ");
  if (!limpio) return { ok: false, motivo: "valor_vacio" };
  if (limpio.length > MAX_VALOR) return { ok: false, motivo: "valor_largo" };

  const anterior = leer(data, campo as CampoAprendible);
  const nuevo = escribir(data, campo as CampoAprendible, limpio);
  return { ok: true, data: nuevo, anterior, cambio: anterior !== limpio };
}

function leer(data: BusinessProfileData, campo: CampoAprendible): string | null {
  const c = data.contact;
  const s = c?.socials;
  switch (campo) {
    case "nombre": return data.business_name ?? null;
    case "rubro": return data.industry ?? null;
    case "lema": return data.tagline_es ?? data.tagline_en ?? null;
    case "whatsapp": return c?.whatsapp ?? null;
    case "telefono": return c?.phone ?? null;
    case "email": return c?.email ?? null;
    case "direccion": return c?.address ?? null;
    case "instagram": return s?.instagram ?? null;
    case "facebook": return s?.facebook ?? null;
    case "tiktok": return s?.tiktok ?? null;
    case "web": return s?.website ?? null;
  }
}

/** Copia, nunca muta: el perfil que entra puede venir de una caché compartida,
 *  y mutarlo cambiaría lo que otro lector ya tiene en la mano. */
function escribir(
  data: BusinessProfileData,
  campo: CampoAprendible,
  valor: string,
): BusinessProfileData {
  // COMPLETOS, no parciales. El contacto y las redes declaran las cuatro claves
  // como `string | null`, no opcionales: un objeto a medias no encaja en el
  // tipo, y encaje aparte, `undefined` y `null` se leen distinto aguas abajo —
  // uno significa «no lo sé» y el otro «no tiene».
  const c = data.contact;
  const s = c?.socials;
  const redes = {
    instagram: s?.instagram ?? null,
    facebook: s?.facebook ?? null,
    tiktok: s?.tiktok ?? null,
    website: s?.website ?? null,
  };
  const contacto = {
    whatsapp: c?.whatsapp ?? null,
    phone: c?.phone ?? null,
    email: c?.email ?? null,
    address: c?.address ?? null,
    socials: redes,
  };
  switch (campo) {
    case "nombre": return { ...data, business_name: valor };
    case "rubro": return { ...data, industry: valor };
    // El lema en español es el que `buildBusinessFacts` prefiere; escribir el
    // inglés dejaría el dato guardado y sin efecto en el prompt.
    case "lema": return { ...data, tagline_es: valor };
    case "whatsapp": contacto.whatsapp = valor; break;
    case "telefono": contacto.phone = valor; break;
    case "email": contacto.email = valor; break;
    case "direccion": contacto.address = valor; break;
    case "instagram": redes.instagram = valor; break;
    case "facebook": redes.facebook = valor; break;
    case "tiktok": redes.tiktok = valor; break;
    case "web": redes.website = valor; break;
  }
  return { ...data, contact: contacto };
}
