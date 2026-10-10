"use client";

// Lo que publicar hará con los datos (spec local
// 2026-10-09-borrador-y-produccion-de-datos), en el modal y en la tarjeta de
// Len: en la primera publicación, la casilla de copiar los datos de prueba; en
// las siguientes, los cambios de tablas; y la confirmación roja de lo que borra
// datos reales. Con las clases del modal (Tailwind con `dark:`), que valen en
// los dos sitios.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import type { DataChangesPreview, DestructiveChange } from "@/lib/backend/data-changes-types";

/** Lo que el modal pide a /api/projects/[id]/backend/environments. */
export function useDataChangesPreview(projectId: string | null, enabled = true): DataChangesPreview | null {
  const [preview, setPreview] = useState<DataChangesPreview | null>(null);
  useEffect(() => {
    setPreview(null);
    if (!projectId || !enabled) return;
    let live = true;
    fetch(`/api/projects/${projectId}/backend/environments`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { preview?: DataChangesPreview } | null) => {
        if (live) setPreview(b?.preview ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [projectId, enabled]);
  return preview;
}

export function DataChangesNotice({
  preview,
  copyDraftData,
  onCopyDraftData,
}: {
  preview: DataChangesPreview | null;
  copyDraftData: boolean;
  onCopyDraftData: (v: boolean) => void;
}) {
  const t = useTranslations("modalsDomain.dataChanges");
  if (!preview || preview.kind === "none" || preview.kind === "failed") return null;
  return (
    <div className="rounded-lg bg-zinc-50/60 dark:bg-zinc-900/50 ring-1 ring-zinc-200 dark:ring-zinc-800 px-3.5 py-3">
      <div className="text-[10.5px] uppercase tracking-wider text-zinc-400 font-semibold mb-1">{t("title")}</div>
      {preview.kind === "first_publish" && (
        <>
          <p className="text-[11px] text-zinc-500 leading-relaxed">{t("firstPublish")}</p>
          <label className="mt-2 flex items-start gap-2 text-[12px] text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" className="mt-0.5" checked={copyDraftData} onChange={(e) => onCopyDraftData(e.target.checked)} />
            <span>
              {t("copyDraftData")}
              <span className="block text-[11px] text-zinc-500">{t("copyDraftDataHint")}</span>
            </span>
          </label>
        </>
      )}
      {preview.kind === "pending" && <p className="text-[11px] text-zinc-500 leading-relaxed">{t("pending", { names: preview.migrations.join(", ") })}</p>}
      {preview.kind === "diverged" && <p className="text-[11px] text-red-600 dark:text-red-400">{t("diverged", { versions: preview.versions.join(", ") })}</p>}
    </div>
  );
}

/** Cada cambio destructivo, dicho en una línea. */
export function useDestructiveLine(): (d: DestructiveChange) => string {
  const t = useTranslations("modalsDomain.dataChanges");
  return (d) =>
    d.kind === "drop_table"
      ? t("dropTable", { table: d.table, count: d.count })
      : d.kind === "drop_column"
        ? t("dropColumn", { table: d.table, column: d.column, count: d.count })
        : d.kind === "alter_type"
          ? t("alterType", { table: d.table, column: d.column, from: d.from, to: d.to, count: d.count })
          : t("deleteRows", { count: d.count, statement: d.statement });
}

/** La confirmación roja. Sin `onConfirm`, sólo avisa (la tarjeta de Len lo
 *  enseña ANTES de pulsar, con lo que Len ensayó). */
export function DestructiveConfirm({
  destructive,
  busy = false,
  onConfirm,
  onCancel,
}: {
  destructive: readonly DestructiveChange[];
  busy?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("modalsDomain.dataChanges");
  const line = useDestructiveLine();
  return (
    <div role="alert" className="rounded-lg ring-1 ring-red-500/40 bg-red-500/5 px-3.5 py-3">
      <div className="text-[12px] font-semibold text-red-600 dark:text-red-400">{t("destructiveTitle")}</div>
      <ul className="mt-1 list-disc pl-5 text-[12px] text-zinc-700 dark:text-zinc-300">
        {destructive.map((d, i) => (
          <li key={i}>{line(d)}</li>
        ))}
      </ul>
      {onConfirm && (
        <div className="mt-3 flex justify-end gap-2">
          {onCancel && (
            <button type="button" className="rounded-md px-3 py-1.5 text-[12px] text-zinc-700 dark:text-zinc-300" onClick={onCancel} disabled={busy}>
              {t("cancel")}
            </button>
          )}
          <button type="button" className="rounded-md bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60" onClick={onConfirm} disabled={busy}>
            {t("publishAnyway")}
          </button>
        </div>
      )}
    </div>
  );
}
