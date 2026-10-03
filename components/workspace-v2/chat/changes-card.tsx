"use client";

// LO QUE CAMBIÓ EL TURNO, en palabras (plans/new-chat/): «Cambió la portada ·
// Ver», tres a la vista y «Ver los 6 cambios», y «Comparar antes y después».
// Nunca HTML: el cambio va en palabras (Jesús, revisión del mock). Debajo, para
// quien quiera el código, los ficheros del turno (la tarjeta de DeepSeek de
// siempre).
//
// La cuenta es `turnChanges` (la misma del chat de hoy). «Ver» resalta la
// sección en el lienzo y sólo sale cuando hay a dónde ir: una sección quitada ya
// no está, y un turno de otra página movería el lienzo a otro documento.

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, Minus, Pencil, Plus } from "lucide-react";

import { agruparCambios, MAX_SECCIONES } from "@/lib/workspace-v2/diff-de-turno";
import { resaltarController } from "@/lib/workspace-v2/resaltar-controller";
import { FicherosDelTurnoEnVivo } from "../ficheros-del-turno";
import { CompareDialog } from "./compare-dialog";
import { turnChanges } from "./turn-changes";
import type { DesignTurn } from "./use-agent-chat";

/** Cuántos cambios se ven antes de «Ver los N cambios». */
const SHOWN = 3;

export function ChangesCard({
  turn,
  projectId,
  samePage,
}: {
  turn: DesignTurn;
  projectId: string;
  /** El turno fue de la página que se está mirando. */
  samePage: boolean;
}) {
  const t = useTranslations("panelsChat");
  const [all, setAll] = useState(false);
  const [comparing, setComparing] = useState(false);
  const changes = useMemo(
    () => agruparCambios(turnChanges(turn, (place) => t(`diff.${place}`))).slice(0, MAX_SECCIONES * 2),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [turn.actions, turn.preEditHtml, turn.postEditHtml, t],
  );
  const canCompare = samePage && Boolean(turn.preEditHtml) && Boolean(turn.postEditHtml);
  if (changes.length === 0 && !canCompare) {
    return <FicherosDelTurnoEnVivo projectId={projectId} turnId={turn.id} />;
  }
  const shown = all ? changes : changes.slice(0, SHOWN);
  const hidden = changes.length - SHOWN;

  return (
    <div className={`nc-card-in rounded-[14px] border bd bg-elev px-3 py-2.5 ${turn.status === "reverted" ? "opacity-55" : ""}`}>
      {shown.map((c, i) => (
        <div
          key={`${c.tipo}-${c.indice}-${i}`}
          className={`nc-up flex items-center gap-2 py-1.5 ${i > 0 ? "border-t bd" : ""}`}
        >
          <span
            aria-hidden
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ${
              c.tipo === "anadida"
                ? "nc-ok bg-[color-mix(in_oklab,var(--nc-ok)_12%,transparent)]"
                : c.tipo === "quitada"
                  ? "nc-bad bg-[color-mix(in_oklab,var(--nc-bad)_10%,transparent)]"
                  : "bg-accent-soft text-[var(--accent-strong)]"
            }`}
          >
            {c.tipo === "anadida" ? <Plus size={13} /> : c.tipo === "quitada" ? <Minus size={13} /> : <Pencil size={12} />}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] fg">
            {c.etiqueta ? t(`diff.${c.tipo}`, { que: c.etiqueta }) : t(`diff.${c.tipo}SinNombre`)}
          </span>
          {c.veces > 1 && <span className="shrink-0 tabular-nums text-[11.5px] fg-faint">×{c.veces}</span>}
          {c.indice >= 0 && samePage && turn.status !== "reverted" && (
            <button
              type="button"
              onClick={() => resaltarController.resaltar(c.indice)}
              className="shrink-0 rounded-md px-1.5 py-1 text-[12.5px] font-semibold text-[var(--accent-strong)] hover:bg-accent-soft"
            >
              {t("diff.ver")}
            </button>
          )}
        </div>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setAll((x) => !x)}
          aria-expanded={all}
          className="mt-0.5 py-1 text-[11.5px] font-medium fg-muted hover:fg"
        >
          {all ? t("newChat.changes.showLess") : t("newChat.changes.showAll", { count: changes.length })}
        </button>
      )}
      {canCompare && turn.status !== "reverted" && (
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => setComparing(true)}
            className="inline-flex items-center gap-1.5 rounded-[9px] border bd-strong px-2.5 py-1 text-[12.5px] hover:border-[color:var(--accent-ring)]"
          >
            <ArrowLeftRight size={13} />
            {t("newChat.changes.compare")}
          </button>
        </div>
      )}
      <FicherosDelTurnoEnVivo projectId={projectId} turnId={turn.id} />
      {comparing && turn.preEditHtml && turn.postEditHtml && (
        <CompareDialog
          open={comparing}
          onClose={() => setComparing(false)}
          before={turn.preEditHtml}
          after={turn.postEditHtml}
        />
      )}
    </div>
  );
}
