"use client";
// LAS EDGE FUNCTIONS DEL PROYECTO, en la vista Base de datos (spec local
// 2026-10-11, Parte 6): cada función y dónde está (borrador, producción), las
// llamadas del mes contra la cuota de su plan, y los últimos errores —ya
// tapados al anotarse: aquí no sale ningún secreto—.

import { useLocale, useTranslations } from "next-intl";

import type { FunctionsOverview } from "@/lib/functions/overview";

function Etiqueta({ children, apagada }: { children: React.ReactNode; apagada?: boolean }) {
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
        apagada ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400" : "bg-coral-500/10 text-coral-600 dark:text-coral-400"
      }`}
    >
      {children}
    </span>
  );
}

export function FunctionsTab({ overview }: { overview: FunctionsOverview }) {
  const t = useTranslations("wsChrome.database.functions");
  const locale = useLocale();
  const { calls, quota } = overview.usage;
  const pct = quota > 0 ? Math.min(100, Math.round((calls / quota) * 100)) : 0;
  const barra = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-coral-500";
  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5">
      {overview.blocked && (
        <p role="alert" className="mb-4 max-w-xl rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {t("blocked")}
        </p>
      )}
      <div className="mb-5 max-w-xl">
        <div className="flex items-baseline justify-between text-[12.5px]">
          <span>{t("calls", { calls: calls.toLocaleString(locale), quota: quota.toLocaleString(locale) })}</span>
          <span className="tabular-nums text-zinc-500">{pct}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t("callsLabel")}
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900"
        >
          <div className={`h-full rounded-full ${barra}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      {overview.functions.length === 0 ? (
        <p className="text-[13px] text-zinc-500">{t("empty")}</p>
      ) : (
        <ul className="max-w-xl divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
          {overview.functions.map((f) => (
            <li key={f.name} className="flex flex-wrap items-center gap-1.5 px-3 py-2">
              <code className="mr-1 font-mono text-[12.5px]">{f.name}</code>
              {f.draft && <Etiqueta>{t("draft")}</Etiqueta>}
              {f.live && <Etiqueta>{t("live")}</Etiqueta>}
              {!f.verifyJwt && <Etiqueta apagada>{t("noJwt")}</Etiqueta>}
            </li>
          ))}
        </ul>
      )}
      <h2 className="mb-2 mt-6 text-[13px] font-semibold">{t("errorsTitle")}</h2>
      {overview.errors.length === 0 ? (
        <p className="text-[12.5px] text-zinc-500">{t("noErrors")}</p>
      ) : (
        <ul className="max-w-3xl space-y-2">
          {overview.errors.map((e, i) => (
            <li key={`${e.startedAt}-${i}`} className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <code className="font-mono">{e.name}</code>
                <Etiqueta apagada>{e.environment === "draft" ? t("draft") : t("live")}</Etiqueta>
                <span className="font-mono text-red-600 dark:text-red-400">{e.errorCode ?? e.status}</span>
                <time className="ml-auto text-zinc-400" dateTime={e.startedAt}>
                  {new Date(e.startedAt).toLocaleString(locale)}
                </time>
              </div>
              {e.error && (
                <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] text-zinc-600 dark:text-zinc-400">{e.error}</pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
