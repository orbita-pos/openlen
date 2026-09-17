"use client";

// EL DETALLE DEL CHAT — dónde aparece, quién puede escribir, cómo saluda, las
// respuestas rápidas y el EQUIPO que atiende.
//
// 🔴 Todo esto vivía SÓLO en `workspace-v2/panels/modules-panel.tsx` (el
// bloque del chat y `AgentsList`), que la Tarea 8 demuele. No se alcanzaba por
// ningún otro sitio: si algo de aquí falta, el dueño pierde un control vivo.
// `nada-se-pierde.test.ts` lo vigila.
//
// Lo que se muda, campo a campo (los nombres son los de `ChatSettings`):
//   mount         segmento Botón/Sección/Ambos, CON su ayuda
//   selfServeJoin registro abierto
//   identityMode  «pedir cuenta»: encendido ⇒ "account", apagado ⇒ "guest"
//   welcome       guarda al perder el foco y con Enter
//   theme         claro/oscuro
//   quickReplies  hasta 6; botón ≤ 40, respuesta ≤ 500
//   el equipo     GET/POST `/agents`, DELETE `/agents/{id}` — no es un campo de
//                 settings, y por eso la lista de siete no lo veía
//
// `enabled` NO se pinta aquí: el interruptor del chat es el de la franja
// (`franja-de-estado.tsx`, Tarea 6), y el detalle no lo duplica.
//
// Cada cambio escribe `{ chat: parche }` por el embudo (PATCH .../settings) y,
// sólo tras un `ok`, avisa al taller con EXACTAMENTE ese parche.
//
// El resync de `welcome`/`quickReplies` al cambiar de proyecto que llevaba el
// hub viejo no hace falta: la franja se monta con `key` por proyecto, y el
// cajón monta este detalle de nuevo cada vez que se abre.

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";
import type { ChatSettings } from "@/lib/projects/types";
import { useToast } from "@/components/workspace-v2/toast";
import type { OnAjustesGuardados } from "./franja-de-estado";

/** Los topes del embudo (`settings-patch.ts`): 6 respuestas, 40/500 caracteres. */
const RESPUESTAS_MAX = 6;
const BOTON_MAX = 40;
const RESPUESTA_MAX = 500;
const BIENVENIDA_MAX = 200;

type Traductor = ReturnType<typeof useTranslations<"wsPage">>;

export function AjustesDelChat(props: {
  projectId: string;
  settings: ChatSettings | undefined;
  onAjustesGuardados: OnAjustesGuardados;
}) {
  const { projectId, settings, onAjustesGuardados } = props;
  const t = useTranslations("wsPage");
  const tc = useTranslations("common");
  const toast = useToast();
  const idBienvenida = useId();

  // Los segmentos y los interruptores leen la PROP, que el taller actualiza
  // tras cada guardado con éxito — igual que el hub viejo.
  const mount = settings?.mount ?? "both";
  const selfServeJoin = settings?.selfServeJoin !== false;
  const identityMode = settings?.identityMode ?? "guest";
  const theme = settings?.theme ?? "light";

  // Los textos se escriben en local y se guardan al soltarlos.
  const [welcome, setWelcome] = useState(settings?.welcome ?? "");
  const [respuestas, setRespuestas] = useState(() =>
    (settings?.quickReplies ?? []).map((r) => ({ _key: nuevaClave(), q: r.q, a: r.a })),
  );

  // LA COLA. El hub viejo DESCARTABA un guardado si otro seguía en vuelo
  // (`if (chatBusy) return`) y deshabilitaba los controles: escribir la
  // bienvenida y pulsar «Oscuro» perdía el tema, porque el blur deshabilitaba
  // el segmento antes de que llegara el clic. Aquí los guardados van en fila,
  // en el orden en que se pidieron, y ninguno se pierde.
  const cola = useRef<Promise<void>>(Promise.resolve());
  const [enVuelo, setEnVuelo] = useState(0);

  // LO QUE YA ESTÁ PEDIDO, campo a campo, mientras su petición sigue en la
  // cola. Sirve para no escribir lo que ya es así: en el hub viejo un blur sin
  // cambios costaba un PATCH y nada más; aquí cada guardado le dice al taller
  // «hay cambios sin publicar», y la franja pasaría a «cuando publiques» por
  // haber entrado y salido de un campo. Se compara contra lo pedido en vuelo
  // y, si no hay nada en vuelo, contra la PROP — nunca contra un recuerdo
  // viejo, que mentiría si Len cambia el ajuste por debajo.
  const pedido = useRef<Partial<ChatSettings>>({});

  function yaEsAsi(parche: Partial<ChatSettings>): boolean {
    const actual: Partial<ChatSettings> = {
      mount,
      selfServeJoin,
      identityMode,
      theme,
      welcome: settings?.welcome ?? "",
      quickReplies: settings?.quickReplies ?? [],
    };
    return (Object.keys(parche) as (keyof ChatSettings)[]).every(
      (k) =>
        JSON.stringify(k in pedido.current ? pedido.current[k] : actual[k]) ===
        JSON.stringify(parche[k]),
    );
  }

  function guardar(parche: Partial<ChatSettings>) {
    if (yaEsAsi(parche)) return;
    Object.assign(pedido.current, parche);
    setEnVuelo((n) => n + 1);
    cola.current = cola.current.then(async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/settings`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat: parche }),
        });
        if (!r.ok) {
          toast.error(t("toast.saveError"));
          return;
        }
        onAjustesGuardados({ chat: parche });
      } catch {
        toast.error(t("toast.saveError"));
      } finally {
        // Asentado, gane o pierda: la referencia vuelve a ser la prop — salvo
        // que otro guardado del mismo campo haya entrado detrás en la cola.
        for (const k of Object.keys(parche) as (keyof ChatSettings)[]) {
          if (pedido.current[k] === parche[k]) delete pedido.current[k];
        }
        setEnVuelo((n) => n - 1);
      }
    });
  }

  // Se envía lo que el embudo VA a guardar: recortado y sin filas a medias
  // (`settings-patch.ts` descarta las que no traen botón Y respuesta). Así el
  // parche con que se avisa al taller es la verdad del servidor, y una fila
  // recién añadida y aún vacía no cuenta como cambio sin publicar.
  const listaParaGuardar = (filas: typeof respuestas) =>
    filas
      .map(({ q, a }) => ({ q: q.trim(), a: a.trim() }))
      .filter((r) => r.q.length > 0 && r.a.length > 0);

  return (
    <div className="space-y-4" aria-busy={enVuelo > 0}>
      <div className="space-y-1.5">
        <Segmento
          valor={mount}
          opciones={[
            { id: "fab", etiqueta: t("chat.mount.fab") },
            { id: "section", etiqueta: t("chat.mount.section") },
            { id: "both", etiqueta: t("chat.mount.both") },
          ]}
          onElegir={(v) => guardar({ mount: v as "fab" | "section" | "both" })}
        />
        <p className="text-[11.5px] leading-relaxed fg-faint">{t(`chat.mount.${mount}Hint`)}</p>
      </div>

      <FilaInterruptor
        etiqueta={t("chat.selfServeJoin")}
        ayuda={t("chat.selfServeJoinHint")}
        activo={selfServeJoin}
        onCambiar={(v) => guardar({ selfServeJoin: v })}
      />
      <FilaInterruptor
        etiqueta={t("chat.requireAccount")}
        ayuda={t("chat.requireAccountHint")}
        activo={identityMode === "account"}
        onCambiar={(v) => guardar({ identityMode: v ? "account" : "guest" })}
      />

      <div className="space-y-1">
        <label htmlFor={idBienvenida} className="block text-[12px] font-medium fg-muted">
          {t("chat.welcome")}
        </label>
        <input
          id={idBienvenida}
          value={welcome}
          onChange={(e) => setWelcome(e.target.value)}
          // Recortada, como la guarda el embudo: si no, «Hola » y «Hola» serían
          // dos valores distintos y cada blur volvería a escribir.
          onBlur={(e) => guardar({ welcome: e.target.value.trim() })}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          maxLength={BIENVENIDA_MAX}
          placeholder={t("chat.welcomePlaceholder")}
          className="h-9 w-full rounded-lg bg-app px-3 text-[13px] fg ring-1 ring-[color:var(--border)] outline-none transition focus:ring-[color:var(--accent)]"
        />
      </div>

      <div className="space-y-1">
        <div className="text-[12px] font-medium fg-muted">{t("chat.theme")}</div>
        <Segmento
          valor={theme}
          opciones={[
            { id: "light", etiqueta: t("chat.themeLight") },
            { id: "dark", etiqueta: t("chat.themeDark") },
          ]}
          onElegir={(v) => guardar({ theme: v as "light" | "dark" })}
        />
      </div>

      <div className="space-y-1.5">
        <div className="text-[12px] font-medium fg-muted">{t("chat.quickReplies")}</div>
        {respuestas.map((fila, i) => (
          <div key={fila._key} className="flex items-center gap-1.5">
            <input
              value={fila.q}
              aria-label={t("chat.qrQ")}
              onChange={(e) =>
                setRespuestas(respuestas.map((r, j) => (j === i ? { ...r, q: e.target.value } : r)))
              }
              onBlur={() => guardar({ quickReplies: listaParaGuardar(respuestas) })}
              placeholder={t("chat.qrQ")}
              maxLength={BOTON_MAX}
              className="h-8 min-w-0 flex-1 rounded-lg bg-app px-2.5 text-[12px] fg ring-1 ring-[color:var(--border)] outline-none transition focus:ring-[color:var(--accent)]"
            />
            <input
              value={fila.a}
              aria-label={t("chat.qrA")}
              onChange={(e) =>
                setRespuestas(respuestas.map((r, j) => (j === i ? { ...r, a: e.target.value } : r)))
              }
              onBlur={() => guardar({ quickReplies: listaParaGuardar(respuestas) })}
              placeholder={t("chat.qrA")}
              maxLength={RESPUESTA_MAX}
              className="h-8 min-w-0 flex-1 rounded-lg bg-app px-2.5 text-[12px] fg ring-1 ring-[color:var(--border)] outline-none transition focus:ring-[color:var(--accent)]"
            />
            <button
              type="button"
              aria-label={tc("delete")}
              title={tc("delete")}
              onClick={() => {
                const siguiente = respuestas.filter((_, j) => j !== i);
                setRespuestas(siguiente);
                guardar({ quickReplies: listaParaGuardar(siguiente) });
              }}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg fg-faint transition hover:bg-hover hover:text-red-500"
            >
              <Trash2 size={12} aria-hidden />
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={respuestas.length >= RESPUESTAS_MAX}
          onClick={() => {
            if (respuestas.length >= RESPUESTAS_MAX) return;
            setRespuestas([...respuestas, { _key: nuevaClave(), q: "", a: "" }]);
          }}
          className="h-7 rounded-lg bg-app px-3 text-[12px] font-medium fg-muted ring-1 ring-[color:var(--border)] transition hover:bg-hover hover:fg disabled:opacity-40"
        >
          + {t("chat.qrAdd")}
        </button>
        <p className="text-[10.5px] leading-relaxed fg-faint">{t("chat.qrHint")}</p>
      </div>

      <ListaDelEquipo projectId={projectId} t={t} />

      <p className="text-[10.5px] leading-relaxed fg-faint">{t("modulesHub.seePreview")}</p>
    </div>
  );
}

function nuevaClave(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

// ─── El equipo ───────────────────────────────────────────────────────────────
//
// Portado de `AgentsList` (modules-panel.tsx). Dos cambios:
// - Si la lista no se pudo leer, lo DICE. El viejo la pintaba vacía, que es
//   mentir: «sin agentes todavía» cuando podía haberlos.
// - Quitar a un compañero ya no se esconde tras un `hover`: con
//   `hidden group-hover:inline-flex` no lo alcanzaban ni el teclado ni un
//   móvil, que no tiene hover.

interface Companero {
  id: string;
  invitedEmail: string;
  status: string;
  createdAt: string;
}

function ListaDelEquipo({ projectId, t }: { projectId: string; t: Traductor }) {
  const tc = useTranslations("common");
  const [equipo, setEquipo] = useState<Companero[] | null>(null);
  const [lecturaFallida, setLecturaFallida] = useState(false);
  const [email, setEmail] = useState("");
  const [invitando, setInvitando] = useState(false);
  const [quitando, setQuitando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = () => {
    setLecturaFallida(false);
    void fetch(`/api/projects/${projectId}/agents`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ agents: Companero[] }>;
      })
      .then((d) => setEquipo(d.agents))
      .catch(() => {
        setEquipo(null);
        setLecturaFallida(true);
      });
  };

  useEffect(() => {
    setEquipo(null);
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const invitar = async () => {
    const limpio = email.trim().toLowerCase();
    if (!limpio || invitando) return;
    setInvitando(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/agents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: limpio }),
      });
      if (r.status === 404) {
        const d = (await r.json()) as { error?: string };
        setError(t(d.error === "no_account" ? "chat.team.noAccount" : "chat.team.inviteError"));
      } else if (r.status === 400) {
        setError(t("chat.team.selfInvite"));
      } else if (!r.ok) {
        setError(t("chat.team.inviteError"));
      } else {
        setEmail("");
        cargar();
      }
    } catch {
      setError(t("chat.team.inviteError"));
    }
    setInvitando(false);
  };

  const quitar = async (id: string) => {
    setQuitando(id);
    try {
      const r = await fetch(`/api/projects/${projectId}/agents/${id}`, { method: "DELETE" });
      if (r.ok) cargar();
      else setError(t("chat.team.removeError"));
    } catch {
      setError(t("chat.team.removeError"));
    } finally {
      setQuitando(null);
    }
  };

  return (
    <div className="space-y-2 pt-2">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] fg-faint">
        {t("chat.team.title")}
      </div>

      <div className="flex items-center gap-1.5">
        <input
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void invitar();
          }}
          type="email"
          aria-label={t("chat.team.placeholder")}
          placeholder={t("chat.team.placeholder")}
          className="h-8 min-w-0 flex-1 rounded-lg bg-app px-2.5 text-[12px] fg ring-1 ring-[color:var(--border)] outline-none transition focus:ring-[color:var(--accent)]"
        />
        <button
          type="button"
          disabled={invitando || !email.trim()}
          onClick={() => void invitar()}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-[var(--accent-strong)] px-3 text-[12px] font-medium text-white transition hover:brightness-105 disabled:opacity-50"
        >
          {invitando && <Loader2 size={10} className="animate-spin" aria-hidden />}
          {t("chat.team.invite")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[11px] leading-snug text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {lecturaFallida && (
        <div className="flex items-center justify-between gap-2 text-[11px] leading-snug text-red-600 dark:text-red-400">
          <span>{tc("error")}</span>
          <button
            type="button"
            onClick={cargar}
            className="shrink-0 font-medium underline-offset-2 hover:underline"
          >
            {tc("retry")}
          </button>
        </div>
      )}
      {equipo === null && !lecturaFallida && (
        <div className="space-y-1">
          {[0, 1].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded-lg bg-zinc-200/60 dark:bg-zinc-800/50" />
          ))}
        </div>
      )}
      {equipo !== null && equipo.length === 0 && (
        <p className="text-[11px] leading-snug fg-faint">{t("chat.team.empty")}</p>
      )}
      {equipo !== null && equipo.length > 0 && (
        <ul className="space-y-0.5">
          {equipo.map((a) => (
            <li key={a.id} className="flex h-8 items-center gap-2 rounded-lg px-2 transition hover:bg-hover">
              <span className="min-w-0 flex-1 truncate text-[12px] fg">{a.invitedEmail}</span>
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  a.status === "active"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-hover fg-faint"
                }`}
              >
                {a.status === "active" ? t("chat.team.statusActive") : t("chat.team.statusInvited")}
              </span>
              <button
                type="button"
                disabled={quitando === a.id}
                aria-label={t("chat.team.remove")}
                title={t("chat.team.remove")}
                onClick={() => void quitar(a.id)}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md fg-faint transition hover:bg-hover hover:text-red-500 disabled:opacity-50"
              >
                {quitando === a.id ? (
                  <Loader2 size={10} className="animate-spin" aria-hidden />
                ) : (
                  <Trash2 size={10} aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────────
// Portadas de `Segment` y `ToggleRow` (modules-panel.tsx), que mueren con él.

function Segmento(props: {
  valor: string;
  opciones: { id: string; etiqueta: string }[];
  onElegir: (id: string) => void;
}) {
  return (
    <div className="flex rounded-lg bg-app p-0.5 ring-1 ring-[color:var(--border)]">
      {props.opciones.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={props.valor === o.id}
          onClick={() => props.onElegir(o.id)}
          className={`h-7 flex-1 rounded-md text-[11.5px] font-medium transition ${
            props.valor === o.id ? "seg-active" : "fg-faint hover:fg"
          }`}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  );
}

function FilaInterruptor(props: {
  etiqueta: string;
  ayuda: string;
  activo: boolean;
  onCambiar: (siguiente: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium leading-tight fg">{props.etiqueta}</div>
        <div className="mt-0.5 text-[10.5px] leading-snug fg-faint">{props.ayuda}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.activo}
        aria-label={props.etiqueta}
        onClick={() => props.onCambiar(!props.activo)}
        className={`relative mt-0.5 h-[18px] w-[32px] shrink-0 rounded-full transition ${
          props.activo ? "bg-[var(--accent)]" : "bg-zinc-300 dark:bg-zinc-700"
        }`}
      >
        <span
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all ${
            props.activo ? "left-[16px]" : "left-[2px]"
          }`}
        />
      </button>
    </div>
  );
}
