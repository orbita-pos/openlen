"use client";
// THE CORREOS TAB of the Database view (spec local 2026-10-22-email-integration,
// 4 and 6.9): the project's email domain from the plan to a ready domain — the
// upgrade on the free plan; the field (proposing the project's own domain) and
// «show as @domain»; then Domain Connect's one-click button or the three DNS
// lines to copy, with the provider's instructions; once ready, the month against
// what's included, the latest emails, and the unsubscribed and bounced with
// «take off the list». Disconnecting asks to type the domain, like Stripe's.
// Only the owner gets here (the API answers a member 403).

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import type { EmailPanel } from "@/lib/project-email/panel";
import type { DnsRecord } from "@/lib/project-email/types";

type Panel = EmailPanel;
const CONNECT_ERRORS = ["free_plan", "invalid_domain", "host_taken", "provider_error"] as const;

export function EmailTab({ projectId }: { projectId: string }) {
  const t = useTranslations("wsChrome.database.email");
  const locale = useLocale();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<"connect" | "check" | "disconnect" | "unsuppress" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [showAsRoot, setShowAsRoot] = useState(false);
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [disconnected, setDisconnected] = useState(false);

  const send = useCallback(
    async (init?: RequestInit) => {
      const res = await fetch(`/api/projects/${projectId}/email`, { ...init, headers: { "content-type": "application/json" }, cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as Panel & { error?: string };
      if (!res.ok) throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { code: body.error });
      return body;
    },
    [projectId],
  );

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setPanel(await send());
    } catch {
      setFailed(true);
    }
  }, [send]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(kind: NonNullable<typeof busy>, init: RequestInit, after?: () => void) {
    setBusy(kind);
    setError(null);
    try {
      setPanel(await send(init));
      after?.();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(CONNECT_ERRORS.includes(code as (typeof CONNECT_ERRORS)[number]) ? t(`errors.${code as (typeof CONNECT_ERRORS)[number]}`) : t("errors.generic"));
    } finally {
      setBusy(null);
    }
  }

  if (failed) return <Shell><p role="alert" className="text-[12.5px] text-red-600 dark:text-red-400">{t("loadError")}</p></Shell>;
  if (!panel) return <Shell><p className="text-[12.5px] text-zinc-500">{t("loading")}</p></Shell>;

  const d = panel.domain;
  const field = domain ?? panel.suggestedDomain ?? "";
  const ready = d?.status === "ready";

  return (
    <Shell>
      {panel.plan === "free" && (
        <div className="max-w-xl rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-[14px] font-semibold">{t("free.title")}</h2>
          <p className="mt-1 text-[12.5px] text-zinc-500">{t("free.body")}</p>
          {/* `/api/` va en un <a> crudo: el Link de next-intl le pondría el idioma delante. */}
          <a href={`/api/billing/checkout?locale=${locale}`} className="mt-3 inline-flex rounded-md bg-coral-500 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-coral-600">
            {t("free.cta")}
          </a>
        </div>
      )}

      {disconnected && !d && <p className="mb-4 max-w-xl rounded-lg bg-zinc-50 px-3 py-2 text-[12.5px] text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">{t("cleanupDns")}</p>}

      {!d && panel.plan !== "free" && (
        <form
          className="max-w-xl"
          onSubmit={(e) => {
            e.preventDefault();
            void run("connect", { method: "POST", body: JSON.stringify({ action: "connect", domain: field.trim(), showAsRoot }) }, () => setDisconnected(false));
          }}
        >
          <h2 className="text-[14px] font-semibold">{t("connectTitle")}</h2>
          <p className="mt-1 text-[12.5px] text-zinc-500">{t("connectBody")}</p>
          <label htmlFor="email-domain" className="mt-4 block text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
            {t("domainLabel")}
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              id="email-domain"
              value={field}
              onChange={(e) => setDomain(e.target.value)}
              placeholder={t("domainPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className="w-64 max-w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 font-mono text-[13px] dark:border-zinc-800"
            />
            <button type="submit" disabled={busy !== null || !field.trim()} className="rounded-md bg-coral-500 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-coral-600 disabled:opacity-50">
              {busy === "connect" ? t("connecting") : t("connect")}
            </button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-[12.5px] text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={showAsRoot} onChange={(e) => setShowAsRoot(e.target.checked)} />
            {t("showAsRoot", { domain: field.trim() || t("domainPlaceholder") })}
          </label>
        </form>
      )}

      {error && <p role="alert" className="mt-3 max-w-xl text-[12px] text-red-600 dark:text-red-400">{error}</p>}

      {d && (
        <>
          <div className="flex max-w-2xl flex-wrap items-center gap-2">
            <h2 className="font-mono text-[14px] font-semibold">{d.sendingHost}</h2>
            <StatusBadge status={d.status} label={t(`status.${d.status}`)} />
            {!ready && (
              <button type="button" disabled={busy !== null} onClick={() => void run("check", { method: "POST", body: JSON.stringify({ action: "check" }) })} className="ml-auto text-[12.5px] font-medium text-coral-600 hover:underline disabled:opacity-50">
                {busy === "check" ? t("checking") : t("check")}
              </button>
            )}
          </div>

          {!ready && (
            <>
              <p className="mt-1 max-w-2xl text-[12px] text-zinc-500">{t("checkHint")}</p>
              {d.oneClickUrl && (
                <div className="mt-4 max-w-2xl">
                  <a href={d.oneClickUrl} className="inline-flex rounded-md bg-coral-500 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-coral-600">
                    {t("oneClick")}
                  </a>
                  <p className="mt-1 text-[12px] text-zinc-500">{t("oneClickHint")}</p>
                </div>
              )}
              <Records title={d.oneClickUrl ? t("manualTitleOr") : t("manualTitle")} records={d.records} dmarc={panel.dmarc} instructionsUrl={d.instructionsUrl} />
            </>
          )}

          {ready && (
            <>
              <section className="mt-6 max-w-2xl">
                <h3 className="mb-1 text-[13px] font-semibold">{t("usageTitle")}</h3>
                <p className="text-[12.5px] tabular-nums">{t("usage", { sent: String(panel.usage.sent), included: String(panel.usage.included) })}</p>
                {panel.usage.extraCenticredits > 0 && <p className="text-[12px] text-zinc-500">{t("extra", { credits: String(panel.usage.extraCenticredits / 100) })}</p>}
              </section>
              <section className="mt-6 max-w-2xl">
                <h3 className="mb-2 text-[13px] font-semibold">{t("recentTitle")}</h3>
                {panel.recent.length === 0 ? (
                  <p className="text-[12.5px] text-zinc-500">{t("noRecent")}</p>
                ) : (
                  <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
                    {panel.recent.map((m, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-[12.5px]">
                        <span className="min-w-0 flex-1 truncate">{m.subject}</span>
                        <span className="truncate text-zinc-500">{m.toAddress}</span>
                        <span className="text-zinc-500">{t(`kinds.${m.kind}`)}</span>
                        <span className={m.status === "bounced" || m.status === "complained" || m.status === "rejected" ? "text-red-600 dark:text-red-400" : "text-zinc-500"} title={m.reason ?? undefined}>
                          {t(`statuses.${m.status}`)}
                        </span>
                        <span className="text-zinc-400">{new Date(m.createdAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="mt-6 max-w-2xl">
                <h3 className="text-[13px] font-semibold">{t("listTitle")}</h3>
                <p className="mb-2 mt-0.5 text-[12px] text-zinc-500">{t("listHint")}</p>
                {panel.suppressions.length === 0 ? (
                  <p className="text-[12.5px] text-zinc-500">{t("noList")}</p>
                ) : (
                  <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
                    {panel.suppressions.map((s) => (
                      <li key={s.address} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                        <span className="min-w-0 flex-1 truncate">{s.address}</span>
                        <span className="text-zinc-500">{t(`reasons.${s.reason}`)}</span>
                        <button type="button" disabled={busy !== null} onClick={() => void run("unsuppress", { method: "POST", body: JSON.stringify({ action: "unsuppress", address: s.address }) })} className="shrink-0 text-[12px] text-coral-600 hover:underline disabled:opacity-50">
                          {t("unsuppress")}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <details className="mt-6 max-w-2xl">
                <summary className="cursor-pointer text-[12.5px] font-medium text-zinc-600 dark:text-zinc-300">{t("dnsLines")}</summary>
                <Records title={null} records={d.records} dmarc={panel.dmarc} instructionsUrl={d.instructionsUrl} />
              </details>
            </>
          )}

          <div className="mt-8 max-w-xl border-t border-zinc-200 pt-4 dark:border-zinc-800">
            {!asking ? (
              <button type="button" onClick={() => setAsking(true)} className="text-[12.5px] font-medium text-red-600 hover:underline">
                {t("disconnect")}
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] text-zinc-600 dark:text-zinc-300">{t("disconnectWarning")}</p>
                <label htmlFor="email-disconnect" className="text-[12px] text-zinc-500">
                  {t("disconnectTypeHint", { domain: d.domain })}
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input id="email-disconnect" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className="w-56 max-w-full rounded-md border border-zinc-200 bg-transparent px-2 py-1 font-mono text-[13px] dark:border-zinc-800" />
                  <button
                    type="button"
                    disabled={busy !== null || typed.trim().toLowerCase() !== d.domain}
                    onClick={() =>
                      void run("disconnect", { method: "DELETE" }, () => {
                        setAsking(false);
                        setTyped("");
                        setDomain(null);
                        setDisconnected(true);
                      })
                    }
                    className="rounded-md bg-red-600 px-3 py-1 text-[12.5px] font-medium text-white disabled:opacity-50"
                  >
                    {t("disconnectConfirm")}
                  </button>
                  <button type="button" onClick={() => { setAsking(false); setTyped(""); }} className="text-[12.5px] text-zinc-500 hover:underline">
                    {t("cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5">{children}</div>;
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const tone =
    status === "ready"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"
      : status === "failed" || status === "offline"
        ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30"
        : "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30";
  return <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ${tone}`}>{label}</span>;
}

function Records({ title, records, dmarc, instructionsUrl }: { title: string | null; records: readonly DnsRecord[]; dmarc: DnsRecord | null; instructionsUrl: string | null }) {
  const t = useTranslations("wsChrome.database.email");
  return (
    <section className="mt-4 max-w-2xl">
      {title && <h3 className="mb-2 text-[13px] font-semibold">{title}</h3>}
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
        {records.map((r) => (
          <RecordRow key={`${r.type}:${r.name}:${r.value}`} record={r} optional={false} />
        ))}
        {dmarc && <RecordRow record={dmarc} optional />}
      </ul>
      {dmarc && <p className="mt-1 text-[12px] text-zinc-500">{t("dmarcHint")}</p>}
      {instructionsUrl && (
        <a href={instructionsUrl} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block text-[12.5px] font-medium text-coral-600 hover:underline">
          {t("instructions")}
        </a>
      )}
    </section>
  );
}

function RecordRow({ record, optional }: { record: DnsRecord; optional: boolean }) {
  const t = useTranslations("wsChrome.database.email");
  return (
    <li className="grid gap-1 px-3 py-2 text-[12px] sm:grid-cols-[4.5rem_minmax(0,1fr)]">
      <span className="font-medium">
        {record.type}
        {record.priority !== undefined && <span className="text-zinc-500"> · {t("priority", { n: String(record.priority) })}</span>}
        {optional && <span className="block text-[11px] font-normal text-zinc-500">{t("optional")}</span>}
      </span>
      <span className="min-w-0 space-y-1">
        <Copyable label={t("recordName")} value={record.name} />
        <Copyable label={t("recordValue")} value={record.value} />
      </span>
    </li>
  );
}

function Copyable({ label, value }: { label: string; value: string }) {
  const t = useTranslations("wsChrome.database.email");
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-zinc-500">{label}</span>
      <code className="min-w-0 flex-1 break-all rounded bg-zinc-50 px-1.5 py-0.5 font-mono text-[11.5px] dark:bg-zinc-900">{value}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => {},
          );
        }}
        className="shrink-0 text-[11.5px] font-medium text-coral-600 hover:underline"
      >
        {copied ? t("copied") : t("copy")}
      </button>
    </span>
  );
}
