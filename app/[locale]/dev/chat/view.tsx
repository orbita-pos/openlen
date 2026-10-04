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
import { demoPage, pickScenario, SCENARIOS, SCENARIO_LABEL, scriptFor, type ScenarioId } from "./scripts";

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
const memory = { lines: ["Tono cercano, sin tecnicismos", "Fotos cálidas y reales, nada de stock frío"] };
let scenarioOverride: ScenarioId | null = null;
const live = new Map<string, { steer: (texto: string) => void; abort: () => void }>();
const onServer = new Map<string, { polls: number; turn: StoredChatTurn }>();
const listeners = new Set<() => void>();

function project(id: string): FakeProject {
  db[id] ??= { html: START_HTML, chat: [], archived: [], feedback: {}, brief: "Panadería Luna, en el centro de Oaxaca." };
  return db[id];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function agentStream(body: { projectId: string; prompt: string; turnId: string }, signal?: AbortSignal | null): Response {
  const scenario = scenarioOverride ?? pickScenario(body.prompt);
  const turnoId = `turno-${body.turnId.slice(0, 8)}`;
  const steps = scriptFor(scenario, turnoId);
  const enc = new TextEncoder();
  const p = project(body.projectId);
  const actions: NonNullable<StoredChatTurn["actions"]> = [];
  let text = "";
  const corrections: string[] = [];
  let stopped = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      live.set(turnoId, {
        steer: (texto) => {
          corrections.push(texto);
          send("direccion", { texto });
        },
        abort: () => {
          stopped = true;
        },
      });
      signal?.addEventListener("abort", () => {
        stopped = true;
      });
      let closed = false;
      for (const s of steps) {
        await new Promise((r) => setTimeout(r, s.ms));
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
        if (s.event === "text") text += (s.data as { text: string }).text;
        if (s.event === "html") p.html = (s.data as { html: string }).html;
        if (s.event === "action") {
          const a = s.data as NonNullable<StoredChatTurn["actions"]>[number];
          if (a.status !== "running") actions.push(a);
        }
        if (s.event === "done") {
          const d = s.data as { centicredits?: number; durationMs?: number };
          p.chat.push({
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
      return agentStream(body() as { projectId: string; prompt: string; turnId: string }, init?.signal);
    }
    if (path === "/api/agent/esfuerzo") {
      return method === "GET"
        ? json({ esfuerzo: "auto", niveles: ["low", "medium", "high", "xhigh", "max"], resuelveA: "medium", dynamis: true })
        : json({ ok: true });
    }
    if (path === "/api/agent/memoria") {
      if (method === "DELETE") {
        const { preferencia } = body() as { preferencia: string };
        memory.lines = memory.lines.filter((l) => l !== preferencia);
      }
      return json({ lineas: memory.lines });
    }
    if (path === "/api/agent/dirigir") {
      const { turnoId, texto } = body() as { turnoId: string; texto: string };
      const s = live.get(turnoId);
      if (!s) return json({ error: "not_found" }, 404);
      s.steer(texto);
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
        o.turn.assistantReasoning += "Ya está: tu página no tenía nada roto.";
        o.turn.actions = [{ tool: "Read", status: "done", summary: "index.html" }];
        o.turn.noDocChange = true;
        o.turn.centicredits = 52;
        o.turn.durationMs = 14_000;
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
                      flatProjectId={PROJECT.new}
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
                    />
                  ) : (
                    <ChatPanel
                      flatProjectId={PROJECT.old}
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
                    />
                  )}
                </div>
              </div>
              <div className="min-w-0 flex-1 bg-[color:var(--bg-preview)] p-3">
                <iframe title={`page-${side}`} srcDoc={html[side]} sandbox="" className="h-full w-full rounded-xl border bd bg-white" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
