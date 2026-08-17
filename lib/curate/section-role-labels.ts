import type { CanonicalSectionRole } from "@/lib/generation/structural-taxonomy";

/**
 * Section roles, said in the reader's language.
 *
 * The baseline's placeholder copy used to title its cards with the role slug
 * itself (`role.replace(/_/g, " ")`), so a page whose fill did not cover every
 * slot showed the user "call to action" and "how it works" as headings — our
 * vocabulary, in English, on a Spanish page.
 *
 * A table is safe here for one reason only: `CANONICAL_SECTION_ROLES` is a
 * CLOSED set, and `Record<CanonicalSectionRole, …>` makes the compiler refuse a
 * new role that nobody translated. The same is NOT true of `emotionalGoals`,
 * which is `TaxonomyListSchema` — any slug the model invents — which is why
 * that one has no table and never reaches visible copy at all.
 */
const LABELS: Record<CanonicalSectionRole, { es: string; en: string }> = {
  header: { es: "Inicio", en: "Home" },
  hero: { es: "Presentación", en: "Introduction" },
  about: { es: "Quiénes somos", en: "About us" },
  services: { es: "Servicios", en: "Services" },
  features: { es: "Qué incluye", en: "What's included" },
  how_it_works: { es: "Cómo funciona", en: "How it works" },
  programs: { es: "Programas", en: "Programs" },
  menu: { es: "Menú", en: "Menu" },
  events: { es: "Eventos", en: "Events" },
  reservations: { es: "Reservas", en: "Reservations" },
  booking: { es: "Agendar", en: "Booking" },
  schedule: { es: "Horarios", en: "Schedule" },
  pricing: { es: "Precios", en: "Pricing" },
  team: { es: "El equipo", en: "The team" },
  testimonials: { es: "Lo que dicen", en: "What people say" },
  gallery: { es: "Galería", en: "Gallery" },
  clients: { es: "Clientes", en: "Clients" },
  profile_summary: { es: "Perfil", en: "Profile" },
  link_list: { es: "Enlaces", en: "Links" },
  featured_content: { es: "Destacado", en: "Featured" },
  content_list: { es: "Contenido", en: "Content" },
  social_links: { es: "Redes", en: "Social" },
  faq: { es: "Preguntas frecuentes", en: "Frequently asked questions" },
  contact: { es: "Contacto", en: "Contact" },
  call_to_action: { es: "Da el paso", en: "Take the next step" },
  footer: { es: "Pie de página", en: "Footer" },
  coloring_gallery: { es: "Dibujos para colorear", en: "Colouring pages" },
  minigames: { es: "Juegos", en: "Games" },
  stories: { es: "Cuentos", en: "Stories" },
  activities: { es: "Actividades", en: "Activities" },
  products: { es: "Productos", en: "Products" },
  integrations: { es: "Integraciones", en: "Integrations" },
  use_cases: { es: "Casos de uso", en: "Use cases" },
  case_studies: { es: "Casos reales", en: "Case studies" },
  membership: { es: "Membresía", en: "Membership" },
  location: { es: "Dónde estamos", en: "Where we are" },
  blog: { es: "Blog", en: "Blog" },
  news: { es: "Novedades", en: "News" },
  newsletter: { es: "Boletín", en: "Newsletter" },
};

/** A role outside the taxonomy is described neutrally rather than shown raw:
 *  an unknown slug is still our vocabulary, and the point is that ours never
 *  reaches the page. */
export function sectionRoleLabel(role: CanonicalSectionRole, language: "es" | "en"): string {
  const entry = LABELS[role];
  if (entry) return entry[language];
  return language === "es" ? "Sección" : "Section";
}
