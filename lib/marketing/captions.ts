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

  // ── restaurante · es ──
  { register: "restaurante", goal: "promo", lang: "es", parts: [
    { text: "Se antoja, ¿no? 🌮 {offer} — solo en {businessName}.", needs: ["offer", "businessName"] },
    { text: "Llega temprano, que las cazuelas no esperan a nadie.", },
    { text: "Checa el menú completo en {url}", needs: ["url"] },
  ]},
  { register: "restaurante", goal: "promo", lang: "es", parts: [
    { text: "Aviso importante para panzas exigentes: {offer} 🔥", needs: ["offer"] },
    { text: "En {businessName} el sabor no se negocia.", needs: ["businessName"] },
    { text: "Pide o reserva al {phone}", needs: ["phone"] },
  ]},
  { register: "restaurante", goal: "promo", lang: "es", parts: [
    { text: "Hoy sí se te antojó a buena hora: {offer}", needs: ["offer"] },
    { text: "Vente antes de que se acabe — lo bueno vuela.", },
    { text: "Todo en {url}", needs: ["url"] },
  ]},
  { register: "restaurante", goal: "anuncio", lang: "es", parts: [
    { text: "Hay algo nuevo en la cocina de {businessName} 👀", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "Ven a probarlo antes que nadie — {url}", needs: ["url"] },
  ]},
  { register: "restaurante", goal: "anuncio", lang: "es", parts: [
    { text: "¡Ya estamos listos para recibirte! 🍽️", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Aparta tu mesa al {phone}", needs: ["phone"] },
  ]},
  { register: "restaurante", goal: "anuncio", lang: "es", parts: [
    { text: "Si todavía no conoces {businessName}, esta es tu señal.", needs: ["businessName"] },
    { text: "Cocina honesta, porciones de verdad y trato de casa.", },
    { text: "Encuéntranos en {url}", needs: ["url"] },
  ]},
  { register: "restaurante", goal: "testimonio", lang: "es", parts: [
    { text: "\"Se come como en casa, pero mejor\" 🤍", },
    { text: "Gracias por decirlo — en {businessName} cocinamos para eso.", needs: ["businessName"] },
    { text: "Ven a comprobarlo: {url}", needs: ["url"] },
  ]},
  { register: "restaurante", goal: "testimonio", lang: "es", parts: [
    { text: "Cuando el plato regresa vacío, todo valió la pena 😊", },
    { text: "Gracias por llenarnos las mesas y el corazón.", },
    { text: "Reserva la tuya al {phone}", needs: ["phone"] },
  ]},
  { register: "restaurante", goal: "testimonio", lang: "es", parts: [
    { text: "Otro cliente que llegó por antojo y se quedó de casa 🙌", },
    { text: "Eso es lo que buscamos en {businessName}, cada día.", needs: ["businessName"] },
  ]},
  { register: "restaurante", goal: "info", lang: "es", parts: [
    { text: "Pregunta frecuente en {businessName} 📋", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "¿Otra duda? Márcanos al {phone}", needs: ["phone"] },
  ]},
  { register: "restaurante", goal: "info", lang: "es", parts: [
    { text: "Para que no te quedes con la duda 👇", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Horarios y menú completo en {url}", needs: ["url"] },
  ]},
  { register: "restaurante", goal: "info", lang: "es", parts: [
    { text: "Así trabajamos en {businessName}: ingredientes frescos, cero atajos.", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
  ]},

  // ── belleza · es ──
  { register: "belleza", goal: "promo", lang: "es", parts: [
    { text: "Tu momento de apapacho llegó ✨ {offer}", needs: ["offer"] },
    { text: "En {businessName} sales siendo tu mejor versión.", needs: ["businessName"] },
    { text: "Agenda tu cita en {url}", needs: ["url"] },
  ]},
  { register: "belleza", goal: "promo", lang: "es", parts: [
    { text: "Date el gusto, te lo has ganado: {offer} 💅", needs: ["offer"] },
    { text: "Los lugares se van rápido — no lo dejes para después.", },
    { text: "Aparta el tuyo al {phone}", needs: ["phone"] },
  ]},
  { register: "belleza", goal: "promo", lang: "es", parts: [
    { text: "Alerta de cambio de look 🚨 {offer}", needs: ["offer"] },
    { text: "Ven a {businessName} y sal estrenando confianza.", needs: ["businessName"] },
    { text: "Citas en {url}", needs: ["url"] },
  ]},
  { register: "belleza", goal: "anuncio", lang: "es", parts: [
    { text: "Nuevo en {businessName} ✨", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "Sé de las primeras en probarlo — {url}", needs: ["url"] },
  ]},
  { register: "belleza", goal: "anuncio", lang: "es", parts: [
    { text: "Noticia que te va a encantar 💫", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Agenda al {phone} y te apartamos lugar.", needs: ["phone"] },
  ]},
  { register: "belleza", goal: "anuncio", lang: "es", parts: [
    { text: "Si aún no conoces {businessName}, déjanos consentirte una vez.", needs: ["businessName"] },
    { text: "Con una visita entiendes por qué nuestras clientas regresan.", },
    { text: "Conócenos en {url}", needs: ["url"] },
  ]},
  { register: "belleza", goal: "testimonio", lang: "es", parts: [
    { text: "\"Salí sintiéndome otra\" 🤍 Y así queremos que salgan todas.", },
    { text: "Gracias por la confianza — en {businessName} se nota el cariño.", needs: ["businessName"] },
    { text: "Tu cita te espera en {url}", needs: ["url"] },
  ]},
  { register: "belleza", goal: "testimonio", lang: "es", parts: [
    { text: "Cuando una clienta se ve al espejo y sonríe, ganamos todas ✨", },
    { text: "Ven por tu momento: {phone}", needs: ["phone"] },
  ]},
  { register: "belleza", goal: "testimonio", lang: "es", parts: [
    { text: "Otra clienta feliz, otra razón para amar lo que hacemos 💕", },
    { text: "En {businessName} cada detalle cuenta.", needs: ["businessName"] },
  ]},
  { register: "belleza", goal: "info", lang: "es", parts: [
    { text: "Nos lo preguntan todo el tiempo 📋", },
    { text: "{offer}", needs: ["offer"] },
    { text: "¿Dudas? Escríbenos al {phone}", needs: ["phone"] },
  ]},
  { register: "belleza", goal: "info", lang: "es", parts: [
    { text: "Tip de {businessName} para que tu look dure más 👇", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
  ]},
  { register: "belleza", goal: "info", lang: "es", parts: [
    { text: "Así de fácil es agendar con nosotras:", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Todo en {url}", needs: ["url"] },
  ]},

  // ── gym · es ──
  { register: "gym", goal: "promo", lang: "es", parts: [
    { text: "Cero pretextos: {offer} 💪", needs: ["offer"] },
    { text: "En {businessName} el único mal entrenamiento es el que no haces.", needs: ["businessName"] },
    { text: "Inscríbete en {url}", needs: ["url"] },
  ]},
  { register: "gym", goal: "promo", lang: "es", parts: [
    { text: "Tu yo de diciembre te lo va a agradecer: {offer} 🔥", needs: ["offer"] },
    { text: "Empieza hoy, aunque sea con 30 minutos.", },
    { text: "Info al {phone}", needs: ["phone"] },
  ]},
  { register: "gym", goal: "promo", lang: "es", parts: [
    { text: "Se acabaron las excusas: {offer}", needs: ["offer"] },
    { text: "Vente a {businessName} — aquí nadie empieza siendo experto.", needs: ["businessName"] },
    { text: "Aparta tu lugar: {url}", needs: ["url"] },
  ]},
  { register: "gym", goal: "anuncio", lang: "es", parts: [
    { text: "Nuevo en {businessName} 🏋️", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "Cupo limitado — detalles en {url}", needs: ["url"] },
  ]},
  { register: "gym", goal: "anuncio", lang: "es", parts: [
    { text: "Atención, team: esto les va a gustar 👇", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Pregunta por horarios al {phone}", needs: ["phone"] },
  ]},
  { register: "gym", goal: "anuncio", lang: "es", parts: [
    { text: "¿Todavía entrenando solo? En {businessName} se entrena en manada.", needs: ["businessName"] },
    { text: "Coaches que te empujan y compas que no te dejan rendirte.", },
    { text: "Ven por tu clase muestra: {url}", needs: ["url"] },
  ]},
  { register: "gym", goal: "testimonio", lang: "es", parts: [
    { text: "\"Llegué sin condición y hoy corro 10K\" 🏃", },
    { text: "Historias así se construyen en {businessName}, un día a la vez.", needs: ["businessName"] },
    { text: "Empieza la tuya: {url}", needs: ["url"] },
  ]},
  { register: "gym", goal: "testimonio", lang: "es", parts: [
    { text: "El progreso de nuestra gente es nuestra mejor publicidad 💪", },
    { text: "Ven a escribir el tuyo — {phone}", needs: ["phone"] },
  ]},
  { register: "gym", goal: "testimonio", lang: "es", parts: [
    { text: "Otro miembro que ya no se reconoce en las fotos de antes 🔥", },
    { text: "En {businessName} los resultados hablan solos.", needs: ["businessName"] },
  ]},
  { register: "gym", goal: "info", lang: "es", parts: [
    { text: "La duda que más nos llega 📋", },
    { text: "{offer}", needs: ["offer"] },
    { text: "¿Más preguntas? Mándanos mensaje al {phone}", needs: ["phone"] },
  ]},
  { register: "gym", goal: "info", lang: "es", parts: [
    { text: "Dato de {businessName} para entrenar mejor 👇", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
  ]},
  { register: "gym", goal: "info", lang: "es", parts: [
    { text: "Horarios, planes y todo lo que necesitas saber:", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Completo en {url}", needs: ["url"] },
  ]},

  // ── consultorio · es ──
  { register: "consultorio", goal: "promo", lang: "es", parts: [
    { text: "Tu salud no es un lujo: {offer}", needs: ["offer"] },
    { text: "En {businessName} te atendemos sin prisas y sin sorpresas.", needs: ["businessName"] },
    { text: "Agenda tu cita en {url}", needs: ["url"] },
  ]},
  { register: "consultorio", goal: "promo", lang: "es", parts: [
    { text: "Deja de posponerlo 🙌 {offer}", needs: ["offer"] },
    { text: "Una cita hoy te ahorra un problema mañana.", },
    { text: "Llámanos al {phone}", needs: ["phone"] },
  ]},
  { register: "consultorio", goal: "promo", lang: "es", parts: [
    { text: "Este mes en {businessName}: {offer}", needs: ["businessName", "offer"] },
    { text: "Precios claros y atención que sí escucha.", },
    { text: "Reserva en {url}", needs: ["url"] },
  ]},
  { register: "consultorio", goal: "anuncio", lang: "es", parts: [
    { text: "Novedades en {businessName} 🩺", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "Agenda o pregunta en {url}", needs: ["url"] },
  ]},
  { register: "consultorio", goal: "anuncio", lang: "es", parts: [
    { text: "Buenas noticias para tu salud 👇", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Citas al {phone}", needs: ["phone"] },
  ]},
  { register: "consultorio", goal: "anuncio", lang: "es", parts: [
    { text: "¿Buscando especialista de confianza? En {businessName} te explicamos todo por escrito.", needs: ["businessName"] },
    { text: "Sin letras chiquitas ni cobros sorpresa.", },
    { text: "Conócenos en {url}", needs: ["url"] },
  ]},
  { register: "consultorio", goal: "testimonio", lang: "es", parts: [
    { text: "\"Me explicaron todo con calma y sin cobros escondidos\" 🤍", },
    { text: "Así se atiende en {businessName} — gracias por la confianza.", needs: ["businessName"] },
    { text: "Agenda tu consulta: {url}", needs: ["url"] },
  ]},
  { register: "consultorio", goal: "testimonio", lang: "es", parts: [
    { text: "No hay mejor reseña que un paciente que regresa y recomienda 😊", },
    { text: "Tu cita te espera al {phone}", needs: ["phone"] },
  ]},
  { register: "consultorio", goal: "testimonio", lang: "es", parts: [
    { text: "Otra sonrisa que sale tranquila de {businessName} ✨", needs: ["businessName"] },
    { text: "Atender bien no cuesta más — es nuestra forma de trabajar.", },
  ]},
  { register: "consultorio", goal: "info", lang: "es", parts: [
    { text: "La pregunta que más escuchamos en consulta 📋", },
    { text: "{offer}", needs: ["offer"] },
    { text: "¿Tienes otra duda? Márcanos al {phone}", needs: ["phone"] },
  ]},
  { register: "consultorio", goal: "info", lang: "es", parts: [
    { text: "Para tu tranquilidad, así trabajamos en {businessName}:", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
  ]},
  { register: "consultorio", goal: "info", lang: "es", parts: [
    { text: "Dato de salud que vale la pena compartir 👇", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Más información en {url}", needs: ["url"] },
  ]},

  // ── tienda · es ──
  { register: "tienda", goal: "promo", lang: "es", parts: [
    { text: "Esto se va a acabar rápido 🛍️ {offer}", needs: ["offer"] },
    { text: "En {businessName} lo bueno no se queda en el aparador.", needs: ["businessName"] },
    { text: "Ve todo en {url}", needs: ["url"] },
  ]},
  { register: "tienda", goal: "promo", lang: "es", parts: [
    { text: "Tu carrito ya sabe lo que quiere: {offer} ✨", needs: ["offer"] },
    { text: "Mándanos mensaje y te lo apartamos.", },
    { text: "📲 {phone}", needs: ["phone"] },
  ]},
  { register: "tienda", goal: "promo", lang: "es", parts: [
    { text: "Piezas contadas, cero recompra: {offer}", needs: ["offer"] },
    { text: "Cuando se va, se va — así funciona en {businessName}.", needs: ["businessName"] },
    { text: "Aparta la tuya en {url}", needs: ["url"] },
  ]},
  { register: "tienda", goal: "anuncio", lang: "es", parts: [
    { text: "Llegó lo nuevo a {businessName} 📦", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "Ve la colección completa en {url}", needs: ["url"] },
  ]},
  { register: "tienda", goal: "anuncio", lang: "es", parts: [
    { text: "Se nos nota la emoción: ya está aquí 🎉", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Pregunta por disponibilidad al {phone}", needs: ["phone"] },
  ]},
  { register: "tienda", goal: "anuncio", lang: "es", parts: [
    { text: "Si te gusta encontrar cosas que nadie más trae, {businessName} es tu lugar.", needs: ["businessName"] },
    { text: "Curamos cada pieza como si fuera para nosotros.", },
    { text: "Descúbrenos en {url}", needs: ["url"] },
  ]},
  { register: "tienda", goal: "testimonio", lang: "es", parts: [
    { text: "\"Pedí uno y regresé por tres\" 🤭", },
    { text: "Historias que nos encantan — gracias por el amor a {businessName}.", needs: ["businessName"] },
    { text: "Encuentra el tuyo: {url}", needs: ["url"] },
  ]},
  { register: "tienda", goal: "testimonio", lang: "es", parts: [
    { text: "Cada foto que nos mandan estrenando es un regalo 🤍", },
    { text: "Etiquétanos o mándala al {phone} — nos alegras el día.", needs: ["phone"] },
  ]},
  { register: "tienda", goal: "testimonio", lang: "es", parts: [
    { text: "Otro paquete entregado, otra clienta feliz 📦✨", },
    { text: "En {businessName} empacamos cada pedido con cariño.", needs: ["businessName"] },
  ]},
  { register: "tienda", goal: "info", lang: "es", parts: [
    { text: "Lo que siempre nos preguntan 📋", },
    { text: "{offer}", needs: ["offer"] },
    { text: "¿Más dudas? Escríbenos al {phone}", needs: ["phone"] },
  ]},
  { register: "tienda", goal: "info", lang: "es", parts: [
    { text: "Así puedes comprar en {businessName} 👇", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "Catálogo completo en {url}", needs: ["url"] },
  ]},
  { register: "tienda", goal: "info", lang: "es", parts: [
    { text: "Dato útil antes de tu próxima compra:", },
    { text: "{offer}", needs: ["offer"] },
  ]},

  // ── oficios · es ──
  { register: "oficios", goal: "promo", lang: "es", parts: [
    { text: "Precio claro, trabajo garantizado: {offer} 🔧", needs: ["offer"] },
    { text: "En {businessName} el \"desde\" es de verdad, no de anzuelo.", needs: ["businessName"] },
    { text: "Llámanos al {phone}", needs: ["phone"] },
  ]},
  { register: "oficios", goal: "promo", lang: "es", parts: [
    { text: "No lo dejes para cuando truene 😅 {offer}", needs: ["offer"] },
    { text: "Agenda hoy y olvídate del problema.", },
    { text: "Presupuesto sin costo: {phone}", needs: ["phone"] },
  ]},
  { register: "oficios", goal: "promo", lang: "es", parts: [
    { text: "Esta semana: {offer}", needs: ["offer"] },
    { text: "Trabajo limpio, en tiempo y con garantía — así se hace en {businessName}.", needs: ["businessName"] },
    { text: "Más info en {url}", needs: ["url"] },
  ]},
  { register: "oficios", goal: "anuncio", lang: "es", parts: [
    { text: "Aviso para clientes de {businessName} 🔧", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "Agenda al {phone}", needs: ["phone"] },
  ]},
  { register: "oficios", goal: "anuncio", lang: "es", parts: [
    { text: "Ahora también hacemos esto 👇", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Pregunta sin compromiso: {phone}", needs: ["phone"] },
  ]},
  { register: "oficios", goal: "anuncio", lang: "es", parts: [
    { text: "¿Buscando alguien de confianza? {businessName}: años de experiencia y clientes que regresan.", needs: ["businessName"] },
    { text: "Llegamos a tiempo y dejamos todo limpio.", },
    { text: "Conócenos en {url}", needs: ["url"] },
  ]},
  { register: "oficios", goal: "testimonio", lang: "es", parts: [
    { text: "\"Llegó a la hora, cobró lo acordado y quedó perfecto\" 🙌", },
    { text: "Así trabajamos en {businessName} — palabra que se cumple.", needs: ["businessName"] },
    { text: "Agenda tu servicio: {phone}", needs: ["phone"] },
  ]},
  { register: "oficios", goal: "testimonio", lang: "es", parts: [
    { text: "El mejor cliente es el que te recomienda con su familia 🤍", },
    { text: "Gracias por la confianza — seguimos al {phone}", needs: ["phone"] },
  ]},
  { register: "oficios", goal: "testimonio", lang: "es", parts: [
    { text: "Otro trabajo entregado y otro cliente tranquilo ✅", },
    { text: "En {businessName} la garantía no es promesa, es costumbre.", needs: ["businessName"] },
  ]},
  { register: "oficios", goal: "info", lang: "es", parts: [
    { text: "Lo que siempre preguntan antes de contratar 📋", },
    { text: "{offer}", needs: ["offer"] },
    { text: "¿Dudas? Márcanos al {phone}", needs: ["phone"] },
  ]},
  { register: "oficios", goal: "info", lang: "es", parts: [
    { text: "Consejo de {businessName} para evitar un problema mayor 👇", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
  ]},
  { register: "oficios", goal: "info", lang: "es", parts: [
    { text: "Así trabajamos: diagnóstico claro, precio antes de empezar y garantía por escrito.", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Más en {url}", needs: ["url"] },
  ]},

  // ── restaurante · en ──
  { register: "restaurante", goal: "promo", lang: "en", parts: [
    { text: "Hungry yet? 🌮 {offer} — only at {businessName}.", needs: ["offer", "businessName"] },
    { text: "Come early, the good stuff never lasts.", },
    { text: "Full menu at {url}", needs: ["url"] },
  ]},
  { register: "restaurante", goal: "promo", lang: "en", parts: [
    { text: "PSA for serious appetites: {offer} 🔥", needs: ["offer"] },
    { text: "At {businessName}, flavor is non-negotiable.", needs: ["businessName"] },
    { text: "Order or book at {phone}", needs: ["phone"] },
  ]},
  { register: "restaurante", goal: "promo", lang: "en", parts: [
    { text: "Perfect timing for a craving: {offer}", needs: ["offer"] },
    { text: "Swing by before it's gone.", },
    { text: "Everything's at {url}", needs: ["url"] },
  ]},
  { register: "restaurante", goal: "anuncio", lang: "en", parts: [
    { text: "Something new is cooking at {businessName} 👀", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "Be the first to try it — {url}", needs: ["url"] },
  ]},
  { register: "restaurante", goal: "anuncio", lang: "en", parts: [
    { text: "We're ready for you! 🍽️", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Book your table at {phone}", needs: ["phone"] },
  ]},
  { register: "restaurante", goal: "anuncio", lang: "en", parts: [
    { text: "If you haven't tried {businessName} yet, consider this your sign.", needs: ["businessName"] },
    { text: "Honest cooking, real portions, and a table that feels like home.", },
    { text: "Find us at {url}", needs: ["url"] },
  ]},
  { register: "restaurante", goal: "testimonio", lang: "en", parts: [
    { text: "\"Tastes like home, but better\" 🤍", },
    { text: "That's exactly what we cook for at {businessName}.", needs: ["businessName"] },
    { text: "Come taste it yourself: {url}", needs: ["url"] },
  ]},
  { register: "restaurante", goal: "testimonio", lang: "en", parts: [
    { text: "Empty plates are our favorite reviews 😊", },
    { text: "Thanks for keeping our tables (and hearts) full.", },
    { text: "Book yours at {phone}", needs: ["phone"] },
  ]},
  { register: "restaurante", goal: "testimonio", lang: "en", parts: [
    { text: "Another guest who came for a craving and stayed for good 🙌", },
    { text: "That's the goal at {businessName}, every single day.", needs: ["businessName"] },
  ]},
  { register: "restaurante", goal: "info", lang: "en", parts: [
    { text: "The question we hear the most at {businessName} 📋", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "More questions? Call us at {phone}", needs: ["phone"] },
  ]},
  { register: "restaurante", goal: "info", lang: "en", parts: [
    { text: "So you don't have to wonder 👇", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Hours and full menu at {url}", needs: ["url"] },
  ]},
  { register: "restaurante", goal: "info", lang: "en", parts: [
    { text: "How we do things at {businessName}: fresh ingredients, no shortcuts.", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
  ]},

  // ── belleza · en ──
  { register: "belleza", goal: "promo", lang: "en", parts: [
    { text: "Your self-care moment is calling ✨ {offer}", needs: ["offer"] },
    { text: "Walk out of {businessName} feeling like your best self.", needs: ["businessName"] },
    { text: "Book at {url}", needs: ["url"] },
  ]},
  { register: "belleza", goal: "promo", lang: "en", parts: [
    { text: "Treat yourself — you've earned it: {offer} 💅", needs: ["offer"] },
    { text: "Spots go fast, don't sleep on this one.", },
    { text: "Save yours at {phone}", needs: ["phone"] },
  ]},
  { register: "belleza", goal: "promo", lang: "en", parts: [
    { text: "New look alert 🚨 {offer}", needs: ["offer"] },
    { text: "Come to {businessName} and leave wearing fresh confidence.", needs: ["businessName"] },
    { text: "Appointments at {url}", needs: ["url"] },
  ]},
  { register: "belleza", goal: "anuncio", lang: "en", parts: [
    { text: "New at {businessName} ✨", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "Be among the first to try it — {url}", needs: ["url"] },
  ]},
  { register: "belleza", goal: "anuncio", lang: "en", parts: [
    { text: "News you're going to love 💫", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Book at {phone} and we'll save your spot.", needs: ["phone"] },
  ]},
  { register: "belleza", goal: "anuncio", lang: "en", parts: [
    { text: "Haven't been to {businessName} yet? Let us spoil you once.", needs: ["businessName"] },
    { text: "One visit and you'll get why our clients keep coming back.", },
    { text: "Meet us at {url}", needs: ["url"] },
  ]},
  { register: "belleza", goal: "testimonio", lang: "en", parts: [
    { text: "\"I walked out feeling brand new\" 🤍 That's the whole point.", },
    { text: "Thank you for trusting {businessName} — the care shows.", needs: ["businessName"] },
    { text: "Your appointment is waiting: {url}", needs: ["url"] },
  ]},
  { register: "belleza", goal: "testimonio", lang: "en", parts: [
    { text: "When a client smiles at the mirror, everybody wins ✨", },
    { text: "Come get your moment: {phone}", needs: ["phone"] },
  ]},
  { register: "belleza", goal: "testimonio", lang: "en", parts: [
    { text: "Another happy client, another reason to love this work 💕", },
    { text: "At {businessName}, every detail matters.", needs: ["businessName"] },
  ]},
  { register: "belleza", goal: "info", lang: "en", parts: [
    { text: "We get this question all the time 📋", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Questions? Text us at {phone}", needs: ["phone"] },
  ]},
  { register: "belleza", goal: "info", lang: "en", parts: [
    { text: "A tip from {businessName} to make your look last 👇", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
  ]},
  { register: "belleza", goal: "info", lang: "en", parts: [
    { text: "Booking with us is this easy:", },
    { text: "{offer}", needs: ["offer"] },
    { text: "All at {url}", needs: ["url"] },
  ]},

  // ── gym · en ──
  { register: "gym", goal: "promo", lang: "en", parts: [
    { text: "Zero excuses: {offer} 💪", needs: ["offer"] },
    { text: "At {businessName}, the only bad workout is the one you skip.", needs: ["businessName"] },
    { text: "Join at {url}", needs: ["url"] },
  ]},
  { register: "gym", goal: "promo", lang: "en", parts: [
    { text: "Future you says thanks: {offer} 🔥", needs: ["offer"] },
    { text: "Start today, even if it's just 30 minutes.", },
    { text: "Info at {phone}", needs: ["phone"] },
  ]},
  { register: "gym", goal: "promo", lang: "en", parts: [
    { text: "Excuses are officially out of stock: {offer}", needs: ["offer"] },
    { text: "Come to {businessName} — nobody starts as an expert.", needs: ["businessName"] },
    { text: "Grab your spot: {url}", needs: ["url"] },
  ]},
  { register: "gym", goal: "anuncio", lang: "en", parts: [
    { text: "New at {businessName} 🏋️", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "Limited spots — details at {url}", needs: ["url"] },
  ]},
  { register: "gym", goal: "anuncio", lang: "en", parts: [
    { text: "Heads up, team — you'll like this one 👇", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Ask about schedules at {phone}", needs: ["phone"] },
  ]},
  { register: "gym", goal: "anuncio", lang: "en", parts: [
    { text: "Still training alone? At {businessName} we train as a pack.", needs: ["businessName"] },
    { text: "Coaches who push you, teammates who won't let you quit.", },
    { text: "Come for a trial class: {url}", needs: ["url"] },
  ]},
  { register: "gym", goal: "testimonio", lang: "en", parts: [
    { text: "\"I couldn't run a block — now I run 10Ks\" 🏃", },
    { text: "Stories like this are built at {businessName}, one day at a time.", needs: ["businessName"] },
    { text: "Start yours: {url}", needs: ["url"] },
  ]},
  { register: "gym", goal: "testimonio", lang: "en", parts: [
    { text: "Our members' progress is our best ad 💪", },
    { text: "Come write yours — {phone}", needs: ["phone"] },
  ]},
  { register: "gym", goal: "testimonio", lang: "en", parts: [
    { text: "Another member who doesn't recognize their old photos 🔥", },
    { text: "At {businessName}, results do the talking.", needs: ["businessName"] },
  ]},
  { register: "gym", goal: "info", lang: "en", parts: [
    { text: "The question we get the most 📋", },
    { text: "{offer}", needs: ["offer"] },
    { text: "More questions? Message us at {phone}", needs: ["phone"] },
  ]},
  { register: "gym", goal: "info", lang: "en", parts: [
    { text: "A training tip from {businessName} 👇", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
  ]},
  { register: "gym", goal: "info", lang: "en", parts: [
    { text: "Schedules, plans and everything you need to know:", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Full details at {url}", needs: ["url"] },
  ]},

  // ── consultorio · en ──
  { register: "consultorio", goal: "promo", lang: "en", parts: [
    { text: "Your health shouldn't wait: {offer}", needs: ["offer"] },
    { text: "At {businessName}, no rush and no surprises — just real care.", needs: ["businessName"] },
    { text: "Book your visit at {url}", needs: ["url"] },
  ]},
  { register: "consultorio", goal: "promo", lang: "en", parts: [
    { text: "Stop putting it off 🙌 {offer}", needs: ["offer"] },
    { text: "One appointment today saves a bigger problem tomorrow.", },
    { text: "Call us at {phone}", needs: ["phone"] },
  ]},
  { register: "consultorio", goal: "promo", lang: "en", parts: [
    { text: "This month at {businessName}: {offer}", needs: ["businessName", "offer"] },
    { text: "Clear pricing and care that actually listens.", },
    { text: "Book at {url}", needs: ["url"] },
  ]},
  { register: "consultorio", goal: "anuncio", lang: "en", parts: [
    { text: "News from {businessName} 🩺", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "Book or ask at {url}", needs: ["url"] },
  ]},
  { register: "consultorio", goal: "anuncio", lang: "en", parts: [
    { text: "Good news for your health 👇", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Appointments at {phone}", needs: ["phone"] },
  ]},
  { register: "consultorio", goal: "anuncio", lang: "en", parts: [
    { text: "Looking for a specialist you can trust? At {businessName}, everything's explained in writing.", needs: ["businessName"] },
    { text: "No fine print, no surprise charges.", },
    { text: "Get to know us at {url}", needs: ["url"] },
  ]},
  { register: "consultorio", goal: "testimonio", lang: "en", parts: [
    { text: "\"They explained everything calmly, no hidden fees\" 🤍", },
    { text: "That's how we care at {businessName} — thank you for the trust.", needs: ["businessName"] },
    { text: "Book your visit: {url}", needs: ["url"] },
  ]},
  { register: "consultorio", goal: "testimonio", lang: "en", parts: [
    { text: "No better review than a patient who returns and refers 😊", },
    { text: "Your appointment awaits at {phone}", needs: ["phone"] },
  ]},
  { register: "consultorio", goal: "testimonio", lang: "en", parts: [
    { text: "Another patient leaving {businessName} at ease ✨", needs: ["businessName"] },
    { text: "Caring well doesn't cost extra — it's just how we work.", },
  ]},
  { register: "consultorio", goal: "info", lang: "en", parts: [
    { text: "The question we hear most in consultations 📋", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Another question? Call us at {phone}", needs: ["phone"] },
  ]},
  { register: "consultorio", goal: "info", lang: "en", parts: [
    { text: "For your peace of mind, here's how {businessName} works:", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
  ]},
  { register: "consultorio", goal: "info", lang: "en", parts: [
    { text: "A health fact worth sharing 👇", },
    { text: "{offer}", needs: ["offer"] },
    { text: "More at {url}", needs: ["url"] },
  ]},

  // ── tienda · en ──
  { register: "tienda", goal: "promo", lang: "en", parts: [
    { text: "This won't last long 🛍️ {offer}", needs: ["offer"] },
    { text: "At {businessName}, the good pieces never sit on the shelf.", needs: ["businessName"] },
    { text: "See everything at {url}", needs: ["url"] },
  ]},
  { register: "tienda", goal: "promo", lang: "en", parts: [
    { text: "Your cart already knows what it wants: {offer} ✨", needs: ["offer"] },
    { text: "Message us and we'll set it aside for you.", },
    { text: "📲 {phone}", needs: ["phone"] },
  ]},
  { register: "tienda", goal: "promo", lang: "en", parts: [
    { text: "Limited pieces, no restock: {offer}", needs: ["offer"] },
    { text: "When it's gone, it's gone — that's how {businessName} works.", needs: ["businessName"] },
    { text: "Claim yours at {url}", needs: ["url"] },
  ]},
  { register: "tienda", goal: "anuncio", lang: "en", parts: [
    { text: "Fresh arrivals at {businessName} 📦", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "See the full collection at {url}", needs: ["url"] },
  ]},
  { register: "tienda", goal: "anuncio", lang: "en", parts: [
    { text: "We can't hide the excitement: it just dropped 🎉", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Ask about availability at {phone}", needs: ["phone"] },
  ]},
  { register: "tienda", goal: "anuncio", lang: "en", parts: [
    { text: "If you love finding pieces nobody else carries, {businessName} is your place.", needs: ["businessName"] },
    { text: "We curate every item like it's for ourselves.", },
    { text: "Discover us at {url}", needs: ["url"] },
  ]},
  { register: "tienda", goal: "testimonio", lang: "en", parts: [
    { text: "\"Ordered one, came back for three\" 🤭", },
    { text: "Stories we love — thanks for the {businessName} love.", needs: ["businessName"] },
    { text: "Find yours: {url}", needs: ["url"] },
  ]},
  { register: "tienda", goal: "testimonio", lang: "en", parts: [
    { text: "Every photo you send wearing your order makes our day 🤍", },
    { text: "Tag us or send it to {phone}", needs: ["phone"] },
  ]},
  { register: "tienda", goal: "testimonio", lang: "en", parts: [
    { text: "Another package delivered, another happy customer 📦✨", },
    { text: "At {businessName}, every order ships with care.", needs: ["businessName"] },
  ]},
  { register: "tienda", goal: "info", lang: "en", parts: [
    { text: "The thing everyone asks us 📋", },
    { text: "{offer}", needs: ["offer"] },
    { text: "More questions? Text us at {phone}", needs: ["phone"] },
  ]},
  { register: "tienda", goal: "info", lang: "en", parts: [
    { text: "Here's how to shop at {businessName} 👇", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "Full catalog at {url}", needs: ["url"] },
  ]},
  { register: "tienda", goal: "info", lang: "en", parts: [
    { text: "Good to know before your next order:", },
    { text: "{offer}", needs: ["offer"] },
  ]},

  // ── oficios · en ──
  { register: "oficios", goal: "promo", lang: "en", parts: [
    { text: "Clear price, guaranteed work: {offer} 🔧", needs: ["offer"] },
    { text: "At {businessName}, \"starting at\" means exactly that — no bait.", needs: ["businessName"] },
    { text: "Call us at {phone}", needs: ["phone"] },
  ]},
  { register: "oficios", goal: "promo", lang: "en", parts: [
    { text: "Don't wait for it to break down 😅 {offer}", needs: ["offer"] },
    { text: "Book today and forget the problem.", },
    { text: "Free quote: {phone}", needs: ["phone"] },
  ]},
  { register: "oficios", goal: "promo", lang: "en", parts: [
    { text: "This week: {offer}", needs: ["offer"] },
    { text: "Clean work, on time, with warranty — the {businessName} way.", needs: ["businessName"] },
    { text: "More at {url}", needs: ["url"] },
  ]},
  { register: "oficios", goal: "anuncio", lang: "en", parts: [
    { text: "Heads up from {businessName} 🔧", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
    { text: "Book at {phone}", needs: ["phone"] },
  ]},
  { register: "oficios", goal: "anuncio", lang: "en", parts: [
    { text: "We now do this too 👇", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Ask us anything: {phone}", needs: ["phone"] },
  ]},
  { register: "oficios", goal: "anuncio", lang: "en", parts: [
    { text: "Need someone you can trust? {businessName}: years of experience and clients who come back.", needs: ["businessName"] },
    { text: "We show up on time and leave everything clean.", },
    { text: "Get to know us at {url}", needs: ["url"] },
  ]},
  { register: "oficios", goal: "testimonio", lang: "en", parts: [
    { text: "\"Showed up on time, charged what was quoted, left it perfect\" 🙌", },
    { text: "That's how {businessName} works — our word means something.", needs: ["businessName"] },
    { text: "Book your service: {phone}", needs: ["phone"] },
  ]},
  { register: "oficios", goal: "testimonio", lang: "en", parts: [
    { text: "The best client is the one who refers their family 🤍", },
    { text: "Thanks for the trust — we're at {phone}", needs: ["phone"] },
  ]},
  { register: "oficios", goal: "testimonio", lang: "en", parts: [
    { text: "Another job delivered, another client at ease ✅", },
    { text: "At {businessName}, the warranty isn't a promise — it's a habit.", needs: ["businessName"] },
  ]},
  { register: "oficios", goal: "info", lang: "en", parts: [
    { text: "What people always ask before hiring 📋", },
    { text: "{offer}", needs: ["offer"] },
    { text: "Questions? Call us at {phone}", needs: ["phone"] },
  ]},
  { register: "oficios", goal: "info", lang: "en", parts: [
    { text: "A tip from {businessName} to avoid a bigger repair 👇", needs: ["businessName"] },
    { text: "{offer}", needs: ["offer"] },
  ]},
  { register: "oficios", goal: "info", lang: "en", parts: [
    { text: "How we work: clear diagnosis, price before we start, written warranty.", },
    { text: "{offer}", needs: ["offer"] },
    { text: "More at {url}", needs: ["url"] },
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
