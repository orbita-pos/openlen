// lib/agent/catalog.ts — LA fuente única del conocimiento del agente (spec §5).
// De aquí salen las DOS mitades: las function declarations para Gemini y la
// sección de conocimiento del system prompt. Módulo nuevo ⇒ una entrada aquí.
import { DESIGN_GUIDANCE } from "@/lib/design-guidance";

export const AGENT_MODULES = [
  "members", "bookings", "collections", "chat", "whatsapp", "comments",
] as const;
export type AgentModule = (typeof AGENT_MODULES)[number];

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

EDICIÓN DE PÁGINA (editar_pagina):
El documento en tu contexto trae data-op-id en cada elemento. Dirige cada edit por ese id. new_html es el outerHTML nuevo SIN atributos data-op-id (el servidor los inyecta). Máximo 8 edits por llamada; los ids cambian tras aplicar.

GUÍA DE DISEÑO (para cualquier new_html que emitas):
${DESIGN_GUIDANCE}`;
}
