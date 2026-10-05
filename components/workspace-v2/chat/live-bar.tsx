"use client";

// LA BARRA VIVA (plans/new-chat/, del mock): la cara de Len, qué está haciendo y
// desde cuándo, encima del compositor. «Buscando fotos · trabajando · 12 s»,
// «Esperando tu respuesta · Te toca», «Listo · pídele otra cosa». El ■ vive
// aquí y en el botón del compositor: los dos piden parar al servidor.
//
// Lo que dice sale de `liveStatus` (puro, con prueba).

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Square } from "lucide-react";

import { CaraDeLen } from "@/components/llamada/cara-de-len";
import { isRunning, retryPhase, type LiveStatus } from "./live-status";

export function LiveBar({ status, onStop }: { status: LiveStatus; onStop: () => void }) {
  const t = useTranslations("panelsChat");
  const locale = useLocale();
  // «1,7k caracteres» en español, «1.7k chars» en inglés: el número en el
  // idioma de quien lee (el chat de hoy lo escribía siempre con punto).
  const charsLabel = (n: number) =>
    n < 1000
      ? t("chars.count", { count: n })
      : t("chars.thousands", { count: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n / 1000) });
  // `isRunning`: también un reintento (el ■ no puede irse justo mientras espera).
  const running = isRunning(status);
  const startedAt = status.kind === "thinking" || status.kind === "working" ? status.startedAt : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  // LO QUE SE ANUNCIA va en su propia región, siempre montada (una región que
  // nace ya con texto no la lee ningún lector de pantalla) y sin el contador:
  // con la barra entera como región viva, «12 s», «13 s»… se leía cada segundo
  // mientras durara el turno, y el ■ quedaba dentro de un estado. Sólo lo que
  // cambia de verdad: qué hace, el turno es tuyo, terminó, falló.
  //
  // Entre paso y paso la barra dice «Escribiendo»; anunciado, eso volvía entre
  // cada herramienta («Buscando fotos», «Escribiendo», «Cambiando la página»,
  // «Escribiendo»…). Se queda dicho lo último que hizo de verdad.
  const [spoken, setSpoken] = useState("");
  if (status.kind === "idle") {
    if (spoken !== "") setSpoken("");
    return <span className="sr-only" role="status" aria-live="polite" />;
  }
  const seconds = startedAt !== null ? Math.max(0, Math.floor((now - startedAt) / 1000)) : null;

  let verb: string;
  let meta: string | null = null;
  let why: string | null = null;
  // El contador: se ve, pero no se anuncia.
  let ticking = false;
  switch (status.kind) {
    case "thinking":
      verb = t("newChat.live.thinking");
      meta = seconds !== null ? t("newChat.live.working", { seconds }) : null;
      ticking = meta !== null;
      break;
    case "working":
      // El camino de reserva (`ai-design`) gotea la página entera: se dice
      // cuánto lleva, como el chat de hoy (C3). Al lector de pantalla no: el
      // número cambia con cada trozo; para él sigue siendo «Escribiendo».
      verb =
        status.activity
          ? t(`newChat.activity.${status.activity}`)
          : status.streamedChars
            ? t("streaming.writingPage", { chars: charsLabel(status.streamedChars) })
            : t("newChat.live.writing");
      meta = status.onServer
        ? t("newChat.live.onServer")
        : seconds !== null
          ? t("newChat.live.working", { seconds })
          : null;
      ticking = !status.onServer && meta !== null;
      break;
    case "waiting":
      verb = status.reason === "question" ? t("newChat.live.waitingAnswer") : t("newChat.live.waitingApproval");
      // Pieza 3: dentro del turno no está «en pausa»: Len sigue al contestar.
      meta = status.reason === "question" && status.live ? t("newChat.live.yourTurnLive") : t("newChat.live.yourTurn");
      why = status.question || null;
      break;
    case "done":
      verb = t("newChat.live.done");
      meta = t("newChat.live.doneHint");
      break;
    case "stopped":
      verb = t("newChat.live.stopped");
      meta = t("newChat.live.stoppedHint");
      break;
    case "failed":
      verb = t("newChat.live.failed");
      why = status.message;
      break;
    case "retrying": {
      // Esperando: «Reintentando · en 3 s · intento 2 de 5» (como Claude Code).
      // Vencida la espera, el intento nuevo ya está pensando aunque no haya
      // llegado texto: «Pensando · intento 2 de 5».
      const phase = retryPhase(status, now);
      if (phase.waiting) {
        verb = t("newChat.live.retrying");
        meta = t("newChat.live.retryingHint", { seconds: phase.seconds, attempt: status.attempt, max: status.maxAttempts });
        ticking = true;
      } else {
        verb = t("newChat.live.thinking");
        meta = t("newChat.live.retryingAttempt", { attempt: status.attempt, max: status.maxAttempts });
      }
      break;
    }
    case "compacting":
      verb = t("newChat.live.compacting");
      meta = t("newChat.live.compactingHint");
      break;
  }

  const between = status.kind === "working" && !status.activity && spoken !== "";
  const spokenVerb = status.kind === "working" && !status.activity ? t("newChat.live.writing") : verb;
  const announced = between ? spoken : [spokenVerb, ticking ? null : meta, why].filter(Boolean).join(". ");
  if (announced !== spoken) setSpoken(announced);

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {announced}
      </span>
      <div className="nc-up flex min-h-[58px] items-center gap-3.5 py-2 pl-1.5 pr-2">
        <CaraDeLen estado={status.face} props="compact" className="h-[38px] w-[38px] shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col leading-[1.32]">
          {/* Lo que ya dice la región de arriba, oculto para no leerlo dos
              veces; el contador no está allí, así que se deja leer. */}
          <span aria-hidden className={`text-[13.5px] font-semibold ${running ? "nc-shimmer" : ""}`}>{verb}</span>
          {meta && (
            <span aria-hidden={!ticking} className="text-[11.5px] tabular-nums fg-muted">
              {meta}
            </span>
          )}
          {why && <span aria-hidden className="mt-0.5 line-clamp-2 text-[11.5px] italic fg-faint">{why}</span>}
        </div>
        {running && (
          <button
            type="button"
            onClick={onStop}
            aria-label={t("composer.stop")}
            title={t("composer.stop")}
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full border bd-strong bg-elev fg-muted hover:border-[color:var(--accent-ring)] hover:text-[var(--nc-accent-text)]"
          >
            <Square size={11} className="fill-current" />
          </button>
        )}
      </div>
    </>
  );
}
