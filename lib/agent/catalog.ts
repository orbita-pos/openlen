// lib/agent/catalog.ts — LA fuente única del conocimiento del agente (spec §5).
// De aquí salen las DOS mitades: las function declarations para Gemini y la
// sección de conocimiento del system prompt. Módulo nuevo ⇒ una entrada aquí.
import { DESIGN_GUIDANCE } from "@/lib/design-guidance";
import { BEHAVIOR_NAMES, BEHAVIOR_COUNT } from "@/lib/behaviors/doc";
import { POST_REGISTER } from "@/lib/marketing/post-templates/admin-schemas";
import { PUBLISH_LOCALES } from "@/lib/publish/publish-locales";
import { TEMATICA_PRESETS } from "@/lib/tematicas/presets";
import { THEME_PRESETS } from "@/lib/theme-presets";

export const AGENT_MODULES = [
  "members", "bookings", "collections", "chat", "whatsapp", "comments", "pedidos",
] as const;
export type AgentModule = (typeof AGENT_MODULES)[number];

export const MOTION_LOOKS = ["calm", "editorial", "dramatic", "off"] as const;
export type MotionLook = (typeof MOTION_LOOKS)[number];

// The OpenLenStyle union from components/workspace-v2/replace-asset-modal.tsx
// (the "Imágenes by OpenLen" picker) — that type isn't exported (client
// component), so this list is duplicated here deliberately, purely as prompt
// guidance: elegir_foto's `estilo` param stays a free STRING (a typo just
// yields zero matches, never an error), the model just needs to know which
// values are worth trying.
const OPENLEN_IMAGE_STYLES = [
  "3d-abstract", "claymorph", "fashion-editorial", "device-mockup",
  "product-still-life", "food-editorial", "interior-editorial",
  "nature-editorial", "architecture-editorial", "lifestyle-editorial",
  "gradient-bg", "pet-editorial", "creator-mockup", "sports-editorial",
  "travel-editorial", "wedding-editorial", "music-editorial", "gaming-editorial",
] as const;

const MARKETING_REGISTERS = POST_REGISTER.options;
// The valid `idiomas` codes for publicar — generated from the same list the
// publish endpoint validates against, so a new locale lands in the prompt
// automatically (never a hardcoded copy that could drift).
const PUBLISH_LOCALE_CODES = PUBLISH_LOCALES.map((l) => l.code);
const THEME_PRESET_IDS = THEME_PRESETS.map((p) => p.id);
const TEMATICA_IDS = TEMATICA_PRESETS.map((p) => p.id);
// Every kit's scene ids, deduped — the valid values for aplicar_tematica's
// fondo. Generated from the presets' backdrop tables (the same source
// resolveBackdrop reads) so a new scene lands in the enum automatically.
const TEMATICA_FONDO_IDS = Array.from(
  new Set(TEMATICA_PRESETS.flatMap((p) => p.backdrops.map((b) => b.id))),
);

// Conocimiento de las 5 herramientas de settings/tema F2 (motion, música,
// 3D, marketing, tema) — igual que MODULE_KNOWLEDGE, va en el system prompt.
const SETTINGS_TOOL_KNOWLEDGE = `- cambiar_motion: coreografía de scroll (Motion Looks) — beads sutiles en la segunda fila, puro CSS. Se HORNEA al publicar; el preview del editor no la anima en vivo. Usa look="off" para apagarla.
- poner_musica: reproductor flotante de música. SOLO puede usar pistas YA SUBIDAS a este proyecto — jamás una URL externa (el guard del servidor la rechazaría igual). Si no hay pistas disponibles, dile al usuario que suba una en el panel Música y no insistas con asset_url inventado.
- activar_3d: enciende o apaga la escena 3D de fondo (Born With Depth). Esto solo prende/apaga — el diseño fino (modelo, gestos, cámara) se ajusta en el panel 3D del editor, no por el agente.
- preparar_marketing: fija el rubro (registro) del Marketing Kit — posts curados zero-AI — y si deben combinarse con la paleta/fuente de la página. Después de usarla, dirige al usuario al tab Marketing para ver y copiar los posts.
- cambiar_tema: re-tematiza la página al instante (sin llamada de IA) — igual que un click en Looks del inspector. accent (hex) deriva una paleta completa con contraste WCAG garantizado; fuente y radius toman SOLO ese rasgo del preset nombrado (ids: ${THEME_PRESET_IDS.join(", ")}), útil para combinar look a piezas. modo elige la variante clara/oscura — con accent, o solo (re-deriva del accent actual de la página, igual que el toggle Dark).
- aplicar_tematica: instala o quita un MUNDO de página completa (fondo a pantalla completa + vidrio en tarjetas/nav + paleta y fuente del kit) — el look guns.lol/Carrd, igual que un click en Temáticas del inspector, sin llamada de IA. tematica="quitar" remueve el mundo activo; los tokens --ol-* que haya dejado NO se tocan (son estado de tema genérico, no del kit). fondo (opcional) elige la variante de escena — usa SOLO escenas del kit elegido; una escena de otro kit cae a la escena hero. DELTA: el reink de contraste interactivo del iframe no corre aquí — el CSS del kit ya cubre casi todo; si algo queda ilegible, encadena editar_pagina. Kits disponibles: ${TEMATICA_PRESETS.map((p) => `${p.id} (${p.name}: ${p.hint}; escenas: ${p.backdrops.map((b) => b.id).join("/")})`).join(" · ")}.`;

// Conocimiento por módulo: qué es + cuándo recomendarlo. Español porque el
// usuario objetivo habla español; el modelo responde en el idioma del usuario.
const MODULE_KNOWLEDGE: Record<AgentModule, string> = {
  members:
    "Cuentas / sign-in / login de visitantes. Actívalo cuando pidan 'signin', 'login', 'cuentas', 'miembros' o páginas privadas. Al activarlo, el sitio publica con enlace de acceso y área /cuenta — NO fabriques formularios de login en HTML.",
  bookings:
    "Reservas / citas / agenda. Actívalo cuando pidan agendar citas, reservas o calendario de servicios. El widget real se hornea al publicar.",
  collections:
    "Catálogo / listados administrables (productos, menú, portafolio). Actívalo cuando pidan un catálogo que el dueño mantenga sin editar HTML.",
  chat:
    "Chat privado visitante↔dueño en la página publicada (estilo messenger). Actívalo cuando pidan 'chat', 'mensajes de clientes' o atención directa.",
  whatsapp:
    "Botón flotante de WhatsApp. Actívalo cuando pidan contacto por WhatsApp. Necesita el número del negocio (si no lo sabes, actívalo y avisa que lo configuren en Módulos).",
  comments:
    "Comentarios de miembros en la página. REQUIERE members activo — si members está apagado, activa members primero o explica la dependencia.",
  pedidos:
    "Pedidos por WhatsApp: carrito sobre el Catálogo (collections) — cada item gana botón «Agregar» y el pedido armado (cantidades, total, nota) sale al WhatsApp del negocio en la página publicada. Actívalo cuando pidan 'carrito', 'pedidos', 'ordenar', 'que me compren por WhatsApp'. REQUIERE collections activo con items — si falta, activa collections primero (o explica la dependencia). Al activarlo reusa el número de WhatsApp ya guardado (de pedidos o del módulo whatsapp) — si no hay ninguno, la herramienta te lo dirá: pregúntale al usuario su número de WhatsApp (10 dígitos MX) y vuelve a llamar activar_modulo con numero. NUNCA inventes un número. NO es pago en línea: el cobro se acuerda en el chat de WhatsApp.",
};

export function buildFunctionDeclarations(): Record<string, unknown>[] {
  return [
    {
      name: "leer_estado",
      description:
        "Relee el estado REAL del proyecto (módulos activos, páginas, publicado). El estado inicial ya viene en tu contexto; usa esto solo a MITAD de cadena, después de mutar. Con incluir_documento=true devuelve el HTML re-etiquetado (data-op-id frescos) para poder editar de nuevo.",
      parameters: {
        type: "OBJECT",
        properties: {
          incluir_documento: { type: "BOOLEAN" },
        },
      },
    },
    {
      name: "editar_pagina",
      description:
        "Aplica ediciones quirúrgicas al documento actual dirigidas por data-op-id (máx 8 por llamada). Después de una llamada exitosa los data-op-id CAMBIAN: para editar otra vez, pide leer_estado con incluir_documento=true.",
      parameters: {
        type: "OBJECT",
        properties: {
          edits: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                op: { type: "STRING", enum: ["replace", "insert_before", "insert_after", "delete"] },
                target: { type: "STRING" },
                new_html: { type: "STRING" },
              },
              required: ["op", "target"],
            },
          },
          resumen: { type: "STRING" },
        },
        required: ["edits", "resumen"],
      },
    },
    {
      name: "redisenar_pagina",
      description:
        "Rediseña POR COMPLETO el documento activo — layout, secciones, estilo — en una sola operación, conservando los hechos (nombres, contacto, precios, URLs reales), los elementos con atributos data-ol-* (bandas de módulos, conductas, datos vivos) y el idioma. Úsala SOLO cuando el usuario pida un rediseño total ('rediséñala', 'cámbiale todo el estilo', 'hazla más moderna/minimalista/oscura de arriba a abajo'); para cambios puntuales usa editar_pagina y para solo color/fuente usa cambiar_tema. Es una operación GRANDE (cuesta créditos, tarda ~1 min) y está limitada a UNA por turno. El usuario siempre puede deshacerla (se guarda una versión previa). direccion: la dirección creativa en las palabras del usuario.",
      parameters: {
        type: "OBJECT",
        properties: {
          direccion: { type: "STRING" },
          resumen: { type: "STRING" },
        },
        required: ["direccion", "resumen"],
      },
    },
    {
      name: "activar_modulo",
      description:
        "Enciende (o apaga) un MÓDULO REAL de OpenLen en este proyecto — la misma acción que el botón del panel Módulos. NUNCA fabriques en HTML lo que un módulo ya resuelve. numero (opcional) es el número de WhatsApp del negocio — solo lo usa el módulo pedidos al encender; si pedidos no tiene número propio ni el módulo whatsapp uno guardado, la herramienta responde ok:false pidiéndolo — pregúntaselo al usuario y vuelve a llamar con numero. NUNCA inventes un número.",
      parameters: {
        type: "OBJECT",
        properties: {
          modulo: { type: "STRING", enum: [...AGENT_MODULES] },
          encender: { type: "BOOLEAN" },
          numero: { type: "STRING" },
        },
        required: ["modulo"],
      },
    },
    {
      name: "cambiar_motion",
      description:
        "Cambia la coreografía de scroll (Motion Looks) de la página — un efecto sutil y puramente CSS que se HORNEA al publicar (el preview del editor no la anima en vivo). Usa look=\"off\" para apagarla.",
      parameters: {
        type: "OBJECT",
        properties: {
          look: { type: "STRING", enum: [...MOTION_LOOKS] },
        },
        required: ["look"],
      },
    },
    {
      name: "poner_musica",
      description:
        "Pone o quita la pista del reproductor flotante de música de la página. SOLO puede usar una pista YA SUBIDA por el dueño a este proyecto — nunca una URL externa. Si no sabes la URL, llama con accion=poner sin asset_url y recibirás las pistas disponibles (campo \"pistas\": cada una con nombre y url); elige una url y vuelve a llamar. Si la lista viene vacía, no hay pistas subidas: dile al usuario que suba una en el panel Música.",
      parameters: {
        type: "OBJECT",
        properties: {
          accion: { type: "STRING", enum: ["poner", "quitar"] },
          asset_url: { type: "STRING" },
        },
        required: ["accion"],
      },
    },
    {
      name: "activar_3d",
      description:
        "Enciende o apaga la escena 3D de fondo (Born With Depth). Solo prende/apaga la escena — el diseño fino (modelo, gestos, cámara) se ajusta en el panel 3D del editor, no por esta herramienta.",
      parameters: {
        type: "OBJECT",
        properties: {
          encender: { type: "BOOLEAN" },
        },
        required: ["encender"],
      },
    },
    {
      name: "cambiar_tema",
      description:
        `Re-tematiza la página al instante escribiendo los tokens --ol-* en <html> — igual que un click en Looks del inspector, sin llamada de IA. accent (hex #rgb o #rrggbb) deriva una paleta completa (fondo/superficie/texto/borde/acento) con contraste WCAG garantizado. fuente y radius toman SOLO ese rasgo del preset nombrado (ids válidos: ${THEME_PRESET_IDS.join(", ")}) sin tocar los demás tokens — para combinar look a piezas. modo (light|dark) elige la variante del accent, o solo (sin accent) re-deriva la paleta oscura/clara del accent actual de la página — el toggle Dark. Pasa cualquier combinación; al menos uno es requerido.`,
      parameters: {
        type: "OBJECT",
        properties: {
          accent: { type: "STRING" },
          fuente: { type: "STRING", enum: [...THEME_PRESET_IDS] },
          radius: { type: "STRING", enum: [...THEME_PRESET_IDS] },
          modo: { type: "STRING", enum: ["light", "dark"] },
        },
      },
    },
    {
      name: "aplicar_tematica",
      description:
        `Instala o quita un MUNDO de página completa (temática) — imagen de fondo a pantalla completa con scrim de legibilidad, vidrio en tarjetas/nav, y la paleta/fuente del kit — todo en un click, sin llamada de IA (el look guns.lol/Carrd). tematica="quitar" remueve el mundo activo (el <style>/<link>/atributos del kit); los tokens --ol-* que haya dejado NO se tocan, son estado de tema genérico que el usuario pudo haber ajustado después. fondo (opcional) elige la variante de escena del kit — usa SOLO una escena del kit elegido (por defecto, o con una escena de otro kit, cae a la escena hero). DELTA CONOCIDO: el reink de contraste interactivo del iframe no corre aquí — el CSS del kit ya cubre casi todo; si algo queda ilegible, encadena editar_pagina. Kits (id — nombre: vibe [escenas]): ${TEMATICA_PRESETS.map((p) => `${p.id} — ${p.name}: ${p.hint} [${p.backdrops.map((b) => b.id).join("/")}]`).join(" · ")}.`,
      parameters: {
        type: "OBJECT",
        properties: {
          tematica: { type: "STRING", enum: [...TEMATICA_IDS, "quitar"] },
          fondo: { type: "STRING", enum: [...TEMATICA_FONDO_IDS] },
        },
        required: ["tematica"],
      },
    },
    {
      name: "preparar_marketing",
      description:
        "Prepara el Marketing Kit: fija el rubro (registro) de posts curados zero-AI y si deben combinarse con la paleta/fuente de la página. Dirige al usuario al tab Marketing para ver y copiar los posts.",
      parameters: {
        type: "OBJECT",
        properties: {
          registro: { type: "STRING", enum: [...MARKETING_REGISTERS] },
          combinar: { type: "BOOLEAN" },
        },
        required: ["registro"],
      },
    },
    {
      name: "crear_pagina",
      description:
        "Crea una página NUEVA del sitio (multi-página) — nace como el shell de Home (mismo look/nav/footer, lienzo en blanco titulado), nunca copia el contenido de Home. Pasa slug (URL) y/o titulo (nombre visible) — si solo sabes el nombre, manda solo titulo y el slug se deriva automáticamente. Con modulo=\"bookings\"|\"collections\" la página nace YA con la sección diseñada de ese módulo inyectada; en ese caso el módulo define su propio slug/título (ignora cualquier slug/titulo que mandes junto con modulo) — pero el módulo en sí sigue apagado hasta que uses activar_modulo.",
      parameters: {
        type: "OBJECT",
        properties: {
          slug: { type: "STRING" },
          titulo: { type: "STRING" },
          modulo: { type: "STRING", enum: ["bookings", "collections"] },
        },
      },
    },
    {
      name: "elegir_foto",
      description:
        `Busca fotos REALES del catálogo curado "Imágenes by OpenLen" (mismo picker del tab Contenido) — úsala antes de poner una foto nueva con editar_pagina, nunca inventes una URL de imagen. Devuelve hasta 6 candidatas con url/alt/estilo; si no hay resultados, responde ok:true con fotos:[] y una nota — no es un error. El catálogo es acotado: prueba a lo sumo otro término o quita el filtro de estilo, pero si un par de intentos no dan con la vibra, NO existe en el catálogo — pivotea (cambiar_tema/aplicar_tematica para el ambiente, editar_pagina para el copy) o dilo con honestidad; no encadenes búsquedas sin fin. busqueda (opcional) es texto libre contra el tema/alt de la foto (español o inglés, sin distinguir acentos/mayúsculas). estilo (opcional) es un string libre — valores que existen en el catálogo: ${OPENLEN_IMAGE_STYLES.join(", ")}; un valor que no exista simplemente no encuentra nada, no falla.`,
      parameters: {
        type: "OBJECT",
        properties: {
          busqueda: { type: "STRING" },
          estilo: { type: "STRING" },
        },
      },
    },
    {
      name: "editar_imagen",
      description:
        "Edita con IA (Nano Banana / Gemini) una imagen que YA está en la página: quitar un objeto, cambiar el fondo, extender una escena, limpiar un producto. imagen_url DEBE ser la URL exacta de una imagen presente en el documento actual (nunca una URL externa ni inventada — si la imagen no está en la página, la herramienta la rechaza). instruccion describe el cambio en lenguaje natural. Cuesta créditos y solo se permite UNA edición de imagen por turno. Para AÑADIR una foto nueva (no editar una que ya existe) usa elegir_foto, no esta herramienta. Devuelve la nueva URL y ya deja el swap hecho en la página.",
      parameters: {
        type: "OBJECT",
        properties: {
          imagen_url: { type: "STRING" },
          instruccion: { type: "STRING" },
        },
        required: ["imagen_url", "instruccion"],
      },
    },
    {
      name: "recordar_preferencia",
      description:
        "Guarda una preferencia DURABLE del usuario en el brief del proyecto (persiste entre conversaciones) — úsala SOLO cuando el usuario exprese una preferencia estable sobre cómo trabajar con él o su página (p. ej. \"siempre háblame de tú\", \"nunca uses amarillo\"), NUNCA para un pedido puntual de este turno (eso se resuelve con la herramienta correspondiente, no se guarda). preferencia debe ser texto corto (5–200 caracteres). Si el brief del proyecto ya está lleno, la herramienta te lo dice — no insistas, avisa al usuario que puede podarlo en la pestaña Brief. Confirma siempre en tu texto qué guardaste.",
      parameters: {
        type: "OBJECT",
        properties: {
          preferencia: { type: "STRING" },
        },
        required: ["preferencia"],
      },
    },
    {
      name: "publicar",
      description:
        `Prepara la publicación de la página en <subdominio>.openlen.com. NUNCA publica por su cuenta: SIEMPRE espera el tap del usuario en la tarjeta de confirmación — tú solo dejas listo el subdominio y los idiomas, y le dices al usuario que toque «Publicar» para confirmar. subdominio (opcional): si el proyecto ya tiene uno reclamado y no pasas otro, se re-publica sobre el actual; si pasas uno nuevo, se reclama ese. Si el proyecto NO tiene subdominio y no pasas ninguno, la herramienta te pide que le preguntes al usuario qué subdominio quiere ANTES de volver a llamar. idiomas (opcional): códigos de los idiomas a los que traducir la página al publicar (Speak Every Language); valores válidos: ${PUBLISH_LOCALE_CODES.join(", ")} (máx 9; los inválidos se ignoran).`,
      parameters: {
        type: "OBJECT",
        properties: {
          subdominio: { type: "STRING" },
          idiomas: { type: "ARRAY", items: { type: "STRING" } },
        },
      },
    },
    {
      name: "trabajar_en_pagina",
      description:
        "Cambia el DOCUMENTO activo a otra página del sitio (multi-página) — después de llamarla, editar_pagina/cambiar_tema/aplicar_tematica/editar_imagen actúan sobre ESA página, no sobre la anterior; los data-op-id que tenías quedan obsoletos, usa los nuevos que trae la respuesta. pagina: el slug de la página (p. ej. \"menu\"), o \"principal\"/\"home\"/vacío para volver a la Home. Si la página no existe, la herramienta te lo dice y lista las páginas disponibles — no inventes un slug. Para un pedido que toca varias páginas, encadena: trabajar_en_pagina → editar_pagina → trabajar_en_pagina → editar_pagina.",
      parameters: {
        type: "OBJECT",
        properties: {
          pagina: { type: "STRING" },
        },
        required: ["pagina"],
      },
    },
    {
      name: "conectar_datos_vivos",
      description:
        'Conecta la página a un Google Sheet PÚBLICO del dueño para que se actualice sola ("datos vivos") — jamás inventes datos ni los captures a mano en el HTML. sheet_url debe ser la URL normal del Sheet, compartido como "cualquiera con el link"; solo se aceptan Sheets de docs.google.com — cualquier otro enlace la herramienta lo rechaza con un error claro, sin tocar nada. intent="lista" conecta un CATÁLOGO en tabla (productos/menú/precios, una fila por elemento) al módulo Collections — cada fila se sincroniza como un item y la colección queda de SOLO LECTURA en OpenLen (se edita desde el Sheet, no desde el panel; dilo al usuario). intent="valores" conecta VALORES SUELTOS que aparecen sueltos en el texto de la página (un precio, una fecha, un cupo) — un Sheet de 2 columnas (clave, valor); la herramienta detecta las claves de la columna A y te las devuelve para que las cablees en el mismo turno con editar_pagina usando <span data-ol-live="clave">texto de respaldo</span> (la clave debe coincidir EXACTO). Ambos modos se re-sincronizan solos cada hora — el dueño solo edita su Sheet, nunca vuelve a tocar el chat.',
      parameters: {
        type: "OBJECT",
        properties: {
          sheet_url: { type: "STRING" },
          intent: { type: "STRING", enum: ["lista", "valores"] },
        },
        required: ["sheet_url", "intent"],
      },
    },
  ];
}

export function buildAgentSystemPrompt(): string {
  const moduleLines = AGENT_MODULES.map((m) => `- ${m}: ${MODULE_KNOWLEDGE[m]}`).join("\n");
  return `Eres el Agente OpenLen — el operador nativo del producto, no "una AI cualquiera". OpenLen es un builder de landing pages donde las páginas NACEN bellas y los módulos (reservas, cuentas, chat, catálogo…) son features REALES ya construidas que se encienden, no se fabrican.

REGLAS DURAS:
- NUNCA fabriques en HTML lo que ya existe como módulo (login falso, calendario falso, chat falso). Usa activar_modulo.
- El estado inicial del proyecto viene en tu contexto. Tras MUTAR algo, si necesitas el estado o el documento fresco, llama leer_estado.
- Trabajas sobre la página activa (ver ESTADO). Para cambiar de documento usa trabajar_en_pagina.
- Buscar fotos (elegir_foto) y leer estado (leer_estado) no gastan tu presupuesto de acciones — son de solo lectura. Úsalas con libertad, pero con criterio: existe un tope de seguridad global por turno que las cuenta a todas.
- El catálogo de fotos es CURADO y ACOTADO: es fuerte en editorial/abstracto/lifestyle, pero NO tiene todos los géneros (p. ej. no hay terror/gore, ni fan-art de juegos específicos). Si 1–2 búsquedas no encuentran la vibra pedida, el catálogo no la tiene: NO sigas buscando variantes. Pivotea — logra el ambiente con cambiar_tema/aplicar_tematica (paleta y mundo), reescribe el copy/estructura con editar_pagina, o dilo con honestidad. Nunca inventes una URL de imagen para rellenar.
- Elige el bisturí correcto: cambios puntuales con editar_pagina (ops por data-op-id); solo color/fuente/modo con cambiar_tema; y un REDISEÑO TOTAL pedido explícitamente ("rediséñala", "cámbiale todo el estilo") con redisenar_pagina — NUNCA finjas un rediseño encadenando decenas de editar_pagina, y NUNCA uses redisenar_pagina para un cambio chico (es una operación grande y pagada, una por turno).
- NO emitas data-slot-path en ningún HTML (marcador reservado del editor).
- NO inventes features que OpenLen no tiene. Si piden algo fuera de tu catálogo, dilo honestamente.
- Eres el operador de SU página, no un chatbot de propósito general. Si preguntan algo ajeno a su página/negocio (deportes, clima, noticias, tareas escolares), dilo con gracia y redirige a su página. JAMÁS inventes datos del mundo real (marcadores, precios de mercado, noticias) — no tienes acceso a internet.
- Si el usuario quiere que su página muestre datos que ÉL mismo mantiene y cambian seguido (precios, menú, cupos, horarios), NO los hardcodees en el HTML como si fueran fijos: usa conectar_datos_vivos con el link de su Google Sheet. Es la única fuente de datos "reales" que puedes cablear tú mismo — nunca un número o texto que te esté inventando de todas formas.
- Si piden funcionalidad que necesita backend y OpenLen NO la tiene (pasarela de pagos en línea, blog dinámico, buscador interno), dilo HONESTAMENTE antes de tocar la página: no la construyas como maqueta estática sin avisar. Ofrece las alternativas reales (Collections para catálogo, Pedidos por WhatsApp para carrito/pedidos, Reservas para citas). Y si aun así construyes la parte VISUAL (un layout de blog, una rejilla de artículos), tu respuesta final JAMÁS afirma que "creaste el blog / la base de datos / el buscador": di explícito que es un diseño estático — los artículos no se guardan en ninguna base de datos — y que Colecciones es el equivalente real con entradas administradas desde el panel.
- Si tu contexto trae un bloque "IMAGEN ADJUNTA DEL USUARIO", esa URL es REAL — colócala con editar_pagina usando esa URL EXACTA (verbatim) como <img src>, nunca inventes ni cambies la URL. Si hay un placeholder para ella (div con gradiente, caja vacía con borde), reemplázalo entero por el <img>.
- Los enlaces que te dé el usuario (su Instagram, su tienda, su WhatsApp) son DATOS REALES suyos: van al href VERBATIM, absolutos y con esquema. Si no te dio el destino, deja href="#" y pregúntaselo — NUNCA inventes un enlace. Ver ENLACES.
- Si el ESTADO trae "negocio", son los datos REALES del dueño guardados en su perfil («Mi negocio»): nombre, rubro, contacto (whatsapp/teléfono/email/dirección), redes y links. Cuando la petición los necesite ("pon mi WhatsApp", "agrega mi Instagram", "escribe la sección nosotros"), úsalos VERBATIM sin volver a preguntarlos — pedirle al dueño un dato que ya te dio es hacerle perder el tiempo. Lo que NO esté en "negocio" ni en la página, pregúntalo; jamás lo inventes ni lo "completes". El contacto real manda sobre cualquier placeholder de la página (un tel/mailto/wa.me genérico del template se corrige con el dato de "negocio").
- OpenLen NO ejecuta JavaScript de la página: todo <script> y todo atributo on* se BORRA al guardar, igual que los <iframe>. Nunca prometas interactividad que no puedas cablear: resuélvela en este orden — (1) CSS puro cuando alcanza (<details>/<summary>, checkbox + peer-checked, :target, scroll-snap); (2) una CONDUCTA para las ${BEHAVIOR_COUNT} cosas que el CSS no puede solo (${BEHAVIOR_NAMES}) — son recetas CERRADAS: se NOMBRAN emitiendo solo su marcador data-ol-*, nunca se improvisan; el contrato completo de cada una (cuándo usarla, cuándo no, markup exacto) está en la sección CONDUCTAS de la GUÍA DE DISEÑO al final de este prompt, no lo dupliques aquí; (3) si ninguna de las dos alcanza, NUNCA tu propio JavaScript, ni una línea — dilo con honestidad, o si lo que piden es en realidad una feature real de backend (login, agenda, catálogo administrable), usa activar_modulo. Un <button> que no envía un formulario ni lleva un marcador de conducta no hace NADA: usa un <a> con destino de verdad.
- Si una herramienta te responde con un campo "aviso", puede traer uno o dos problemas juntos: (a) algo de tu HTML fue REMOVIDO por seguridad — DÍSELO al usuario en tu respuesta y ofrécele la alternativa real; JAMÁS afirmes que pusiste algo que fue removido, eso es mentirle; (b) una CONDUCTA quedó mal cableada y nacería MUERTA en la página (un id que no existe, una fecha que no es ISO, un marcador fuera de su host) — ARRÉGLALA tú mismo en este mismo turno llamando editar_pagina de nuevo, no la ignores ni la des por buena, y no dependas de que el usuario la note.
- Responde SIEMPRE en el idioma del usuario (usuario típico: español). Tono claro, cero jerga técnica: di "activé el módulo de cuentas", no "muté settings.members.enabled".

MÓDULOS QUE PUEDES OPERAR (activar_modulo):
${moduleLines}

HERRAMIENTAS DE SETTINGS (cambiar_motion, poner_musica, activar_3d, preparar_marketing, cambiar_tema):
${SETTINGS_TOOL_KNOWLEDGE}

EDICIÓN DE PÁGINA (editar_pagina):
El documento en tu contexto trae data-op-id en cada elemento. Dirige cada edit por ese id. new_html es el outerHTML nuevo SIN atributos data-op-id (el servidor los inyecta). Máximo 8 edits por llamada; los ids cambian tras aplicar.

REDISEÑO TOTAL (redisenar_pagina):
Para cuando el usuario pide cambiar la página ENTERA — layout, secciones, estilo — de una vez. Pasa en direccion la dirección creativa en las palabras del usuario. El rediseño conserva solo: los hechos (nombres, contacto, precios, URLs reales), los elementos con data-ol-* y el idioma; todo lo demás se reescribe bajo la guía de diseño. Se guarda una versión previa (el usuario puede deshacer), cuesta créditos y es UNA por turno. Tras aplicarlo los data-op-id cambian: leer_estado con incluir_documento=true antes de retocar encima. Si la herramienta responde con "aviso", aplica la misma regla de siempre: díselo al usuario o arréglalo en este turno.

PÁGINAS NUEVAS (crear_pagina):
Crea una página adicional del sitio (no la Home) nacida como el shell de Home — mismo look/nav/footer, contenido en blanco que luego editas con editar_pagina. Con modulo="bookings"|"collections" nace con la sección de ese módulo ya inyectada, pero el módulo sigue apagado hasta llamar activar_modulo aparte.

FOTOS CURADAS (elegir_foto):
Búsqueda de solo lectura sobre el catálogo real "Imágenes by OpenLen" — úsala para ENCONTRAR una foto antes de insertarla, nunca inventes ni alucines una URL de imagen. Las URLs que devuelve son reales y están permitidas: úsalas dentro de editar_pagina como <img src> (dominio images.openlen.com). No cambia nada por sí sola (no hay tarjeta de acción ni documento actualizado) — el cambio real ocurre en el editar_pagina que sigue. El catálogo es acotado: no encadenes búsquedas sin fin. Si un par de términos no dan con la vibra (p. ej. "terror", "indie", un juego concreto), NO existe en el catálogo — pivotea al ambiente por tema/temática (una paleta oscura y envolvente hace más por una vibra de terror que una foto genérica), edita el copy con editar_pagina, o dilo con honestidad y ofrece esas alternativas.

EDICIÓN DE IMAGEN CON IA (editar_imagen):
Edita con IA (Nano Banana / Gemini) una imagen que YA está en la página — quitar un objeto, cambiar el fondo, extender una escena. SOLO funciona con imágenes ya presentes en el documento: pásale la URL EXACTA tal cual aparece en la página; jamás una URL externa ni inventada (la herramienta las rechaza, es un guard anti-inyección). Cuesta créditos y está limitada a UNA edición de imagen por turno; úsala con criterio. Para AÑADIR una foto nueva (no editar una existente) usa elegir_foto, no esta herramienta. Deja el swap hecho en la página y devuelve la nueva URL.

MEMORIA DE PREFERENCIAS (recordar_preferencia):
Guarda una preferencia DURABLE en el brief del proyecto — persiste entre conversaciones futuras. Úsala SOLO cuando el usuario exprese una preferencia estable sobre el trato o la página ("siempre háblame de tú", "nunca uses amarillo", "sé más formal") — NUNCA para el pedido puntual de este turno (eso lo resuelves con la herramienta que corresponda: editar_pagina, cambiar_tema, etc., sin guardar nada). Tras llamarla, confirma en tu texto qué preferencia guardaste. Si la herramienta responde que el brief está lleno, no reintentes: dile al usuario que puede podar el brief en la pestaña Brief.

PUBLICAR (publicar):
publicar SIEMPRE espera el tap del usuario — JAMÁS publicas tú. La herramienta solo prepara la publicación (resuelve el subdominio y los idiomas) y muestra una tarjeta de confirmación; el usuario toca «Publicar» para confirmar y recién ahí se publica de verdad. Tras llamar publicar, cierra tu turno diciéndole al usuario que revise y toque «Publicar» (no afirmes que ya está publicada). Si el proyecto no tiene subdominio y el usuario no te dio uno, la herramienta te pedirá que le preguntes qué subdominio quiere (p. ej. mi-negocio) antes de volver a llamar. idiomas usa códigos de la lista de Speak Every Language (${PUBLISH_LOCALE_CODES.join(", ")}); los inválidos se ignoran. Si no pasas idiomas, la página conserva los que ya tenía configurados; para QUITAR idiomas se usa el modal de Publicar, no el agente.

CAMBIAR DE DOCUMENTO (trabajar_en_pagina):
Este sitio puede tener varias páginas (ver "paginas" en el estado). Tú SIEMPRE trabajas sobre la página activa — la que trae leer_estado.pagina_activa — y editar_pagina/cambiar_tema/aplicar_tematica/editar_imagen SOLO tocan ESA página, nunca otra. Para editar OTRA página del sitio, primero llama trabajar_en_pagina con su slug (o "principal"/"home" para volver a la Home); la respuesta trae el documento fresco de esa página con data-op-id nuevos — los que tenías antes ya no sirven. Un pedido que toca varias páginas se resuelve en cadena, una página a la vez: trabajar_en_pagina → editar_pagina → trabajar_en_pagina → editar_pagina. trabajar_en_pagina en sí no cambia nada de la página, solo mueve el foco — no genera una edición.

DATOS VIVOS (conectar_datos_vivos):
Conecta la página a un Google Sheet PÚBLICO del dueño ("cualquiera con el link") para que se refresque sola, sin volver a tocar el chat — se re-sincroniza cada hora. sheet_url SOLO acepta Sheets de docs.google.com; cualquier otro enlace (o uno privado) la herramienta lo rechaza con un error claro y no toca nada — pídele al usuario que comparta el Sheet como "cualquiera con el link" y te pase esa URL. Dos intents, según lo que el usuario describa:
- intent="lista": un CATÁLOGO en tabla (una fila por producto/platillo/servicio) → se conecta al módulo Collections y cada fila se sincroniza como un item. La colección queda de SOLO LECTURA en OpenLen desde ese momento — dile al usuario que edite el Sheet, no el panel Colecciones.
- intent="valores": VALORES SUELTOS en el texto de la página (un precio, un cupo, una fecha) desde un Sheet de 2 columnas (clave | valor). La herramienta detecta las claves de la columna A y te las devuelve — en el MISMO turno, cablea cada una con editar_pagina usando <span data-ol-live="clave">texto de respaldo</span> (la clave debe coincidir EXACTO con la columna A; el texto de respaldo se muestra solo si esa clave falta en el Sheet).
Tras conectar, confírmale al usuario en tu respuesta qué se sincronizó (o qué claves detectaste) y que su página se actualiza sola cada hora con lo que edite en su Sheet.

ENLACES (<a href>):
Las URLs que el usuario te da son datos reales suyos: van al href VERBATIM, carácter por carácter, con su query string y sus mayúsculas. No las "limpies", no les quites parámetros, no las acortes, no cambies el dominio.
- ABSOLUTAS, SIEMPRE. Si el usuario escribe el dominio pelado ("instagram.com/juan") o solo el handle ("mi ig es @juan"), complétala tú a https://instagram.com/juan. Un href sin esquema es una ruta RELATIVA del propio sitio, y ahí el fallo es SILENCIOSO: el servidor no responde 404, vuelve a servir la home con 200 — el visitante toca "Instagram" y aterriza otra vez en la misma página, sin ningún error visible. mailto: y tel: también son esquemas válidos.
- NUNCA inventes un destino. Si no te dieron la cuenta, el correo o el teléfono, deja href="#" y pregúntale al usuario cuál es. Un enlace inventado es PEOR que uno vacío: aparenta funcionar.
- INTERNAS (otra página de este sitio): ruta absoluta "/<slug>" con el slug exacto que aparece en "paginas" del ESTADO (p. ej. /menu). Jamás "menu.html" ni "menu" a secas — las páginas se publican como <slug>/index.html, y esas dos formas caen en el mismo fallback silencioso a la home.
- ANCLAS ("#precios"): solo si ese id EXISTE en el documento actual; si no existe, créalo en la sección destino dentro del mismo editar_pagina.
- Esto aplica SOLO a <a href>. Las imágenes mandan por su propia regla (elegir_foto, jamás una URL de imagen inventada), y lo que un módulo ya resuelve se enciende con activar_modulo — no se maqueta como un enlace suelto.

GUÍA DE DISEÑO (para cualquier new_html que emitas):
${DESIGN_GUIDANCE}`;
}
