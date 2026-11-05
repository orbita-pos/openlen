// THE «CREAR» CARDS ON THE PHONE (spec local 2026-11-04-herramientas-hechas-por-len, §4.10, §4.14): Len's proposals of a
// tool in this project's chat — DeepSeek's personalized-page card —, pressable from the phone. They sit over the
// conversation like the event cards (`chat/avisos.tsx`), never as chat messages, with their look; each phase has the
// web's buttons and the web's words (`movil.herramientas.toolCard`); a press goes to the same route as the web
// (`POST /api/tool-cards/[id]`), and is the only thing that creates or installs. Read on open, every 60 s, and every
// 5 s while one is being created or installed; switched off on the server, nothing shows.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { toolCardFrom } from "@/lib/tools/cards/parse";
import type { ToolCardPhase, ToolCardView } from "@/lib/tools/cards/types";

import "../chat/avisos.css";
import "./herramientas.css";

const MIRAR_CADA_MS = 60_000;
const MIRAR_TRABAJANDO_MS = 5_000;
const TRABAJANDO: readonly ToolCardPhase[] = ["creating", "installing"];
/** Phases where the person's installed tools changed: the app reads its list again. */
const CAMBIAN_HERRAMIENTAS: readonly ToolCardPhase[] = ["installed", "removed"];
const AVISO = "len-tool-cost-notice";
const DONDE_MAX = 1_000;

function avisoCerrado(): boolean {
  try {
    return localStorage.getItem(AVISO) === "hidden";
  } catch {
    return false;
  }
}

function recordarAviso(cerrado: boolean): void {
  try {
    if (cerrado) localStorage.setItem(AVISO, "hidden");
    else localStorage.removeItem(AVISO);
  } catch {
    // Without storage it shows again next time.
  }
}

type Resultado = { status: "ok" } | { status: "refused"; reason: string };
type Sitio = "rail" | "project" | "custom";

function Tarjeta({
  card,
  tope,
  onPulsar,
  onAbrirHerramienta,
  onAbrirProyecto,
}: {
  card: ToolCardView;
  tope: number;
  onPulsar: (verb: string, payload?: Record<string, unknown>) => Promise<Resultado>;
  onAbrirHerramienta: (installationId: string) => void;
  onAbrirProyecto: (projectId: string) => void;
}) {
  const t = useTranslations("movil.herramientas");
  const [sitio, setSitio] = useState<Sitio>(card.customLocation ? "custom" : card.placement);
  const [palabras, setPalabras] = useState(card.customLocation ?? "");
  const [aviso, setAviso] = useState(() => !avisoCerrado());
  const [abierto, setAbierto] = useState(false);
  const [pulsando, setPulsando] = useState<string | null>(null);
  const [negado, setNegado] = useState<string | null>(null);

  const pulsar = async (verb: string, payload?: Record<string, unknown>) => {
    setPulsando(verb);
    setNegado(null);
    const r = await onPulsar(verb, payload);
    setPulsando(null);
    if (r.status === "refused") setNegado(r.reason);
  };
  const lugar = (): Record<string, unknown> => (sitio === "custom" ? { customLocation: palabras.trim() } : { placement: sitio });
  const palabrasBien = palabras.trim().length >= 1 && palabras.trim().length <= DONDE_MAX;
  const ocupado = pulsando !== null;

  if (card.phase === "dismissed") return <p className="ch-aviso-estado">{t("toolCard.dismissed", { title: card.title })}</p>;

  return (
    <article className={`ch-aviso herr-tarjeta${card.phase === "replaced" ? " is-decidida" : ""}`} data-tool-card={card.phase}>
      <span className="ch-aviso-titulo">{card.title}</span>
      <p className={`ch-aviso-resumen${abierto ? "" : " herr-plegado"}`}>{card.brief}</p>
      {card.brief.length > 160 && (
        <button type="button" className="herr-enlace" onClick={() => setAbierto(!abierto)}>
          {abierto ? t("toolCard.less") : t("toolCard.more")}
        </button>
      )}
      {card.initialContent && (
        <details className="ch-aviso-accion">
          <summary className="ch-aviso-rotulo">{t("toolCard.initialContent")}</summary>
          <p className="ch-aviso-cuerpo">{card.initialContent}</p>
        </details>
      )}

      {card.phase === "proposed" && (
        <>
          <label className="herr-sitio">
            <span className="ch-aviso-rotulo">{t("toolCard.place")}</span>
            <select value={sitio} onChange={(e) => setSitio(e.target.value as Sitio)}>
              <option value="rail">{t("toolCard.inRail")}</option>
              <option value="project">{t("toolCard.inProject")}</option>
              <option value="custom">{t("toolCard.custom")}</option>
            </select>
          </label>
          {sitio === "custom" && (
            <textarea
              className="herr-donde"
              value={palabras}
              maxLength={DONDE_MAX}
              rows={2}
              placeholder={t("toolCard.customPlaceholder")}
              onChange={(e) => setPalabras(e.target.value)}
              onInput={(e) => setPalabras((e.target as HTMLTextAreaElement).value)}
            />
          )}
          {aviso && (
            <div className="herr-aviso">
              <span>{t("toolCard.notice", { cap: tope })}</span>
              <button
                type="button"
                aria-label={t("toolCard.closeNotice")}
                onClick={() => {
                  setAviso(false);
                  recordarAviso(true);
                }}
              >
                ×
              </button>
            </div>
          )}
          <div className="ch-aviso-botones">
            <button type="button" className="ch-aviso-hazlo" disabled={ocupado || (sitio === "custom" && !palabrasBien)} onClick={() => void pulsar("create", lugar())}>
              {t("toolCard.create")}
            </button>
            <button type="button" className="ch-aviso-ahora-no" disabled={ocupado} onClick={() => void pulsar("dismiss", sitio === "custom" ? undefined : { placement: sitio })}>
              {t("toolCard.notNow")}
            </button>
            {!aviso && (
              <button
                type="button"
                className="herr-info"
                aria-label={t("toolCard.showNotice")}
                onClick={() => {
                  setAviso(true);
                  recordarAviso(false);
                }}
              >
                i
              </button>
            )}
          </div>
        </>
      )}

      {card.phase === "creating" && (
        <div className="ch-aviso-botones">
          <span className="ch-aviso-estado" role="status">{t("toolCard.creating")}</span>
          <button type="button" className="ch-aviso-ahora-no" disabled={ocupado} onClick={() => void pulsar("cancel")}>
            {pulsando === "cancel" ? t("toolCard.cancelling") : t("toolCard.cancel")}
          </button>
        </div>
      )}
      {card.phase === "installing" && <span className="ch-aviso-estado" role="status">{t("toolCard.installing")}</span>}
      {card.phase === "installed" && (
        <div className="ch-aviso-botones">
          <span className="ch-aviso-linea is-ok">{t("toolCard.installed")}</span>
          <button type="button" className="ch-aviso-hazlo" disabled={ocupado || !card.installationId} onClick={() => card.installationId && onAbrirHerramienta(card.installationId)}>
            {t("toolCard.open")}
          </button>
          <button type="button" className="ch-aviso-ahora-no" disabled={ocupado} onClick={() => void pulsar("undo")}>
            {t("toolCard.undo")}
          </button>
        </div>
      )}
      {card.phase === "removed" && (
        <div className="ch-aviso-botones">
          <span className="ch-aviso-estado">{t("toolCard.removed")}</span>
          <button type="button" className="ch-aviso-ahora-no" disabled={ocupado} onClick={() => void pulsar("restore")}>
            {t("toolCard.restore")}
          </button>
        </div>
      )}
      {(card.phase === "failed" || card.phase === "cancelled" || card.phase === "interrupted") && (
        <>
          <span className="ch-aviso-fallo">{card.phase === "failed" ? t("toolCard.failed") : card.phase === "cancelled" ? t("toolCard.cancelled") : t("toolCard.interrupted")}</span>
          {card.error && <p className="ch-aviso-resumen">{card.error}</p>}
          <div className="ch-aviso-botones">
            <button type="button" className="ch-aviso-hazlo" disabled={ocupado} onClick={() => void pulsar("retry")}>
              {t("toolCard.retry")}
            </button>
          </div>
        </>
      )}
      {card.phase === "needs_review" && card.review && (
        <>
          <span className="ch-aviso-titulo">{t("toolCard.needsReview")}</span>
          <div className="ch-aviso-accion">
            <span>{card.review.kind === "security_findings" ? t("installCard.findings") : t("installCard.destructive")}</span>
            <ul>
              {card.review.findings.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
          <div className="ch-aviso-botones">
            <button type="button" className="ch-aviso-hazlo" disabled={ocupado} onClick={() => void pulsar("install_anyway")}>
              {t("toolCard.installAnyway")}
            </button>
            <button type="button" className="ch-aviso-ahora-no" disabled={ocupado || !card.toolProjectId} onClick={() => card.toolProjectId && onAbrirProyecto(card.toolProjectId)}>
              {t("toolCard.openProject")}
            </button>
          </div>
        </>
      )}
      {negado && (
        <p className="ch-aviso-fallo" role="alert">
          {negado === "plan_required" ? t("toolCard.planRequired") : negado === "source-missing" ? t("toolCard.sourceMissing") : t("toolCard.refused", { reason: negado })}
        </p>
      )}
    </article>
  );
}

export function TarjetasDeHerramientas({
  cliente,
  projectId,
  abierto,
  idioma,
  onAbrirHerramienta,
  onAbrirProyecto,
  onHerramientasCambiaron,
}: {
  cliente: ClienteDeOpenLen;
  projectId: string;
  abierto: boolean;
  idioma: string;
  onAbrirHerramienta: (installationId: string) => void;
  onAbrirProyecto: (projectId: string) => void;
  onHerramientasCambiaron: () => void;
}) {
  const [cards, setCards] = useState<ToolCardView[]>([]);
  const [tope, setTope] = useState(25);
  const fases = useRef<Map<string, ToolCardPhase>>(new Map());
  const cambiaron = useRef(onHerramientasCambiaron);
  cambiaron.current = onHerramientasCambiaron;
  const ruta = `/api/tool-cards?projectId=${encodeURIComponent(projectId)}`;

  const cargar = useCallback(async () => {
    const res = await cliente.pedir(ruta).catch(() => null);
    if (!res?.ok) {
      if (res && res.status === 404) setCards([]);
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { cards?: unknown; capCredits?: unknown };
    const leidas = Array.isArray(body.cards) ? body.cards.flatMap((c) => toolCardFrom(c) ?? []) : [];
    if (typeof body.capCredits === "number") setTope(body.capCredits);
    // A card that just became installed or removed: the person's tools changed (the app reads them again).
    const antes = fases.current;
    const cambio = leidas.some((c) => antes.has(c.id) && antes.get(c.id) !== c.phase && CAMBIAN_HERRAMIENTAS.includes(c.phase));
    fases.current = new Map(leidas.map((c) => [c.id, c.phase]));
    setCards(leidas);
    if (cambio) cambiaron.current();
  }, [cliente, ruta]);

  useEffect(() => {
    fases.current = new Map();
    setCards([]);
  }, [projectId]);

  const trabajando = cards.some((c) => TRABAJANDO.includes(c.phase));
  useEffect(() => {
    if (!abierto) return;
    void cargar();
  }, [abierto, cargar]);
  useEffect(() => {
    if (!abierto) return;
    const cada = setInterval(() => void cargar(), trabajando ? MIRAR_TRABAJANDO_MS : MIRAR_CADA_MS);
    return () => clearInterval(cada);
  }, [abierto, cargar, trabajando]);

  const zona = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  })();
  const pulsar = async (card: ToolCardView, verb: string, payload?: Record<string, unknown>): Promise<Resultado> => {
    const res = await cliente
      .pedir(`/api/tool-cards/${encodeURIComponent(card.id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verb, ...(payload ? { payload } : {}), locale: idioma, timeZone: zona }),
      })
      .catch(() => null);
    const body = ((await res?.json().catch(() => ({}))) ?? {}) as { status?: unknown; reason?: unknown };
    void cargar();
    if (body.status === "refused" || !res?.ok) return { status: "refused", reason: typeof body.reason === "string" ? body.reason : String(res?.status ?? "network") };
    return { status: "ok" };
  };

  if (cards.length === 0) return null;
  return (
    <div className="ch-avisos" data-tool-cards="">
      {cards.map((c) => (
        <Tarjeta key={c.id} card={c} tope={tope} onPulsar={(verb, payload) => pulsar(c, verb, payload)} onAbrirHerramienta={onAbrirHerramienta} onAbrirProyecto={onAbrirProyecto} />
      ))}
    </div>
  );
}
