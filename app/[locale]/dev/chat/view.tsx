"use client";

// /dev/chat (ver page.tsx): el chat nuevo y el de hoy, lado a lado, contra un
// servidor DE MENTIRA que vive aquí (un `fetch` interceptado). Los componentes
// son los DE VERDAD; lo único falso son las respuestas de las rutas, con la
// forma exacta de las reales, y los turnos, que salen de `scripts.ts`. Cada chat
// tiene su propio proyecto para que no se mezclen sus almacenes. Sólo existe en
// desarrollo.

import "../../new/tokens.css";

import { useCallback, useEffect, useState } from "react";

import { ChatPanel } from "@/components/workspace-v2/panels/chat-panel";
import { NewChatPanel } from "@/components/workspace-v2/chat/new-chat-panel";
import type { ScopedSelection } from "@/components/workspace-v2/chat/use-agent-chat";
import type { StoredChatTurn } from "@/lib/projects/types";
import { comentariosDelChat } from "@/lib/workspace-v2/comentarios-de-lineas";
import { demoPage, dismissedReviewSteps, ENCARGO_DE_EJEMPLO, nextRoundOf, pickScenario, SCENARIOS, SCENARIO_LABEL, scriptFor, type ScenarioId } from "./scripts";
import { goalRoundPrompt } from "@/lib/agent/goal";

type Side = "new" | "old";
const PROJECT: Readonly<Record<Side, string>> = { new: "demo-chat-new", old: "demo-chat-old" };
const START_HTML = demoPage({ photos: false, form: false });

interface FakeProject {
  html: string;
  chat: StoredChatTurn[];
  archived: { id: string; title: string; turns: StoredChatTurn[]; endedAt: number }[];
  feedback: Record<string, { rating: "up" | "down"; reasons: string[]; note: string | null }>;
  brief: string;
}

const db: Record<string, FakeProject> = {};
let scenarioOverride: ScenarioId | null = null;
const live = new Map<string, { steer: (texto: string) => void; abort: () => void; dismiss: () => boolean }>();
const onServer = new Map<string, { polls: number; turn: StoredChatTurn; final?: Partial<StoredChatTurn> }>();
const listeners = new Set<() => void>();

function project(id: string): FakeProject {
  db[id] ??= { html: START_HTML, chat: [], archived: [], feedback: {}, brief: "Panadería Luna, en el centro de Oaxaca." };
  return db[id];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function agentStream(body: { projectId: string; prompt: string; turnId: string; goal?: string }, signal?: AbortSignal | null): Response {
  // Pieza 8: con la puerta del dueño al encargo (crear o reanudar), su guion.
  const scenario = body.goal === "create" || body.goal === "resume" ? "goalRounds" : (scenarioOverride ?? pickScenario(body.prompt));
  const turnoId = `turno-${body.turnId.slice(0, 8)}`;
  // Lote 7-8: una cola, para que descartar la revisión cambie lo que queda.
  const steps = [...scriptFor(scenario, turnoId)];
  const enc = new TextEncoder();
  const p = project(body.projectId);
  const actions: NonNullable<StoredChatTurn["actions"]> = [];
  let text = "";
  const corrections: string[] = [];
  let stopped = false;
  // ■ por `/api/agent/cancelar`: el servidor de verdad no corta, cierra el
  // turno con `error` cancelled + `done` (N40). Abortar el fetch sí corta.
  let cancelRequested = false;
  // Lote 7-8 · «Pedir cambios» descarta la revisión que espera: como el servidor
  // de verdad, el turno cierra con la tarjeta `done` (sin pregunta) y el `done`.
  let waiting: ReturnType<typeof setTimeout> | null = null;
  let wake: (() => void) | null = null;
  let dismissRequested = false;
  /** Hay una pregunta esperando (entre su `question` y su tarjeta). */
  let asking = false;
  /** El modo plan como lo dejan los eventos `plan` del guion (la foto de la fila). */
  let planActive = false;
  let wroteHtml = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      live.set(turnoId, {
        steer: (texto) => {
          corrections.push(texto);
          send("direccion", { texto });
        },
        abort: () => {
          cancelRequested = true;
        },
        dismiss: () => {
          if (!asking) return false;
          asking = false;
          dismissRequested = true;
          if (waiting) clearTimeout(waiting);
          wake?.();
          return true;
        },
      });
      signal?.addEventListener("abort", () => {
        stopped = true;
      });
      let closed = false;
      while (steps.length > 0) {
        const s = steps.shift()!;
        await new Promise<void>((r) => {
          wake = r;
          waiting = setTimeout(r, s.ms);
        });
        wake = null;
        if (dismissRequested) {
          dismissRequested = false;
          steps.splice(0, steps.length, ...dismissedReviewSteps());
          continue;
        }
        if (cancelRequested && !stopped) {
          send("error", { message: "El agente fue cancelado.", code: "cancelled" });
          send("done", { mutoDurable: wroteHtml, centicredits: 0 });
          controller.close();
          closed = true;
          break;
        }
        if (stopped) {
          try {
            controller.error(new DOMException("Aborted", "AbortError"));
          } catch {
            // ya cerrado
          }
          closed = true;
          break;
        }
        send(s.event, s.data);
        if (s.event === "question") asking = true;
        if (s.event === "plan") planActive = (s.data as { active: boolean }).active;
        if (s.event === "action" && (s.data as { status: string }).status !== "running") asking = false;
        if (s.event === "text") text += (s.data as { text: string }).text;
        if (s.event === "html") {
          p.html = (s.data as { html: string }).html;
          wroteHtml = true;
        }
        if (s.event === "action") {
          const a = s.data as NonNullable<StoredChatTurn["actions"]>[number];
          if (a.status !== "running") actions.push(a);
        }
        if (s.event === "done") {
          const d = s.data as {
            centicredits?: number;
            durationMs?: number;
            goal?: Omit<NonNullable<StoredChatTurn["goal"]>, "activation">;
            goalActivation?: "armed" | "disarmed";
          };
          p.chat.push({
            // Pieza 8: la foto del encargo en la fila, como la pone `getChatMessages`.
            ...(d.goal ? { goal: { ...d.goal, activation: d.goalActivation ?? "disarmed" } } : {}),
            // Lote 7-8: y la del modo plan, por lo mismo (si no, al cerrar el
            // turno la ficha «Plan» se apagaba aquí y no en producción).
            ...(planActive ? { planMode: true as const } : {}),
            id: body.turnId,
            userText: [body.prompt, ...corrections.map((c) => `↳ ${c}`)].join("\n"),
            assistantReasoning: text,
            status: "applied",
            appliedAt: Date.now(),
            ...(actions.length ? { actions: [...actions] } : {}),
            ...(typeof d.centicredits === "number" ? { centicredits: d.centicredits } : {}),
            ...(typeof d.durationMs === "number" ? { durationMs: d.durationMs } : {}),
          });
        }
      }
      live.delete(turnoId);
      if (!closed && scenario === "goalRounds") {
        // Pieza 8: «el servidor» abre la ronda 2; el chat la sigue sondeando
        // su fila y, a la tercera vuelta, la ronda cierra el encargo.
        const next = nextRoundOf(turnoId);
        const turn: StoredChatTurn = {
          id: next,
          userText: goalRoundPrompt(ENCARGO_DE_EJEMPLO, 2),
          assistantReasoning: "Sigo con el carrito y el pago…",
          status: "applied",
          appliedAt: Date.now(),
          enCurso: true,
          actions: [{ tool: "Read", status: "running", summary: "index.html" }],
        };
        onServer.set(next, {
          polls: 0,
          turn,
          final: {
            assistantReasoning:
              "Listo: la tienda tiene catálogo, carrito y pago con tarjeta. Lo comprobé: añadí dos pasteles al carrito, pagué con la tarjeta de prueba y el pedido llegó a tu Bandeja. Revisa los precios de los pasteles grandes.",
            actions: [
              { tool: "Edit", status: "done", summary: "index.html" },
              { tool: "update_goal", status: "done", summary: "" },
            ],
            goal: { ...ENCARGO_DE_EJEMPLO, revision: 2, phase: "complete", roundsStarted: 2, activation: "disarmed" },
            centicredits: 140,
            durationMs: 31_000,
          },
        });
        p.chat.push(turn);
      }
      if (!closed) {
        if (scenario === "drop") {
          // El turno sigue «en el servidor»: el chat lo relee de su fila.
          const turn: StoredChatTurn = {
            id: body.turnId,
            userText: body.prompt,
            assistantReasoning: text,
            status: "applied",
            appliedAt: Date.now(),
            enCurso: true,
            actions: [{ tool: "Read", status: "running", summary: "index.html" }],
          };
          onServer.set(body.turnId, { polls: 0, turn });
          p.chat.push(turn);
        }
        controller.close();
      }
      listeners.forEach((l) => l());
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

/** El camino de reserva, `/api/templates/ai-design` (C3, C18, C19): un poco de
 *  razonamiento y el documento ENTERO goteando en trozos (`html_chunk`), como la
 *  reescritura de verdad, y un `done` con el html final y su versión. */
function aiDesignStream(body: { projectId: string; prompt: string }, signal?: AbortSignal | null): Response {
  const enc = new TextEncoder();
  const p = project(body.projectId);
  const doc = demoPage({ photos: true, form: true });
  const reasoning = "Reescribo la página entera con fotos de verdad y el formulario de encargos.";
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
      try {
        for (const word of reasoning.split(" ")) {
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          send("reasoning_chunk", { text: `${word} ` });
          await pause(60);
        }
        for (let i = 0; i < doc.length; i += 120) {
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          send("html_chunk", { text: doc.slice(i, i + 120) });
          await pause(90);
        }
        p.html = doc;
        send("done", { html: doc, reasoning, versionPrevia: "v-ai-design" });
        controller.close();
      } catch (err) {
        controller.error(err);
      }
      listeners.forEach((l) => l());
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

/** C15: cómo falla el Deshacer cuando se pide (ninguno, o uno de los tres textos). */
type UndoFailure = "none" | "http" | "network" | "empty";
let undoFailure: UndoFailure = "none";

let installed = false;
function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = () => JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0] ?? "";

    if (path === "/api/agent" && method === "POST") {
      const b = body() as { projectId: string; prompt: string; turnId: string; goal?: string };
      // D13: la ruta rechaza la página ANTES de abrir el stream, con la forma
      // de `errorJson` (app/api/agent/route.ts).
      if ((scenarioOverride ?? pickScenario(b.prompt)) === "tooLarge") {
        return json({ error: "Page too large for an agent turn", code: "pageTooLarge" }, 413);
      }
      return agentStream(b, init?.signal);
    }
    if (path === "/api/templates/ai-design" && method === "POST") {
      return aiDesignStream(body() as { projectId: string; prompt: string }, init?.signal);
    }
    if (path === "/api/agent/esfuerzo") {
      return method === "GET"
        ? json({ esfuerzo: "auto", niveles: ["low", "medium", "high", "xhigh", "max"], resuelveA: "medium", dynamis: true })
        : json({ ok: true });
    }
    if (path === "/api/agent/responder" && method === "POST") {
      // Lote 7-8: sólo el descarte; contestar sigue yendo al servidor de verdad
      // (sin sesión: 401, y la respuesta sale como mensaje en cola).
      const b = body() as { turnoId?: string; dismiss?: boolean };
      if (b.dismiss === true) {
        const s = live.get(b.turnoId ?? "");
        return s?.dismiss() ? json({ ok: true }) : json({ error: "sin_pregunta" }, 409);
      }
    }
    if (path === "/api/agent/dirigir") {
      const { turnoId, texto } = body() as { turnoId: string; texto: string };
      const s = live.get(turnoId);
      if (!s) return json({ error: "not_found" }, 404);
      s.steer(texto);
      return json({ ok: true });
    }
    if (path === "/api/agent/encargo" && method === "POST") {
      // Pieza 8: quitar el encargo.
      return json({ ok: true });
    }
    if (path === "/api/agent/cancelar") {
      const { turnoId } = body() as { turnoId: string };
      live.get(turnoId)?.abort();
      return json({ ok: true });
    }
    const fila = path.match(/^\/api\/agent\/turno\/(.+)$/);
    if (fila) {
      const id = decodeURIComponent(fila[1]!);
      const o = onServer.get(id);
      if (!o) return json({ error: "not_found" }, 404);
      o.polls += 1;
      if (o.polls >= 3) {
        o.turn.enCurso = false;
        if (o.final) {
          // Pieza 8: la ronda del encargo cierra con lo suyo.
          Object.assign(o.turn, o.final);
        } else {
          o.turn.assistantReasoning += "Ya está: tu página no tenía nada roto.";
          o.turn.actions = [{ tool: "Read", status: "done", summary: "index.html" }];
          o.turn.noDocChange = true;
          o.turn.centicredits = 52;
          o.turn.durationMs = 14_000;
        }
        onServer.delete(id);
      }
      return json({ turno: o.turn, turnoId: `turno-${id.slice(0, 8)}` });
    }
    const m = path.match(/^\/api\/projects\/(demo-chat-(?:new|old))(\/.*)?$/);
    if (m) {
      const p = project(m[1]!);
      const rest = m[2] ?? "";
      if (rest === "/brief") return json({ brief: p.brief });
      if (rest === "" && method === "PATCH") {
        const b = body() as { userBrief?: string };
        if (typeof b.userBrief === "string") p.brief = b.userBrief;
        return json({ ok: true });
      }
      if (rest === "/chat" && method === "POST") {
        const turn = body() as unknown as StoredChatTurn;
        const i = p.chat.findIndex((x) => x.id === turn.id);
        if (i >= 0) p.chat[i] = { ...p.chat[i]!, ...turn };
        else p.chat.push({ ...turn, appliedAt: Date.now() });
        return json({ ok: true });
      }
      if (rest === "/chat" && method === "PATCH") {
        const { turnId, status } = body() as { turnId: string; status: "applied" | "reverted" };
        const t = p.chat.find((x) => x.id === turnId);
        if (t) t.status = status;
        return json({ ok: true });
      }
      if (rest === "/chat/feedback") {
        if (method === "GET") return json({ feedback: p.feedback });
        const b = body() as { turnId: string; rating?: "up" | "down"; reasons?: string[]; note?: string };
        if (method === "DELETE") delete p.feedback[b.turnId];
        else p.feedback[b.turnId] = { rating: b.rating ?? "up", reasons: b.reasons ?? [], note: b.note ?? null };
        return json({ ok: true });
      }
      if (rest === "/chat/conversations") {
        if (method === "GET") {
          return json({
            conversations: p.archived.map((a) => ({
              id: a.id,
              title: a.title,
              turns: a.turns.length,
              startedAt: a.turns[0]?.appliedAt ?? a.endedAt,
              endedAt: a.endedAt,
            })),
          });
        }
        if (live.size > 0) return json({ error: "busy" }, 409);
        const b = body() as { action: "new" | "reopen"; conversation?: string };
        const current = p.chat;
        if (b.action === "reopen") {
          const target = p.archived.find((a) => a.id === b.conversation);
          if (!target) return json({ error: "not_found" }, 404);
          p.archived = p.archived.filter((a) => a !== target);
          p.chat = target.turns;
        } else {
          p.chat = [];
        }
        if (current.length > 0) {
          p.archived.unshift({ id: `c-${Date.now()}`, title: current[0]!.userText.split("\n")[0]!, turns: current, endedAt: Date.now() });
        }
        // Sin avisar a la vista desde aquí: el servidor de verdad no empuja
        // nada. El chat vacía la charla y DESPUÉS pide recargar
        // (`conversationChanged`); avisando antes, la recarga llegaba primero,
        // la firma ya no cambiaba y la charla reabierta no aparecía.
        return json({ ok: true, archived: current.length > 0 ? "c" : null });
      }
      const restore = rest.match(/^\/versions\/[^/]+\/restore$/);
      if (restore && method === "POST") {
        if (undoFailure === "http") return json({ error: "restore failed" }, 500);
        if (undoFailure === "network") throw new TypeError("Failed to fetch");
        if (undoFailure === "empty") return json({ ok: true });
        p.html = START_HTML;
        return json({ html: START_HTML, page: null });
      }
      if (rest === "/terminal") return json({ encendida: true, turnos: [] });
      if (rest === "/publish" && method === "POST") {
        return json({ url: "https://panaderia-luna.openlen.app", localesFallidos: [] });
      }
    }
    if (path === "/api/subdomains/check") return json({ available: true });
    if (/^\/api\/inbox\/[^/]+\/reply$/.test(path)) return json({ ok: true });
    return original(input, init);
  };
}

install();

export function ChatSandbox({ dark, only }: { dark: boolean; only: Side | null }) {
  const [, setTick] = useState(0);
  const [scenario, setScenario] = useState<ScenarioId | null>(null);
  const [selecting, setSelecting] = useState<Record<Side, boolean>>({ new: false, old: false });
  const [scope, setScope] = useState<Record<Side, ScopedSelection | null>>({ new: null, old: null });
  const [draft, setDraft] = useState<Record<Side, { text: string; auto: boolean } | null>>({ new: null, old: null });
  const [chat, setChat] = useState<Record<Side, StoredChatTurn[]>>({ new: [], old: [] });
  const [html, setHtml] = useState<Record<Side, string>>({ new: START_HTML, old: START_HTML });
  // Lo que el sandbox finge del resto del taller (C15, A3, I2, C19).
  const [undoMode, setUndoMode] = useState<UndoFailure>("none");
  const [noProject, setNoProject] = useState(false);
  const [veil, setVeil] = useState<Record<Side, boolean>>({ new: false, old: false });
  const [noScanFx, setNoScanFx] = useState(false);
  const [classic, setClassic] = useState(false);
  useEffect(() => {
    try {
      setNoScanFx(localStorage.getItem("ol:scanfx") === "0");
      setClassic(localStorage.getItem("ol:agent") === "0");
    } catch {
      // sin almacenamiento: se queda en lo de siempre
    }
  }, []);
  const toggleStorage = (key: string, on: boolean) => {
    try {
      if (on) localStorage.setItem(key, "0");
      else localStorage.removeItem(key);
    } catch {
      // sin almacenamiento
    }
  };

  const refresh = useCallback(() => {
    setChat({ new: [...project(PROJECT.new).chat], old: [...project(PROJECT.old).chat] });
    setTick((n) => n + 1);
  }, []);
  useEffect(() => {
    listeners.add(refresh);
    return () => {
      listeners.delete(refresh);
    };
  }, [refresh]);
  useEffect(() => {
    scenarioOverride = scenario;
  }, [scenario]);
  // El oscuro va en <html>, como en el taller: así lo ven también los diálogos
  // que se pintan fuera (portales).
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const sides: Side[] = only ? [only] : ["new", "old"];

  return (
    <div>
      <div className="workspace-v2 flex h-screen flex-col">
        <div className="flex flex-wrap items-center gap-1.5 border-b bd bg-side px-3 py-2 text-[12px]">
          <b className="mr-1">/dev/chat</b>
          <span className="fg-muted">Próximo turno:</span>
          <button
            type="button"
            onClick={() => setScenario(null)}
            className={`rounded-full border px-2 py-0.5 ${scenario === null ? "border-[color:var(--accent)] bg-accent-soft" : "bd"}`}
          >
            según el mensaje
          </button>
          {SCENARIOS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScenario(s)}
              className={`rounded-full border px-2 py-0.5 ${scenario === s ? "border-[color:var(--accent)] bg-accent-soft" : "bd"}`}
            >
              {SCENARIO_LABEL[s]}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-[color:var(--border)]" />
          <button
            type="button"
            className="rounded-full border bd px-2 py-0.5"
            onClick={() => {
              setScope({ new: { hint: "section#portada", path: "body > section:nth-of-type(1)" }, old: { hint: "section#portada", path: "body > section:nth-of-type(1)" } });
              setSelecting({ new: false, old: false });
            }}
          >
            Acotar a la portada
          </button>
          <button
            type="button"
            className="rounded-full border bd px-2 py-0.5"
            onClick={() => setDraft({ new: { text: "Pon fotos de verdad en la portada", auto: false }, old: { text: "Pon fotos de verdad en la portada", auto: false } })}
          >
            Borrador desde fuera
          </button>
          <button
            type="button"
            className="rounded-full border bd px-2 py-0.5"
            onClick={() => setDraft({ new: { text: "Arregla el texto que no se lee en la portada", auto: true }, old: { text: "Arregla el texto que no se lee en la portada", auto: true } })}
          >
            «Arréglalo» (se manda solo)
          </button>
          {/* Lo que empujan las lentes Código y Cambios al comentar una línea
              (E7): la misma cola, así que el chat lo ve igual que en el taller. */}
          <button
            type="button"
            className="rounded-full border bd px-2 py-0.5"
            onClick={() => {
              for (const side of ["new", "old"] as const) {
                comentariosDelChat.anadir(PROJECT[side], {
                  ruta: "/index.html",
                  linea: 14,
                  codigo: "<h1>Pan hecho a mano, cada mañana</h1>",
                  texto: "Que el título quepa en dos líneas en el móvil",
                });
                comentariosDelChat.anadir(PROJECT[side], {
                  ruta: "/index.html",
                  linea: 22,
                  deAntes: true,
                  codigo: '<p class="horario">Lunes a sábado 7:00–20:00</p>',
                  texto: "Esto lo quitaste: vuelve a ponerlo en el pie",
                });
              }
            }}
          >
            Comentar dos líneas
          </button>
          <span className="mx-1 h-4 w-px bg-[color:var(--border)]" />
          <button
            type="button"
            className={`rounded-full border px-2 py-0.5 ${undoMode !== "none" ? "border-[color:var(--accent)] bg-accent-soft" : "bd"}`}
            onClick={() => {
              const order: UndoFailure[] = ["none", "http", "network", "empty"];
              const next = order[(order.indexOf(undoMode) + 1) % order.length]!;
              undoFailure = next;
              setUndoMode(next);
            }}
          >
            Deshacer falla: {{ none: "no", http: "HTTP 500", network: "sin red", empty: "sin página" }[undoMode]}
          </button>
          <button
            type="button"
            className={`rounded-full border px-2 py-0.5 ${noProject ? "border-[color:var(--accent)] bg-accent-soft" : "bd"}`}
            onClick={() => setNoProject((x) => !x)}
          >
            Sin proyecto
          </button>
          {/* I2: con el rayo X apagado (`ol:scanfx`, o movimiento reducido) el
              chat pide el velo del lienzo; aquí se pinta encima del iframe. */}
          <button
            type="button"
            className={`rounded-full border px-2 py-0.5 ${noScanFx ? "border-[color:var(--accent)] bg-accent-soft" : "bd"}`}
            onClick={() => {
              toggleStorage("ol:scanfx", !noScanFx);
              setNoScanFx((x) => !x);
            }}
          >
            Sin rayo X (velo)
          </button>
          {/* C19: el opt-out por navegador; el chat lo lee al montarse. */}
          <button
            type="button"
            className={`rounded-full border px-2 py-0.5 ${classic ? "border-[color:var(--accent)] bg-accent-soft" : "bd"}`}
            onClick={() => {
              toggleStorage("ol:agent", !classic);
              window.location.reload();
            }}
          >
            Chat clásico (ol:agent=0)
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          {sides.map((side) => (
            <div key={side} className="flex min-h-0 flex-1 border-r bd">
              <div className={`${side === "new" ? "w-[400px]" : "w-[272px]"} flex shrink-0 flex-col border-r bd bg-side`}>
                <div className="border-b bd px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] fg-faint">
                  {side === "new" ? "Chat nuevo" : "Chat de hoy"}
                </div>
                <div className="min-h-0 flex-1">
                  {side === "new" ? (
                    <NewChatPanel
                      flatProjectId={noProject ? undefined : PROJECT.new}
                      flatProjectHtml={html.new}
                      onFlatHtmlUpdate={(h) => setHtml((x) => ({ ...x, new: h }))}
                      flatProjectChat={chat.new}
                      onChatChange={refresh}
                      sectionSelectMode={selecting.new}
                      onToggleSectionSelect={(a) => setSelecting((x) => ({ ...x, new: a }))}
                      scopedSelection={scope.new}
                      onClearScope={() => setScope((x) => ({ ...x, new: null }))}
                      pendingDraft={draft.new?.text ?? null}
                      pendingDraftAutoSend={draft.new?.auto ?? false}
                      onPendingDraftConsumed={() => setDraft((x) => ({ ...x, new: null }))}
                      onRedesigningChange={(a) => setVeil((x) => ({ ...x, new: a }))}
                    />
                  ) : (
                    <ChatPanel
                      flatProjectId={noProject ? undefined : PROJECT.old}
                      flatProjectHtml={html.old}
                      onFlatHtmlUpdate={(h) => setHtml((x) => ({ ...x, old: h }))}
                      flatProjectChat={chat.old}
                      onChatChange={refresh}
                      sectionSelectMode={selecting.old}
                      onToggleSectionSelect={(a) => setSelecting((x) => ({ ...x, old: a }))}
                      scopedSelection={scope.old}
                      onClearScope={() => setScope((x) => ({ ...x, old: null }))}
                      pendingDraft={draft.old?.text ?? null}
                      pendingDraftAutoSend={draft.old?.auto ?? false}
                      onPendingDraftConsumed={() => setDraft((x) => ({ ...x, old: null }))}
                      onRedesigningChange={(a) => setVeil((x) => ({ ...x, old: a }))}
                    />
                  )}
                </div>
              </div>
              <div className="relative min-w-0 flex-1 bg-[color:var(--bg-preview)] p-3">
                <iframe title={`page-${side}`} srcDoc={html[side]} sandbox="" className="h-full w-full rounded-xl border bd bg-white" />
                {veil[side] && (
                  <div data-veil className="absolute inset-3 grid place-items-center rounded-xl bg-[color:var(--bg-preview)] text-[13px] fg-muted">
                    Velo de construcción (el lienzo del taller pone aquí su cargador)
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
