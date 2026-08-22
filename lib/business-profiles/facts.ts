// lib/business-profiles/facts.ts — los datos REALES del negocio, en la forma en
// que se le dan a un modelo que escribe la página.
//
// POR QUÉ VIVE AQUÍ. Nació dentro de `app/api/generate/route.ts`, donde no podía
// compartirse: un fichero de ruta de Next sólo puede exportar los bindings de
// handler que reconoce, así que cualquier otra superficie que quisiera los
// mismos hechos tenía que reimplementarlos o quedarse sin ellos.
//
// Se quedó sin ellos. MEDIDO el 2026-08-21: la ruta de CREAR antepone estos
// hechos al brief, y la pestaña Chat ni siquiera seleccionaba `profileId` de la
// base. Efecto para el usuario: la página NACE con su teléfono y su dirección
// de verdad, y en cuanto pide por Chat «añádeme una sección de contacto», el
// modelo INVENTA otros — sobre la misma página.
//
// Nada de esto es opcional para el modelo: son los únicos datos de la página
// que no puede deducir ni mejorar. Por eso el bloque dice "NOT invented".

import type { BusinessProfileData } from "@/lib/business-profiles/types";

/**
 * El bloque `<business>` con los hechos reales, o `null` cuando el perfil no
 * tiene nada que decir.
 *
 * `null` NO es un fallo: significa "genera exactamente como antes de que
 * existieran los perfiles". Devolver un bloque vacío haría que el modelo
 * creyera que el negocio no tiene contacto, que es distinto de no saberlo.
 */
export function buildBusinessFacts(data: BusinessProfileData): string | null {
  const lines: string[] = [];
  const add = (label: string, v: string | null | undefined) => {
    if (typeof v === "string" && v.trim()) lines.push(`- ${label}: ${v.trim()}`);
  };
  add("Business name", data.business_name);
  add("What they do", data.industry);
  add("Tagline", data.tagline_es ?? data.tagline_en);
  add("Pitch", data.pitch);
  const c = data.contact;
  add("WhatsApp", c?.whatsapp);
  add("Phone", c?.phone);
  add("Email", c?.email);
  add("Address", c?.address);
  add("Instagram", c?.socials?.instagram);
  add("Facebook", c?.socials?.facebook);
  add("TikTok", c?.socials?.tiktok);
  add("Website", c?.socials?.website);
  if (lines.length === 0) return null;
  return `<business>
These are the user's REAL business details. Use them as the page's actual content — the business name, what they do, and any contact info must be these exact values, NOT invented. Weave the contact details into the page naturally (e.g. a contact section / footer). Do not fabricate other contact methods.
${lines.join("\n")}
</business>`;
}
