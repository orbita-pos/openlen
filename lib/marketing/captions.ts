import type { PostData } from "./fill";
import type { PostGoal, PostRegister } from "./post-templates/families";

export interface CaptionPart { text: string; needs?: (keyof PostData)[]; }
export interface CaptionFormula {
  register: PostRegister; goal: PostGoal; lang: "es" | "en"; parts: CaptionPart[];
}

export const HASHTAGS: Record<PostRegister, Record<"es" | "en", string[]>> = {
  general: {
    es: ["#negociolocal", "#hechoenmexico", "#apoyalocal", "#emprendedores"],
    en: ["#shoplocal", "#smallbusiness", "#supportlocal", "#community"],
  },
  restaurante: {
    es: ["#foodie", "#antojo", "#comidamexicana", "#dondecomer"],
    en: ["#foodie", "#eatlocal", "#goodeats", "#foodlover"],
  },
  belleza: {
    es: ["#belleza", "#selfcare", "#salondebelleza", "#estilo"],
    en: ["#beauty", "#selfcare", "#salon", "#style"],
  },
  gym: {
    es: ["#fitness", "#entrena", "#gym", "#nopainnogain"],
    en: ["#fitness", "#training", "#gymlife", "#noexcuses"],
  },
  consultorio: {
    es: ["#salud", "#bienestar", "#cita", "#especialistas"],
    en: ["#health", "#wellness", "#booknow", "#specialists"],
  },
  tienda: {
    es: ["#compralocal", "#nuevacoleccion", "#tienda", "#envios"],
    en: ["#shoplocal", "#newarrivals", "#boutique", "#shopsmall"],
  },
  oficios: {
    es: ["#servicios", "#adomicilio", "#urgencias", "#confianza"],
    en: ["#services", "#homerepair", "#oncall", "#trusted"],
  },
};

const FORMULAS: CaptionFormula[] = [
  // ── general · promo · es ──
  { register: "general", goal: "promo", lang: "es", parts: [
    { text: "🎉 {offer} — solo en {businessName}.", needs: ["offer", "businessName"] },
    { text: "No te quedes con las ganas, es por tiempo limitado.", },
    { text: "Más info y detalles 👉 {url}", needs: ["url"] },
  ]},
  { register: "general", goal: "promo", lang: "es", parts: [
    { text: "Esta semana en {businessName}: {offer} 🔥", needs: ["businessName", "offer"] },
    { text: "Mándanos mensaje o visítanos — te esperamos.", },
    { text: "📲 {phone}", needs: ["phone"] },
  ]},
  { register: "general", goal: "promo", lang: "es", parts: [
    { text: "Lo prometido es deuda: {offer} ✨", needs: ["offer"] },
    { text: "Aparta el tuyo antes de que se acabe.", },
    { text: "Todo en {url}", needs: ["url"] },
  ]},

  // ── general · anuncio · es ──
  { register: "general", goal: "anuncio", lang: "es", parts: [
    { text: "¡Ya llegó! 🙌 Lo nuevo de {businessName}.", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "Entérate de todo en {url}", needs: ["url"] },
  ]},
  { register: "general", goal: "anuncio", lang: "es", parts: [
    { text: "Abrimos con nuevo horario en {businessName} 📅", needs: ["businessName"] },
    { text: "Ahora te atendemos: {hours}", needs: ["hours"] },
    { text: "Cualquier duda, escríbenos al {phone}", needs: ["phone"] },
  ]},
  { register: "general", goal: "anuncio", lang: "es", parts: [
    { text: "¿Todavía no nos conoces? Te presentamos {businessName} 👋", needs: ["businessName"] },
    { text: "Aquí trabajamos con ganas y con el corazón puesto en cada cliente.", },
    { text: "Conócenos en {url}", needs: ["url"] },
  ]},

  // ── general · testimonio · es ──
  { register: "general", goal: "testimonio", lang: "es", parts: [
    { text: "Esto dicen de nosotros 💬", },
    { text: "\"{offer}\" — así lo describió un cliente de {businessName}.", needs: ["offer", "businessName"] },
    { text: "Compruébalo tú mismo en {url}", needs: ["url"] },
  ]},
  { register: "general", goal: "testimonio", lang: "es", parts: [
    { text: "Gracias por la confianza 🙏", },
    { text: "Cada cliente que regresa a {businessName} nos alegra el día.", needs: ["businessName"] },
    { text: "Visítanos en {url}", needs: ["url"] },
  ]},
  { register: "general", goal: "testimonio", lang: "es", parts: [
    { text: "Otra historia feliz más 😊", },
    { text: "Nos encanta cuando un cliente sale contento de {businessName}.", needs: ["businessName"] },
    { text: "Ven y vive tu propia experiencia — {url}", needs: ["url"] },
  ]},

  // ── general · info · es ──
  { register: "general", goal: "info", lang: "es", parts: [
    { text: "¿Sabías que…? 👀", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Más detalles en {url}", needs: ["url"] },
  ]},
  { register: "general", goal: "info", lang: "es", parts: [
    { text: "Así trabajamos en {businessName} 🛠️", needs: ["businessName"] },
    { text: "Con calidad y atención en cada detalle, de principio a fin.", },
    { text: "Conoce nuestro proceso en {url}", needs: ["url"] },
  ]},
  { register: "general", goal: "info", lang: "es", parts: [
    { text: "Lo que siempre nos preguntan 📋 Aquí va la respuesta, de una vez:", },
    { text: "{offer}", needs: ["offer"] },
    { text: "¿Te quedó otra duda? Márcanos al {phone}", needs: ["phone"] },
  ]},

  // ── general · promo · en ──
  { register: "general", goal: "promo", lang: "en", parts: [
    { text: "🎉 {offer} — only at {businessName}.", needs: ["offer", "businessName"] },
    { text: "Don't miss out, this one's only around for a limited time.", },
    { text: "All the details 👉 {url}", needs: ["url"] },
  ]},
  { register: "general", goal: "promo", lang: "en", parts: [
    { text: "This week at {businessName}: {offer} 🔥", needs: ["businessName", "offer"] },
    { text: "Send us a message or swing by — we'd love to see you.", },
    { text: "📲 {phone}", needs: ["phone"] },
  ]},
  { register: "general", goal: "promo", lang: "en", parts: [
    { text: "We promised, we delivered: {offer} ✨", needs: ["offer"] },
    { text: "Grab yours before it's gone.", },
    { text: "Everything's here: {url}", needs: ["url"] },
  ]},

  // ── general · anuncio · en ──
  { register: "general", goal: "anuncio", lang: "en", parts: [
    { text: "It's here! 🙌 The newest thing at {businessName} just dropped.", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "Get all the details at {url}", needs: ["url"] },
  ]},
  { register: "general", goal: "anuncio", lang: "en", parts: [
    { text: "New hours at {businessName} 📅", needs: ["businessName"] },
    { text: "We're open: {hours}", needs: ["hours"] },
    { text: "Questions? Call or text {phone}", needs: ["phone"] },
  ]},
  { register: "general", goal: "anuncio", lang: "en", parts: [
    { text: "Haven't met us yet? Say hello to {businessName} 👋", needs: ["businessName"] },
    { text: "We show up every day and put real care into every customer.", },
    { text: "Get to know us at {url}", needs: ["url"] },
  ]},

  // ── general · testimonio · en ──
  { register: "general", goal: "testimonio", lang: "en", parts: [
    { text: "This is what people are saying about us 💬", },
    { text: "\"{offer}\" — straight from a {businessName} customer.", needs: ["offer", "businessName"] },
    { text: "See for yourself at {url}", needs: ["url"] },
  ]},
  { register: "general", goal: "testimonio", lang: "en", parts: [
    { text: "Thank you for trusting us 🙏", },
    { text: "Every customer who comes back to {businessName} reminds us why we do this.", needs: ["businessName"] },
    { text: "Come visit us at {url}", needs: ["url"] },
  ]},
  { register: "general", goal: "testimonio", lang: "en", parts: [
    { text: "Another happy customer 😊", },
    { text: "Nothing beats seeing someone leave {businessName} with a smile.", needs: ["businessName"] },
    { text: "Come have your own experience — {url}", needs: ["url"] },
  ]},

  // ── general · info · en ──
  { register: "general", goal: "info", lang: "en", parts: [
    { text: "Here's something most people don't know about us 👀", },
    { text: "{offer}", needs: ["offer"] },
    { text: "More details at {url}", needs: ["url"] },
  ]},
  { register: "general", goal: "info", lang: "en", parts: [
    { text: "Here's how we work at {businessName} 🛠️", needs: ["businessName"] },
    { text: "Quality and attention to detail, start to finish.", },
    { text: "See our process at {url}", needs: ["url"] },
  ]},
  { register: "general", goal: "info", lang: "en", parts: [
    { text: "The question we get asked the most 📋 Here's the answer:", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Still curious? Ask us anything at {phone}", needs: ["phone"] },
  ]},
];

export function listCaptions(register: PostRegister, goal: PostGoal, lang: "es" | "en"): CaptionFormula[] {
  const exact = FORMULAS.filter(f => f.register === register && f.goal === goal && f.lang === lang);
  if (exact.length > 0) return exact;
  return FORMULAS.filter(f => f.register === "general" && f.goal === goal && f.lang === lang);
}

export function fillCaption(formula: CaptionFormula, data: PostData): string {
  const body = formula.parts
    .filter(p => (p.needs ?? []).every(k => Boolean(data[k])))
    .map(p => p.text.replace(/\{([a-zA-Z]+)\}/g, (_, k: string) => String((data as Record<string, unknown>)[k] ?? "")))
    .join("\n\n");
  const tags = HASHTAGS[formula.register][formula.lang].slice(0, 6).join(" ");
  return body ? `${body}\n\n${tags}` : tags;
}
