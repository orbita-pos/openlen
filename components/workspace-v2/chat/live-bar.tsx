"use client";

// LA BARRA VIVA (plans/new-chat/, del mock): la cara de Len, qué está haciendo y
// desde cuándo, encima del compositor. «Buscando fotos · trabajando · 12 s»,
// «Esperando tu respuesta · Te toca», «Listo · pídele otra cosa». El ■ vive
// aquí y en el botón del compositor: los dos piden parar al servidor.
//
// Lo que dice sale de `liveStatus` (puro, con prueba).

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Square } from "lucide-react";

import { CaraDeLen } from "@/components/llamada/cara-de-len";
import type { LiveStatus } from "./live-status";

export function LiveBar({ status, onStop }: { status: LiveStatus; onStop: () => void }) {
  const t = useTranslations("panelsChat");
  const running = status.kind === "thinking" || status.kind === "working";
  const startedAt = running ? status.startedAt : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  if (status.kind === "idle") return null;
  const seconds = startedAt !== null ? Math.max(0, Math.floor((now - startedAt) / 1000)) : null;

  let verb: string;
  let meta: string | null = null;
  let why: string | null = null;
  switch (status.kind) {
    case "thinking":
      verb = t("newChat.live.thinking");
      meta = seconds !== null ? t("newChat.live.working", { seconds }) : null;
      break;
    case "working":
      verb = status.activity ? t(`newChat.activity.${status.activity}`) : t("newChat.live.writing");
      meta = status.onServer
        ? t("newChat.live.onServer")
        : seconds !== null
          ? t("newChat.live.working", { seconds })
          : null;
      break;
    case "waiting":
      verb = status.reason === "question" ? t("newChat.live.waitingAnswer") : t("newChat.live.waitingApproval");
      meta = t("newChat.live.yourTurn");
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
  }

  return (
    <div
      className="nc-up flex min-h-[58px] items-center gap-3.5 py-2 pl-1.5 pr-2"
      role="status"
      aria-live="polite"
    >
      <CaraDeLen estado={status.face} props="compact" className="h-[38px] w-[38px] shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col leading-[1.32]">
        <span className={`text-[13.5px] font-semibold ${running ? "nc-shimmer" : ""}`}>{verb}</span>
        {meta && <span className="text-[11.5px] tabular-nums fg-muted">{meta}</span>}
        {why && <span className="mt-0.5 line-clamp-2 text-[11.5px] italic fg-faint">{why}</span>}
      </div>
      {running && (
        <button
          type="button"
          onClick={onStop}
          aria-label={t("composer.stop")}
          title={t("composer.stop")}
          className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full border bd-strong bg-elev fg-muted hover:border-[color:var(--accent-ring)] hover:text-[var(--accent-strong)]"
        >
          <Square size={11} className="fill-current" />
        </button>
      )}
    </div>
  );
}
