import { archivosDelHistorial, tipoArchivo, type ArchivoAdjunto } from "./chat/archivos";
// SÓLO DEV: un cliente de mentira con datos fijos, para revisar las pantallas
// en el navegador sin entrar, sin servidor y sin gastar (`?muestra=1`). Nunca
// se empaqueta: main.tsx sólo lo usa con `import.meta.env.DEV`.
// Pieza 2: una conversación de varios días y un turno de mentira que «trabaja»
// (eventos con esperas, como el de verdad) y se guarda al acabar.
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { StoredChatTurn } from "@/lib/projects/types";
import type { DatosEquipo, AccionEquipo } from "./equipo/tipos";

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
const pagina = (antes: boolean) => `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#fff9ed;color:#392518;font:16px Georgia,serif}header{padding:22px;border-bottom:1px solid #d5b990;display:flex;justify-content:space-between;font:12px system-ui}main{padding:45px 26px}small{font:11px system-ui;letter-spacing:.2em;text-transform:uppercase}h1{font-size:49px;line-height:1.05;font-weight:400;margin:18px 0}p{line-height:1.6}figure{margin:26px 0;border-radius:80px 80px 10px 10px;background:#dcb57c;padding:50px 20px;text-align:center;font-size:80px}button{background:#573723;color:#fff;border:0;padding:14px 22px;border-radius:25px;font:13px system-ui}.nota{background:#e5eccf;padding:16px;border-radius:12px}</style><header><b>LUNA · PANADERÍA</b><span>Desde 1998</span></header><main><small>Hecho aquí, cada mañana</small><h1>${antes ? "El pan de cada día." : "Un buen día empieza con pan."}</h1><p>Pan de masa madre, café recién hecho y algo dulce para compartir.</p><figure aria-label="Pan artesanal">🥐</figure>${antes ? "" : '<p class="nota">También por la tarde · de 17:00 a 20:00</p>'}<button>Encargar para mañana ↗</button><p style="font:11px system-ui;opacity:.55;margin-top:35px">Muestra de Len · datos de ejemplo</p></main></html>`;
let objetivo: StoredChatTurn["goal"] | undefined;
let actualizado = false;
const equipoMuestra: DatosEquipo = {
  yo: "ana", rol: "dueno", puedeLen: true,
  personas: [{ userId: "ana", nombre: "Ana", rol: "dueno" }, { userId: "luis", nombre: "Luis Pérez", rol: "editor" }],
  mensajes: [{ id: "eq-m1", autorId: "luis", autor: "Luis Pérez", texto: "@Ana ya revisé el horario. ¿Te parece si añadimos los sábados?", fecha: Date.now() - HORA, fotos: [] }],
  hilos: [{ id: "eq-h1", ruta: "/index.html", linea: 24, codigo: '<h2 class="horario">De lunes a viernes, de 8:00 a 20:00</h2>', estado: "abierto", creadoPor: "luis", createdAt: new Date(Date.now() - HORA).toISOString(), sinVer: 1,
    mensajes: [{ id: "eq-r1", autorId: "luis", autor: "Luis Pérez", texto: "@Ana ¿abrimos también el sábado por la mañana?", filaId: null, createdAt: new Date(Date.now() - HORA).toISOString() }] }],
};

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms * RITMO.x));

/** Lo que le escribes al turno que corre; va a su fila con «↳», como en el servidor. */
let correcciones: string[] = [];

function turnoDeMentira(prompt: string, foto?: string, turnId?: string, goal?: "create" | "resume", archivos: readonly ArchivoAdjunto[] = []): Response {
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
        ...(archivos.length ? {attachedFiles: [...archivos]} : {}),
        assistantReasoning: dicho,
        status: "applied",
        appliedAt: Date.now(),
      });
      correcciones = [];
      if (goal) objetivo = { id: "objetivo-muestra", revision: 1, objective: prompt, phase: "paused", maxGoalRounds: 5, roundsStarted: 1, activation: "disarmed" };
      actualizado = true;
      c.close();
    },
  });
  return new Response(cuerpo, { headers: { "content-type": "text/event-stream" } });
}

export const clienteDeMuestra: ClienteDeOpenLen = {
  async pedir(ruta, init) {
    if (ruta.startsWith("/api/movil/equipo")) {
      const params = new URLSearchParams(location.search);
      if (params.has("equipoSinServidor")) return new Response("Not found", { status: 404 });
      if (!init?.method || init.method === "GET") {
        const lector = params.has("equipoLector");
        return Response.json({ ...equipoMuestra, rol: lector ? "lector" : "dueno", puedeLen: !lector });
      }
      const b = JSON.parse(String(init.body ?? "{}")) as AccionEquipo & { projectId: string };
      if (b.accion !== "vistas" && params.has("equipoError")) return new Response(null, { status: 503 });
      if (b.accion === "mensaje") {
        const id = `eq-m-${Date.now()}`;
        equipoMuestra.mensajes.push({ id, autorId: "ana", autor: "Ana", texto: b.texto, fecha: Date.now(), fotos: [] });
        HISTORIAL.push({ id, tipo: "persona", autorId: "ana", autor: "Ana", userText: b.texto, assistantReasoning: "", status: "applied", appliedAt: Date.now() });
        return Response.json({ id });
      }
      if (b.accion === "respuesta") {
        const h = equipoMuestra.hilos.find(h => h.id === b.hiloId);
        if (!h) return Response.json({ error: "not_found" }, { status: 404 });
        h.estado = "abierto";
        h.mensajes.push({ id: `eq-r-${Date.now()}`, autorId: "ana", autor: "Ana", texto: b.texto, filaId: null, createdAt: new Date().toISOString() });
      }
      if (b.accion === "estado") { const h = equipoMuestra.hilos.find(h => h.id === b.hiloId); if (h) h.estado = b.estado; }
      if (b.accion === "vistas") equipoMuestra.hilos.forEach(h => { if (b.hilos?.includes(h.id)) h.sinVer = 0; });
      return Response.json({ ok: true });
    }
    if (ruta === "/api/projects") return Response.json({ projects: PROYECTOS });
    if (ruta.startsWith("/api/projects/m1/preview")) return Response.json({ enabled: true, token: "muestra", __muestraHtml: pagina(false) });
    if (ruta === "/api/projects/m1") {
      const historia = HISTORIAL.map((t, i) => ({ ...t, ...(objetivo && i === HISTORIAL.length - 1 ? { goal: objetivo } : {}) }));
      return Response.json({ project: { ...PROYECTOS[0], rol: "dueno", deployUrl: "https://panaderia-luna.example/", hasUnpublishedChanges: actualizado, chatHistory: historia } });
    }
    if (ruta.startsWith("/api/movil/entrega")) return Response.json({ comparacion: { antes: { html: pagina(true), fecha: "2026-10-01T12:00:00Z" }, ahora: { html: pagina(false), fecha: new Date().toISOString() } } });
    if (ruta === "/api/subdomains/check") return Response.json({ available: true });
    if (ruta === "/api/projects/m1/publish") { actualizado = false; return Response.json({ url: "https://panaderia-luna.example/", publishedAt: new Date().toISOString() }); }
    if (ruta === "/api/agent/encargo") { objetivo = undefined; return Response.json({ ok: true }); }
    if (ruta === "/api/agent/cancelar") return Response.json({ ok: true });
    if (ruta.startsWith("/api/voz/visitas")) return Response.json(VISITAS);
    if (ruta === "/api/agent") {
      const b = JSON.parse(String(init?.body ?? "{}")) as { prompt?: unknown; attachedImage?: { url?: unknown }; attachedFiles?: unknown; turnId?: unknown; goal?: "create" | "resume" };
      return turnoDeMentira(
        String(b.prompt ?? ""),
        typeof b.attachedImage?.url === "string" ? b.attachedImage.url : undefined,
        typeof b.turnId === "string" ? b.turnId : undefined,
        b.goal,
        archivosDelHistorial(b.attachedFiles),
      );
    }
    if (ruta === "/api/agent/dirigir") {
      const b = JSON.parse(String(init?.body ?? "{}")) as { texto?: unknown };
      correcciones.push(String(b.texto ?? ""));
      return Response.json({ ok: true, maximo: 2000 });
    }
    if (ruta === "/api/upload") {
      const form=init?.body instanceof FormData?init.body:null;
      const file=form?.get("file");
      if(file instanceof File && tipoArchivo(file.name)) return Response.json({url:`https://uploads.example.test/uploads/${form?.get("generationId")??"m1"}/${encodeURIComponent(file.name)}`,size:file.size});
      return Response.json({url:FOTO});
    }
    if (ruta === "/api/voz/nota") {
      await espera(900);
      return Response.json({ texto: "Pon el horario de la tarde, de cinco a ocho." });
    }
    return new Response(null, { status: 404 });
  },
  avisarAlCerrar() {},
};
