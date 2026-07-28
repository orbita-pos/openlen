// El bloque `negocio` del ESTADO del agente (P2 — "el agente sabe quién es el
// dueño"). El producto YA recolecta el perfil del negocio («Mi negocio»:
// nombre, rubro, contacto, redes) y curate lo usa al crear la página — pero el
// agente no lo recibía: "pon mi WhatsApp arriba" no tenía de dónde sacar el
// número si no estaba ya en el HTML, y "escribe la sección nosotros" inventaba
// un negocio genérico.
//
// Módulo PURO (cero imports de db/nativos) para que context/route/tools lo
// compartan y vitest lo cargue sin el binding — la misma disciplina que
// lib/agent/context.ts. El caller (route / leer_estado) hace el I/O.
//
// Deliberadamente COMPACTO: identidad + contacto + links. features/pricing/
// testimonials del perfil NO viajan (bulk que casi ningún turno usa — la
// página ya los refleja; si un turno los necesita, el modelo pregunta). Cada
// campo va solo si tiene valor real: un perfil vacío produce null y el ESTADO
// queda byte-idéntico al de antes de P2.

import type { BusinessProfileData } from "@/lib/business-profiles/types";

const MAX_LINKS = 6;

function s(v: string | null | undefined): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t.length > 0 ? t : null;
}

export function summarizeBusinessForAgent(
  data: BusinessProfileData | null | undefined,
): Record<string, unknown> | null {
  if (!data) return null;

  const out: Record<string, unknown> = {};
  const nombre = s(data.business_name);
  const rubro = s(data.industry);
  const tagline = s(data.tagline_es) ?? s(data.tagline_en);
  const pitch = s(data.pitch);
  if (nombre) out.nombre = nombre;
  if (rubro) out.rubro = rubro;
  if (tagline) out.tagline = tagline;
  if (pitch) out.pitch = pitch;

  const c = data.contact;
  if (c) {
    const contacto: Record<string, string> = {};
    const whatsapp = s(c.whatsapp);
    const telefono = s(c.phone);
    const email = s(c.email);
    const direccion = s(c.address);
    if (whatsapp) contacto.whatsapp = whatsapp;
    if (telefono) contacto.telefono = telefono;
    if (email) contacto.email = email;
    if (direccion) contacto.direccion = direccion;
    if (Object.keys(contacto).length > 0) out.contacto = contacto;

    const socials = c.socials;
    if (socials) {
      const redes: Record<string, string> = {};
      for (const key of ["instagram", "facebook", "tiktok", "website"] as const) {
        const v = s(socials[key]);
        if (v) redes[key] = v;
      }
      if (Object.keys(redes).length > 0) out.redes = redes;
    }
  }

  const links = (data.links ?? [])
    .map((l) => ({ tipo: s(l.type) ?? "link", url: s(l.url) }))
    .filter((l): l is { tipo: string; url: string } => l.url !== null)
    .slice(0, MAX_LINKS);
  if (links.length > 0) out.links = links;

  return Object.keys(out).length > 0 ? out : null;
}
