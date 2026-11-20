// Mobile touch decision card for Edge A/B Testing (Plan 3) inside Tu Asistente → «Pedidos».
// Shares all translated copy with the web via `movil.asistente` (`own.ab.*`).
import { useState } from "react";
import { useTranslations } from "use-intl";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { AbExperimentView } from "@/lib/ab/types";
import { decidirPruebaAb } from "../api/asistente";

function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function MobileAbDecisionCard({
  cliente,
  experiment,
  assistantName,
  idioma,
  resaltado,
  onActualizado,
}: {
  cliente: ClienteDeOpenLen;
  experiment: AbExperimentView;
  assistantName: string;
  idioma: string;
  resaltado: boolean;
  onActualizado: () => void;
}) {
  const t = useTranslations("movil.asistente");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);
  const [actual, setActual] = useState<AbExperimentView>(experiment);

  const metrics = actual.metrics;
  const stats = metrics?.stats;
  const liftPct = Math.round((stats?.relativeLift ?? 0) * 100);
  const probPct = Math.round(
    (actual.winnerVariant === "b"
      ? (stats?.probBBeatsA ?? 0)
      : actual.winnerVariant === "a"
        ? (stats?.probABeatsB ?? 0)
        : Math.max(stats?.probBBeatsA ?? 0, stats?.probABeatsB ?? 0)) * 100,
  );

  const headline =
    actual.status === "paused_harm"
      ? t("own.ab.harmStopTitle")
      : actual.status === "winner_ready" && actual.winnerVariant === "b"
        ? t("own.ab.winnerBTitle", { lift: Math.max(0, liftPct) })
        : actual.status === "winner_ready" && actual.winnerVariant === "a"
          ? t("own.ab.winnerATitle")
          : t("own.ab.inconclusiveTitle");

  const decidir = async (action: "promote_b" | "keep_a" | "extend") => {
    setOcupado(action);
    setAviso(null);
    setListo(null);
    const r = await decidirPruebaAb(cliente, actual.projectId, actual.id, action, idioma);
    setOcupado(null);
    if (!r.ok) {
      setAviso(r.status === 409 ? t("own.ab.decidedByConflict") : t("own.ab.failed"));
      return;
    }
    if (r.experiment) setActual(r.experiment);
    setListo(
      action === "promote_b"
        ? t("own.ab.promotedDone")
        : action === "keep_a"
          ? t("own.ab.keptDone")
          : t("own.ab.extendedDone"),
    );
    onActualizado();
  };

  const pendiente =
    (actual.status === "winner_ready" || actual.status === "inconclusive") &&
    actual.decisionStatus === "pending";
  const bPrimary = actual.winnerVariant !== "a";

  return (
    <li
      className="asist-pedido asist-ab"
      data-ab-card={actual.id}
      data-resaltado={String(resaltado)}
      ref={resaltado ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
    >
      <small>
        {t("own.ab.from", { name: assistantName })}
        {actual.projectTitle ? ` · ${actual.projectTitle}` : ""}
        {probPct > 0 ? ` · ${t("own.ab.confidence", { prob: probPct })}` : ""}
      </small>
      <b>{headline}</b>
      <p className="asist-ab-nombre">{actual.name}</p>
      {metrics && (
        <div className="asist-ab-metricas">
          <div>
            <span>{t("own.ab.controlLabel")}</span>
            <strong>
              {formatPct(metrics.a.rate)} ({t("own.ab.conversions", { count: metrics.a.conversions })}/
              {t("own.ab.views", { count: metrics.a.views })})
            </strong>
          </div>
          <div>
            <span>{t("own.ab.variantLabel")}</span>
            <strong>
              {formatPct(metrics.b.rate)} ({t("own.ab.conversions", { count: metrics.b.conversions })}/
              {t("own.ab.views", { count: metrics.b.views })})
            </strong>
          </div>
        </div>
      )}
      {actual.bringState === "conflict" && (
        <p role="alert" className="asist-aviso">
          {t("own.ab.conflictNotice")}
        </p>
      )}
      {listo && <p className="asist-ab-ok">{listo}</p>}
      {aviso && (
        <p role="alert" className="asist-aviso">
          {aviso}
        </p>
      )}
      {pendiente && (
        <div className="asist-acciones asist-ab-acciones">
          <button
            type="button"
            className={bPrimary ? "lm-btn" : "lm-btn lm-sec"}
            data-ab-promote-b=""
            disabled={ocupado !== null}
            onClick={() => void decidir("promote_b")}
          >
            {ocupado === "promote_b" ? t("own.ab.applying") : t("own.ab.promoteB")}
          </button>
          <button
            type="button"
            className={!bPrimary ? "lm-btn" : "lm-btn lm-sec"}
            data-ab-keep-a=""
            disabled={ocupado !== null}
            onClick={() => void decidir("keep_a")}
          >
            {ocupado === "keep_a" ? t("own.ab.applying") : t("own.ab.keepA")}
          </button>
          <button
            type="button"
            className="lm-btn lm-sec"
            data-ab-extend=""
            disabled={ocupado !== null}
            onClick={() => void decidir("extend")}
          >
            {ocupado === "extend" ? t("own.ab.applying") : t("own.ab.extend")}
          </button>
        </div>
      )}
    </li>
  );
}
