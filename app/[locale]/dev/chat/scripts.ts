// Los turnos de ejemplo de /dev/chat: un guion de eventos del stream de
// /api/agent por cada estado que el chat tiene que saber pintar (el inventario,
// `plans/new-chat/inventory.md`, secciones C y D). Los eventos tienen la forma
// EXACTA de `AgentStreamEvent` (lib/agent/loop.ts) y de lo que añade la ruta
// (`turno`, `cambios`, el `done` con `centicredits`…), así que el chat los lee
// por el mismo camino que los de verdad. Sólo existe en desarrollo.

/** Las preguntas de los guiones de ask_user_question: una de una sola respuesta,
 *  con la recomendada, y otra de varias. */
const PREGUNTAS_DE_EJEMPLO = [
  {
    id: "anticipacion",
    header: "Encargos",
    question: "¿Con cuánta anticipación aceptas encargos de pasteles?",
    options: [
      { label: "48 horas (Recommended)", description: "Lo que dice tu ficha; da tiempo a hornear y decorar." },
      { label: "Una semana", description: "Para pasteles grandes o con decoración especial." },
    ],
  },
  {
    id: "dias",
    question: "¿Qué días entregas?",
    multiSelect: true,
    options: [{ label: "Lunes a viernes" }, { label: "Sábado" }, { label: "Domingo" }],
  },
];

export type ScenarioId =
  | "edit"
  | "question"
  | "askLive"
  | "askEnded"
  | "terminal"
  | "publish"
  | "reply"
  | "noCredits"
  | "error"
  | "cut"
  | "drop"
  | "slow"
  | "window"
  | "otherPage"
  | "tooLarge"
  | "agentOff"
  | "versions";

export const SCENARIOS: readonly ScenarioId[] = [
  "edit",
  "question",
  "askLive",
  "askEnded",
  "terminal",
  "publish",
  "reply",
  "noCredits",
  "error",
  "cut",
  "drop",
  "slow",
  "window",
  "otherPage",
  "tooLarge",
  "agentOff",
  "versions",
];

export const SCENARIO_LABEL: Readonly<Record<ScenarioId, string>> = {
  edit: "Editar (fotos + formulario)",
  question: "Pregunta (preguntar, fila vieja)",
  askLive: "Pregunta con opciones (espera dentro del turno)",
  askEnded: "Pregunta con opciones (cerró el turno)",
  terminal: "Terminal + web",
  publish: "Publicar",
  reply: "Borrador de respuesta",
  noCredits: "Sin créditos",
  error: "Error",
  cut: "Cortado (techo)",
  drop: "Se cae la red (reenganche)",
  slow: "Piensa mucho (para ■)",
  window: "Charla recortada",
  otherPage: "Cambia otra página",
  tooLarge: "Página enorme (413)",
  agentOff: "Len apagado → ai-design",
  versions: "Lee las versiones",
};

/** Un paso del guion: un evento, tras `ms` de espera. */
export interface ScriptStep {
  readonly ms: number;
  readonly event: string;
  readonly data: unknown;
}

const wait = (ms: number, event: string, data: unknown): ScriptStep => ({ ms, event, data });

export function pickScenario(prompt: string): ScenarioId {
  const p = prompt.toLowerCase();
  if (p.includes("crédito") || p.includes("credit")) return "noCredits";
  if (p.includes("error") || p.includes("falla")) return "error";
  if (p.includes("corta") || p.includes("techo")) return "cut";
  if (p.includes("red ") || p.includes("cae")) return "drop";
  if (p.includes("piensa") || p.includes("lento")) return "slow";
  if (p.includes("versi")) return "versions";
  if (p.includes("publica")) return "publish";
  if (p.includes("respond") || p.includes("mensaje")) return "reply";
  if (p.includes("terminal") || p.includes("busca") || p.includes("internet") || p.includes("móvil")) return "terminal";
  if (p.includes("formulario") || p.includes("encarg")) return "question";
  return "edit";
}

/** Un documento con sus secciones, para que «Ver» y el diff tengan dónde ir. */
export function demoPage(o: { photos: boolean; form: boolean }): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Luna panadería</title>
<style>
body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#FBF6EE;color:#2B1D14}
header,section,footer{padding:40px 48px}header{display:flex;justify-content:space-between;align-items:center;padding:20px 48px}
h1{font:400 56px/1.05 Georgia,serif;margin:0 0 16px}h2{font:400 36px Georgia,serif;margin:0 0 12px}
.hero{display:grid;grid-template-columns:1.2fr 1fr;gap:32px;align-items:center}
.ph{border-radius:20px;min-height:280px;background:linear-gradient(160deg,#F1E3CD,#E2C9A5)}
.ph.real{background:url(https://images.unsplash.com/photo-1509440159596-0249088772ff?w=900) center/cover}
form{display:grid;gap:10px;max-width:420px}input,select{padding:10px;border:1px solid #E2D3BF;border-radius:10px;background:#fff}
button{background:#2B1D14;color:#fff;border:0;border-radius:999px;padding:10px 18px}
footer{background:#2B1D14;color:#F1E3CD}
</style></head>
<body>
<header><b>Luna <i>panadería</i></b><nav>Panes · Encargos · Visítanos</nav></header>
<section class="hero" id="portada"><div><h1>Pan hecho a mano, cada mañana</h1><p>Masa madre de veinte horas y el mismo horno de siempre.</p></div><div class="ph${o.photos ? " real" : ""}"></div></section>
<section id="panes"><h2>Nuestros panes</h2><p>Lo que sale del horno cada día.</p></section>
${o.form ? `<section id="encargos"><h2>Encarga tu pastel</h2><form><input placeholder="Tu nombre"><input placeholder="dd/mm"><select><option>Chocolate</option></select><button type="button">Enviar encargo</button></form></section>\n` : ""}<section id="visitanos"><h2>Visítanos</h2><p>Calle de la Luna 12, Centro · Lunes a sábado 7:00–20:00</p></section>
<footer>Tel. 951 123 4567</footer>
</body></html>`;
}

const DONE = (extra: Record<string, unknown> = {}) => ({ turns: 4, toolCalls: 6, centicredits: 118, durationMs: 26_400, ...extra });

const BEFORE_FILE = demoPage({ photos: false, form: false });
const AFTER_FILE = demoPage({ photos: true, form: true });

export function scriptFor(id: ScenarioId, turnoId: string): ScriptStep[] {
  const head = [wait(150, "turno", { turnoId })];
  switch (id) {
    case "edit":
      return [
        ...head,
        wait(900, "text", { text: "Voy con las dos cosas: primero fotos de pan recién hecho para la portada y después el formulario de encargos.\n\n" }),
        wait(300, "action", { tool: "Read", status: "running", summary: "index.html" }),
        wait(700, "action", { tool: "Read", status: "done", summary: "index.html" }),
        wait(200, "action", { tool: "elegir_foto", status: "running", summary: "" }),
        wait(1400, "action", { tool: "elegir_foto", status: "done", summary: "pan de masa madre" }),
        wait(200, "action", { tool: "Edit", status: "running", summary: "index.html" }),
        wait(1200, "html", { html: demoPage({ photos: true, form: false }), page: null, versionPrevia: "v-antes" }),
        wait(100, "action", {
          tool: "Edit",
          status: "done",
          summary: "index.html",
          cambio: "cambio",
          edits: 2,
          ops: [{ tipo: "replace", donde: "documento", etiqueta: "la portada", indice: 1 }],
        }),
        wait(300, "action", { tool: "Edit", status: "running", summary: "index.html" }),
        wait(1200, "html", { html: AFTER_FILE, page: null, versionPrevia: "v-medio" }),
        wait(100, "action", {
          tool: "Edit",
          status: "done",
          summary: "index.html",
          cambio: "cambio",
          edits: 3,
          ops: [
            { tipo: "insert_after", donde: "documento", etiqueta: "«Encarga tu pastel»", indice: 3 },
            { tipo: "attrs", donde: "estilos", etiqueta: "", indice: -1 },
          ],
        }),
        wait(200, "action", { tool: "verificar_diseno", status: "running", summary: "" }),
        wait(1500, "action", { tool: "verificar_diseno", status: "done", summary: "ok", observacion: "Las fotos se ven nítidas y el formulario cabe en el móvil." }),
        wait(300, "text", { text: "Listo. Puse tres fotos de pan recién hecho en la portada y añadí «Encarga tu pastel» con su formulario. Los encargos te llegarán a la **Bandeja**." }),
        wait(200, "cambios", { ficheros: [{ ruta: "/index.html", tipo: "texto", antes: BEFORE_FILE, despues: AFTER_FILE }] }),
        wait(100, "done", DONE({ mutoDurable: true })),
      ];
    case "question":
      return [
        ...head,
        wait(800, "text", { text: "Para el formulario de encargos me falta un dato que sólo sabes tú.\n\n" }),
        wait(200, "action", { tool: "Grep", status: "running", summary: "anticipación" }),
        wait(700, "action", { tool: "Grep", status: "done", summary: "anticipación" }),
        wait(200, "action", { tool: "preguntar", status: "running", summary: "" }),
        wait(300, "action", {
          tool: "preguntar",
          status: "done",
          summary: "",
          pregunta: "¿Con cuánta anticipación aceptas encargos de pasteles?",
        }),
        wait(100, "text", { text: "¿Con cuánta anticipación aceptas encargos de pasteles?" }),
        wait(100, "done", DONE({ centicredits: 41, durationMs: 6_200 })),
      ];
    // Pieza 3 de Len 2.5: ask_user_question con opciones. «askLive» espera la
    // respuesta DENTRO del turno (evento `question`); «askEnded» cerró el turno
    // con la pregunta, que se contesta con un toque y abre el siguiente.
    case "askLive":
      return [
        ...head,
        wait(800, "text", { text: "Para el formulario de encargos necesito dos datos.\n\n" }),
        wait(200, "action", { tool: "ask_user_question", status: "running", summary: "" }),
        wait(300, "question", { questions: PREGUNTAS_DE_EJEMPLO }),
        // Lo que tarda el dueño en contestar (la espera de verdad son 120 s).
        // Sin respuesta a tiempo, la tarjeta de cierre trae las opciones (como
        // `toolAskUserQuestion` cuando `askUser` devuelve null).
        wait(60_000, "action", {
          tool: "ask_user_question",
          status: "done",
          summary: "",
          pregunta: "¿Con cuánta anticipación aceptas encargos de pasteles?\n¿Qué días entregas?",
          preguntas: PREGUNTAS_DE_EJEMPLO,
        }),
        wait(100, "done", DONE({ centicredits: 12, durationMs: 61_000 })),
      ];
    case "askEnded":
      return [
        ...head,
        wait(800, "text", { text: "Para el formulario de encargos necesito dos datos.\n\n" }),
        wait(200, "action", { tool: "ask_user_question", status: "running", summary: "" }),
        wait(300, "action", {
          tool: "ask_user_question",
          status: "done",
          summary: "",
          pregunta: "¿Con cuánta anticipación aceptas encargos de pasteles?\n¿Qué días entregas?",
          preguntas: PREGUNTAS_DE_EJEMPLO,
        }),
        wait(100, "done", DONE({ centicredits: 12, durationMs: 4_000 })),
      ];
    case "terminal":
      return [
        ...head,
        wait(700, "action", { tool: "web_search", status: "running", summary: "horario panaderías Oaxaca centro" }),
        wait(1500, "action", { tool: "web_search", status: "done", summary: "horario panaderías Oaxaca centro" }),
        wait(200, "action", { tool: "web_fetch", status: "running", summary: "https://ejemplo-panaderia.mx/horario" }),
        wait(1200, "action", { tool: "web_fetch", status: "done", summary: "https://ejemplo-panaderia.mx/horario" }),
        wait(200, "action", { tool: "bash", status: "running", summary: "grep -rn 'Calle de la Luna' /" }),
        wait(900, "terminal", {
          command: "grep -rn 'Calle de la Luna' /",
          salida: "/index.html:21:<section id=\"visitanos\">…Calle de la Luna 12, Centro…</section>\n[Command finished with exit code 0]",
          exitCode: 0,
        }),
        wait(50, "action", { tool: "bash", status: "done", summary: "grep -rn 'Calle de la Luna' /" }),
        wait(200, "action", { tool: "bash", status: "running", summary: "echo nota >> /AGENTS.md" }),
        wait(700, "terminal", {
          command: "echo nota >> /AGENTS.md",
          salida: "AGENTS.md: not saved — the platform manual is read-only.\n[Command finished with exit code 1]",
          exitCode: 1,
        }),
        wait(50, "action", { tool: "bash", status: "error", summary: "echo nota >> /AGENTS.md", motivo: "AGENTS.md es de sólo lectura." }),
        wait(300, "text", { text: "Miré en internet: las panaderías del centro abren de 7:00 a 20:00, igual que la tuya. Tu dirección sale en `index.html`; no la toqué." }),
        wait(100, "done", DONE({ centicredits: 230, durationMs: 9_800 })),
      ];
    case "publish":
      return [
        ...head,
        wait(700, "action", { tool: "publicar", status: "running", summary: "" }),
        wait(800, "action", { tool: "publicar", status: "done", summary: "panaderia-luna" }),
        wait(100, "confirm", { action: "publicar", subdominio: "panaderia-luna", idiomas: ["es", "en"], republicar: false }),
        wait(200, "text", { text: "Antes de publicar te pregunto: es tu dirección pública. Puedes cambiarla antes de publicar." }),
        wait(100, "done", DONE({ centicredits: 35, durationMs: 3_100 })),
      ];
    case "reply":
      return [
        ...head,
        wait(700, "action", { tool: "ver_mensajes", status: "running", summary: "" }),
        wait(900, "action", { tool: "ver_mensajes", status: "done", summary: "1 sin leer" }),
        wait(200, "action", { tool: "preparar_respuesta", status: "running", summary: "" }),
        wait(700, "action", { tool: "preparar_respuesta", status: "done", summary: "Ana" }),
        wait(100, "confirm", {
          action: "responder",
          para: "formulario",
          id: "msg-1",
          con: "Ana",
          texto: "¡Hola, Ana! Sí, el pastel de chocolate para el sábado está apartado. Te esperamos a partir de las 9:00.",
          botones: ["enviar", "correo", "whatsapp", "copiar"],
          correo: "ana@ejemplo.com",
          whatsapp: "5219511234567",
        }),
        wait(200, "text", { text: "Ana preguntó por su pastel del sábado. Te dejé una respuesta lista: corrígela si quieres y mándala con un toque." }),
        wait(100, "done", DONE({ centicredits: 64, durationMs: 4_700 })),
      ];
    case "noCredits":
      return [
        ...head,
        wait(500, "error", {
          message: "Te quedaste sin créditos.",
          code: "no_credits",
          refillsAt: new Date(Date.now() + 9 * 86_400_000).toISOString(),
        }),
      ];
    case "error":
      return [
        ...head,
        wait(800, "text", { text: "Voy a cambiar el título de la portada.\n\n" }),
        wait(300, "action", { tool: "Edit", status: "running", summary: "index.html" }),
        wait(900, "action", {
          tool: "Edit",
          status: "error",
          summary: "index.html",
          motivo: "old_string no aparece en /index.html: léelo antes de editarlo.",
        }),
        wait(400, "error", { message: "upstream", code: "upstream" }),
        wait(50, "done", { turns: 2, toolCalls: 1 }),
      ];
    case "cut":
      return [
        ...head,
        wait(700, "action", { tool: "Edit", status: "running", summary: "index.html" }),
        wait(1000, "html", { html: demoPage({ photos: true, form: false }), page: null, versionPrevia: "v-antes" }),
        wait(100, "action", {
          tool: "Edit",
          status: "done",
          summary: "index.html",
          cambio: "cambio",
          edits: 1,
          ops: [{ tipo: "replace", donde: "documento", etiqueta: "la portada", indice: 1 }],
        }),
        wait(400, "text", { text: "Cambié la portada; me quedé sin presupuesto antes de seguir con el resto." }),
        wait(100, "done", DONE({ topeAlcanzado: "budget_limit", mutoDurable: true, centicredits: 3000, durationMs: 61_000 })),
      ];
    case "drop":
      // Sin `done` ni `error`: el chat sigue el turno desde su fila.
      return [
        ...head,
        wait(700, "text", { text: "Empiezo por leer tu página…\n\n" }),
        wait(300, "action", { tool: "Read", status: "running", summary: "index.html" }),
      ];
    case "slow":
      return [
        ...head,
        wait(9000, "text", { text: "Lo pensé bien: la portada ya está bien como está." }),
        wait(100, "done", DONE({ centicredits: 92, durationMs: 9_200 })),
      ];
    case "window":
      // C9: la charla no cabe y el `done` lo dice con los dos números.
      return [
        ...head,
        wait(900, "text", { text: "Te lo resumo con lo que veo de la charla: la portada ya tiene fotos y el formulario de encargos está arriba." }),
        wait(100, "done", DONE({ centicredits: 22, durationMs: 4_100, ventana: { visibles: 12, totales: 20 } })),
      ];
    case "otherPage":
      // C17: el turno empieza en el Inicio y escribe también en /contacto, así
      // que no puede ofrecer Deshacer desde aquí.
      return [
        ...head,
        wait(700, "action", { tool: "Edit", status: "running", summary: "index.html" }),
        wait(900, "html", { html: demoPage({ photos: true, form: false }), page: null, versionPrevia: "v-antes" }),
        wait(100, "action", { tool: "Edit", status: "done", summary: "index.html", cambio: "cambio", edits: 1, ops: [{ tipo: "replace", donde: "documento", etiqueta: "la portada", indice: 1 }] }),
        wait(300, "action", { tool: "Edit", status: "running", summary: "contacto/index.html" }),
        wait(900, "html", { html: demoPage({ photos: true, form: true }), page: "contacto", versionPrevia: "v-contacto" }),
        wait(100, "action", { tool: "Edit", status: "done", summary: "contacto/index.html", cambio: "cambio", edits: 1, ops: [{ tipo: "insert_after", donde: "documento", etiqueta: "el formulario", indice: 2 }] }),
        wait(300, "text", { text: "Cambié la portada y añadí el formulario en la página de contacto." }),
        wait(100, "done", DONE({ mutoDurable: true, centicredits: 96, durationMs: 12_300 })),
      ];
    case "tooLarge":
      // D13: la ruta contesta 413 ANTES del stream (lo hace el servidor falso).
      return [];
    case "agentOff":
      // C18: con OPENLEN_AGENT=0 la ruta contesta un stream con UN solo
      // `error` (sin `turno` ni `done`) y el chat repite el turno por ai-design.
      return [wait(300, "error", { message: "El Agente está desactivado temporalmente.", code: "agent_off" })];
    case "versions":
      // L4: las versiones y `/.openlen` son de sólo lectura y se ven como pasos.
      return [
        ...head,
        wait(600, "action", { tool: "Read", status: "running", summary: "/.openlen/versiones/indice.jsonl" }),
        wait(700, "action", { tool: "Read", status: "done", summary: "/.openlen/versiones/indice.jsonl" }),
        wait(200, "action", { tool: "bash", status: "running", summary: "diff /.openlen/versiones/v-41/index.html /index.html" }),
        wait(800, "terminal", {
          command: "diff /.openlen/versiones/v-41/index.html /index.html",
          salida: "14c14\n< <h1>Pan de pueblo</h1>\n---\n> <h1>Pan hecho a mano, cada mañana</h1>\n[Command finished with exit code 1]",
          exitCode: 1,
        }),
        wait(50, "action", { tool: "bash", status: "done", summary: "diff /.openlen/versiones/v-41/index.html /index.html" }),
        wait(300, "text", { text: "Hace dos versiones el título decía «Pan de pueblo»; lo cambiaste el martes. No toqué nada." }),
        wait(100, "done", DONE({ centicredits: 38, durationMs: 5_600 })),
      ];
  }
}
