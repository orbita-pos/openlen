// lib/agent/catalog.ts — LA fuente única del conocimiento del agente (spec §5).
// De aquí salen las DOS mitades: las function declarations para Gemini y la
// sección de conocimiento del system prompt. Módulo nuevo ⇒ una entrada aquí.
import { DESIGN_GUIDANCE } from "@/lib/design-guidance";
import { POST_REGISTER } from "@/lib/marketing/post-templates/admin-schemas";
import { THEME_PRESETS } from "@/lib/theme-presets";

export const AGENT_MODULES = [
  "members", "bookings", "collections", "chat", "whatsapp", "comments",
] as const;
export type AgentModule = (typeof AGENT_MODULES)[number];

export const MOTION_LOOKS = ["calm", "editorial", "dramatic", "off"] as const;
export type MotionLook = (typeof MOTION_LOOKS)[number];

const MARKETING_REGISTERS = POST_REGISTER.options;
const THEME_PRESET_IDS = THEME_PRESETS.map((p) => p.id);

// Conocimiento de las 5 herramientas de settings/tema F2 (motion, música,
// 3D, marketing, tema) — igual que MODULE_KNOWLEDGE, va en el system prompt.
const SETTINGS_TOOL_KNOWLEDGE = `- cambiar_motion: coreografía de scroll (Motion Looks) — beads sutiles en la segunda fila, puro CSS. Se HORNEA al publicar; el preview del editor no la anima en vivo. Usa look="off" para apagarla.
- poner_musica: reproductor flotante de música. SOLO puede usar pistas YA SUBIDAS a este proyecto — jamás una URL externa (el guard del servidor la rechazaría igual). Si no hay pistas disponibles, dile al usuario que suba una en el panel Música y no insistas con asset_url inventado.
- activar_3d: enciende o apaga la escena 3D de fondo (Born With Depth). Esto solo prende/apaga — el diseño fino (modelo, gestos, cámara) se ajusta en el panel 3D del editor, no por el agente.
- preparar_marketing: fija el rubro (registro) del Marketing Kit — posts curados zero-AI — y si deben combinarse con la paleta/fuente de la página. Después de usarla, dirige al usuario al tab Marketing para ver y copiar los posts.
- cambiar_tema: re-tematiza la página al instante (sin llamada de IA) — igual que un click en Looks del inspector. accent (hex) deriva una paleta completa con contraste WCAG garantizado; fuente y radius toman SOLO ese rasgo del preset nombrado (ids: ${THEME_PRESET_IDS.join(", ")}), útil para combinar look a piezas. Pásalos juntos o por separado; modo elige la variante clara/oscura del accent.`;

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
      name: "activar_modulo",
      description:
        "Enciende (o apaga) un MÓDULO REAL de OpenLen en este proyecto — la misma acción que el botón del panel Módulos. NUNCA fabriques en HTML lo que un módulo ya resuelve.",
      parameters: {
        type: "OBJECT",
        properties: {
          modulo: { type: "STRING", enum: [...AGENT_MODULES] },
          encender: { type: "BOOLEAN" },
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
        "Pone o quita la pista del reproductor flotante de música de la página. SOLO puede usar una pista YA SUBIDA por el dueño a este proyecto — nunca una URL externa. Si accion=\"poner\" no traes un asset_url válido de las pistas subidas, la herramienta responde con la lista de pistas disponibles (o te dice que no hay ninguna).",
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
        `Re-tematiza la página al instante escribiendo los tokens --ol-* en <html> — igual que un click en Looks del inspector, sin llamada de IA. accent (hex #rgb o #rrggbb) deriva una paleta completa (fondo/superficie/texto/borde/acento) con contraste WCAG garantizado. fuente y radius toman SOLO ese rasgo del preset nombrado (ids válidos: ${THEME_PRESET_IDS.join(", ")}) sin tocar los demás tokens — para combinar look a piezas. Pasa cualquier combinación de accent/fuente/radius; al menos uno es requerido.`,
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
  ];
}

export function buildAgentSystemPrompt(): string {
  const moduleLines = AGENT_MODULES.map((m) => `- ${m}: ${MODULE_KNOWLEDGE[m]}`).join("\n");
  return `Eres el Agente OpenLen — el operador nativo del producto, no "una AI cualquiera". OpenLen es un builder de landing pages donde las páginas NACEN bellas y los módulos (reservas, cuentas, chat, catálogo…) son features REALES ya construidas que se encienden, no se fabrican.

REGLAS DURAS:
- NUNCA fabriques en HTML lo que ya existe como módulo (login falso, calendario falso, chat falso). Usa activar_modulo.
- El estado inicial del proyecto viene en tu contexto. Tras MUTAR algo, si necesitas el estado o el documento fresco, llama leer_estado.
- Extiende, no reemplaces: edita con editar_pagina (ops por data-op-id), nunca reescrituras totales en F1.
- NO emitas data-slot-path en ningún HTML (marcador reservado del editor).
- NO inventes features que OpenLen no tiene. Si piden algo fuera de tu catálogo, dilo honestamente.
- Responde SIEMPRE en el idioma del usuario (usuario típico: español). Tono claro, cero jerga técnica: di "activé el módulo de cuentas", no "muté settings.members.enabled".

MÓDULOS QUE PUEDES OPERAR (activar_modulo):
${moduleLines}

HERRAMIENTAS DE SETTINGS (cambiar_motion, poner_musica, activar_3d, preparar_marketing, cambiar_tema):
${SETTINGS_TOOL_KNOWLEDGE}

EDICIÓN DE PÁGINA (editar_pagina):
El documento en tu contexto trae data-op-id en cada elemento. Dirige cada edit por ese id. new_html es el outerHTML nuevo SIN atributos data-op-id (el servidor los inyecta). Máximo 8 edits por llamada; los ids cambian tras aplicar.

GUÍA DE DISEÑO (para cualquier new_html que emitas):
${DESIGN_GUIDANCE}`;
}
