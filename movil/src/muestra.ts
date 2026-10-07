// SÓLO DEV: un cliente de mentira con datos fijos, para revisar las pantallas
// en el navegador sin entrar, sin servidor y sin gastar (`?muestra=1`). Nunca
// se empaqueta: main.tsx sólo lo usa con `import.meta.env.DEV`.
// Pieza 2: una conversación de varios días y un turno de mentira que «trabaja»
// (eventos con esperas, como el de verdad) y se guarda al acabar.
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { StoredChatTurn } from "@/lib/projects/types";

/** Multiplica las esperas del turno de mentira; las pruebas lo ponen a 0. */
export const RITMO = { x: 1 };

const HORA = 3_600_000;
const FOTO =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="264"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#FFB86B"/><stop offset="1" stop-color="#E8560A"/></linearGradient></defs><rect width="360" height="264" fill="url(#g)"/><circle cx="180" cy="132" r="60" fill="#FFE4CC"/></svg>');

const PROYECTOS = [{ id: "m1", title: "Panadería Luna", subdomain: "panaderia-luna", publishedAt: "2026-09-29T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" }];
const HISTORIAL: StoredChatTurn[] = [
  { id: "t1", userText: "Hazme una página para mi panadería", assistantReasoning: "¡Ya quedó tu página!\n\nLe puse tus panes, un formulario para encargar pasteles y cómo llegar.", status: "applied", appliedAt: Date.now() - 26 * HORA },
  { id: "t2", userText: "Pon esta foto en la portada", attachedImage: { url: FOTO }, assistantReasoning: "Puse tu foto en la portada, grande y con el nombre encima.", status: "applied", appliedAt: Date.now() - 2 * HORA },
  { id: "t3", userText: "¿Cómo va?", assistantReasoning: "Esta semana entraron 312 personas.\n\n6 de cada 10 llegan de Instagram.", status: "applied", noDocChange: true, appliedAt: Date.now() - HORA },
];
const VISITAS = { vistas: 312, personas: 241, hoy: 27, porDia: [31, 38, 44, 71, 52, 48, 27].map((v, i) => ({ dia: `2026-09-${23 + i}`, vistas: v })), origen: { origen: "Instagram", deCadaDiez: 6 } };

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms * RITMO.x));

/** Lo que le escribes al turno que corre; va a su fila con «↳», como en el servidor. */
let correcciones: string[] = [];

function turnoDeMentira(prompt: string, foto?: string, turnId?: string): Response {
  // Con una foto, Len pregunta dónde la pone antes de ponerla (Jesús, 01/10):
  // mira la página, pregunta, y no la cambia.
  const dicho = foto
    ? "¡Buena foto! Puede ir en la portada, en lugar de la que hay, o en «Visítanos», junto al mapa.\n\n¿Dónde la pongo?"
    : `Listo: ${prompt.charAt(0).toLowerCase()}${prompt.slice(1, 80)}.\n\nYa lo ves en tu página.`;
  const eventos: [string, unknown, number][] = foto
    ? [
        ["turno", { turnoId: "muestra-vivo" }, 60],
        ["action", { tool: "Read", status: "running", summary: "" }, 900],
        ["action", { tool: "view_page", status: "running", summary: "" }, 1200],
        ["text", { text: dicho }, 500],
        ["action", { tool: "preguntar", status: "done", summary: "" }, 50],
        ["done", { turns: 1, toolCalls: 3 }, 100],
      ]
    : [
        ["turno", { turnoId: "muestra-vivo" }, 60],
        ["action", { tool: "Read", status: "running", summary: "" }, 500],
        ["action", { tool: "Edit", status: "running", summary: "" }, 1300],
        ["html", { html: "", page: null }, 300],
        ["action", { tool: "view_page", status: "running", summary: "" }, 1300],
        ["text", { text: dicho.slice(0, 20) }, 500],
        ["text", { text: dicho.slice(20) }, 250],
        ["done", { turns: 1, toolCalls: 3 }, 100],
      ];
  const enc = new TextEncoder();
  const cuerpo = new ReadableStream<Uint8Array>({
    async start(c) {
      for (const [nombre, datos, ms] of eventos) {
        await espera(ms);
        c.enqueue(enc.encode(`event: ${nombre}\ndata: ${JSON.stringify(datos)}\n\n`));
      }
      HISTORIAL.push({
        // Como el servidor: la fila lleva el id que mandó la app.
        id: turnId ?? `t${HISTORIAL.length + 1}`,
        // Como el servidor: lo que se le mandó a Len es tu mensaje (con la foto sola, lo que la app le pidió de tu parte).
        userText: [prompt, ...correcciones.map((c) => `↳ ${c}`)].join("\n"),
        ...(foto ? { attachedImage: { url: foto }, noDocChange: true, actions: [{ tool: "preguntar", status: "done" as const, summary: "" }] } : {}),
        assistantReasoning: dicho,
        status: "applied",
        appliedAt: Date.now(),
      });
      correcciones = [];
      c.close();
    },
  });
  return new Response(cuerpo, { headers: { "content-type": "text/event-stream" } });
}

export const clienteDeMuestra: ClienteDeOpenLen = {
  async pedir(ruta, init) {
    if (ruta === "/api/projects") return Response.json({ projects: PROYECTOS });
    if (ruta.startsWith("/api/projects/m1/preview")) return Response.json({ enabled: true, token: "muestra" });
    if (ruta === "/api/projects/m1") return Response.json({ project: { ...PROYECTOS[0], chatHistory: [...HISTORIAL] } });
    if (ruta.startsWith("/api/voz/visitas")) return Response.json(VISITAS);
    if (ruta === "/api/agent") {
      const b = JSON.parse(String(init?.body ?? "{}")) as { prompt?: unknown; attachedImage?: { url?: unknown }; turnId?: unknown };
      return turnoDeMentira(
        String(b.prompt ?? ""),
        typeof b.attachedImage?.url === "string" ? b.attachedImage.url : undefined,
        typeof b.turnId === "string" ? b.turnId : undefined,
      );
    }
    if (ruta === "/api/agent/dirigir") {
      const b = JSON.parse(String(init?.body ?? "{}")) as { texto?: unknown };
      correcciones.push(String(b.texto ?? ""));
      return Response.json({ ok: true, maximo: 2000 });
    }
    if (ruta === "/api/upload") return Response.json({ url: FOTO });
    if (ruta === "/api/voz/nota") {
      await espera(900);
      return Response.json({ texto: "Pon el horario de la tarde, de cinco a ocho." });
    }
    return new Response(null, { status: 404 });
  },
  avisarAlCerrar() {},
};
