"use client";

// THE SECURITY REVIEW, as the owner sees it (spec local
// 2026-10-15-security-review-design, 4.4):
//   · what holds the publish back, in red;
//   · the warnings, in amber;
//   · what was accepted before;
//   · a grey line when only the basic rules ran.
// Used by the publish dialog and by Len's publish card.

import { useTranslations } from "next-intl";
import { Check, Loader2, ShieldAlert, TriangleAlert } from "lucide-react";

import type { Finding, ReviewView } from "@/lib/security-review/types";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export function findingTitle(f: Finding, t: Translate): string {
  if (f.source === "model") return f.description;
  if (f.category === "secret_in_client" && !f.params?.provider) return t("rules.secret_in_client.titlePrivateKey");
  return t(`rules.${f.category}.title`, { ...f.params });
}

function findingWhere(f: Finding, t: Translate): string | null {
  if (f.file) return f.line ? `${f.file}:${f.line}` : f.file;
  if (f.params?.variable) return t("inVariable", { name: f.params.variable });
  return null;
}

/** What «Arreglar con Len» sends: the header and one line per blocking finding. */
export function fixRequestText(view: ReviewView, t: Translate): string {
  return [
    t("fixRequest"),
    ...view.blocking.map((f) => {
      const where = findingWhere(f, t);
      return `- ${findingTitle(f, t)}${where ? ` (${where})` : ""}`;
    }),
  ].join("\n");
}

function FindingItem({ f, t }: { f: Finding; t: Translate }) {
  const where = findingWhere(f, t);
  const scenario = f.source === "rule" ? t(`rules.${f.category}.scenario`, { ...f.params }) : f.exploitScenario;
  const fix = f.source === "rule" ? t(`rules.${f.category}.fix`, { ...f.params }) : f.recommendation;
  return (
    <li className="mt-1.5 first:mt-0">
      <div className="font-medium">{findingTitle(f, t)}</div>
      {where && <code className="break-all text-[10.5px] opacity-80">{where}</code>}
      {scenario && <p className="m-0 mt-0.5">{t("scenario", { text: scenario })}</p>}
      {fix && <p className="m-0 mt-0.5">{t("fix", { text: fix })}</p>}
    </li>
  );
}

export interface SecurityPanelProps {
  readonly view: ReviewView | null;
  readonly busy: boolean;
  readonly onPublishAnyway?: () => void;
  readonly onFixWithLen?: () => void;
  readonly onCancel?: () => void;
}

export function SecurityPanel(props: SecurityPanelProps) {
  const t = useTranslations("modalsDomain.security");
  return <SecurityPanelView {...props} t={(k, v) => t(k as never, v as never)} />;
}

const BUTTON = "h-7 rounded-md px-2.5 text-[11.5px] font-medium transition disabled:opacity-50";

export function SecurityPanelView({ view, busy, onPublishAnyway, onFixWithLen, onCancel, t }: SecurityPanelProps & { readonly t: Translate }) {
  if (!view) return null;
  if (view.status === "running") {
    return (
      <div className="flex items-center gap-1.5 text-[11.5px] fg-muted">
        <Loader2 size={12} className="animate-spin" />
        {t("running")}
      </div>
    );
  }
  const note = view.status === "done" ? null : t(`rulesOnly.${view.status}`);
  const clean = view.status === "done" && view.blocking.length === 0 && view.medium.length === 0;
  return (
    <div className="flex flex-col gap-2 text-[11.5px]">
      {view.blocking.length > 0 && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50/70 px-2.5 py-2 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
          <div className="flex items-center gap-1.5 font-medium">
            <ShieldAlert size={12} />
            {t("blockingTitle", { count: view.blocking.length })}
          </div>
          <ul className="m-0 mt-1.5 list-none p-0">
            {view.blocking.map((f) => <FindingItem key={f.key} f={f} t={t} />)}
          </ul>
          {(onFixWithLen || onPublishAnyway || onCancel) && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {onFixWithLen && (
                <button type="button" onClick={onFixWithLen} disabled={busy} className={`${BUTTON} bg-[var(--accent-strong)] text-white hover:brightness-105`}>
                  {t("fixWithLen")}
                </button>
              )}
              {onPublishAnyway && (
                <button type="button" onClick={onPublishAnyway} disabled={busy} className={`${BUTTON} border border-red-300 hover:bg-red-100 dark:border-red-500/40 dark:hover:bg-red-500/20`}>
                  {t("publishAnyway")}
                </button>
              )}
              {onCancel && (
                <button type="button" onClick={onCancel} disabled={busy} className={`${BUTTON} fg-faint hover:fg`}>
                  {t("cancel")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {view.medium.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50/70 px-2.5 py-2 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          <div className="flex items-center gap-1.5 font-medium">
            <TriangleAlert size={12} />
            {t("mediumTitle")}
          </div>
          <ul className="m-0 mt-1.5 list-none p-0">
            {view.medium.map((f) => <FindingItem key={f.key} f={f} t={t} />)}
          </ul>
        </div>
      )}
      {view.accepted.length > 0 && (
        <details className="fg-muted">
          <summary className="cursor-pointer">{t("acceptedTitle")}</summary>
          <ul className="m-0 mt-1 list-none p-0">
            {view.accepted.map((f) => <FindingItem key={f.key} f={f} t={t} />)}
          </ul>
        </details>
      )}
      {clean && (
        <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
          <Check size={12} />
          {t("clean")}
        </div>
      )}
      {note && <p className="m-0 fg-faint">{note}</p>}
    </div>
  );
}
