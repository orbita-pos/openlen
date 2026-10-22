"use client";
// THE PAYMENTS TAB of the Database view (spec local 2026-10-21-stripe-integration,
// §6.6 and §6.7): the project's Stripe in test or live mode —its account, the
// latest payments, active subscriptions, products and webhook endpoints—, read
// at that moment, each with its link to Stripe's dashboard. Read-only; refunds
// and the rest are done in Stripe. Disconnecting removes the keys (and the
// endpoints registered with them) after typing a word. Only the owner gets here.

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import type { StripePanelAnswer } from "@/lib/stripe/panel";

type Env = "draft" | "live";

function money(amount: number | null, currency: string, locale: string): string {
  if (amount === null) return "—";
  const zeroDecimal = ["jpy", "krw", "clp", "vnd", "pyg", "ugx", "xof", "xaf"].includes(currency.toLowerCase());
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(zeroDecimal ? amount : amount / 100);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function PaymentsTab({ projectId }: { projectId: string }) {
  const t = useTranslations("wsChrome.database.payments");
  const locale = useLocale();
  const [env, setEnv] = useState<Env>("draft");
  const [panel, setPanel] = useState<{ readonly env: Env; readonly data: StripePanelAnswer } | null>(null);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (which: Env) => {
    setFailed(false);
    try {
      const res = await fetch(`/api/projects/${projectId}/stripe?env=${which}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPanel({ env: which, data: (await res.json()) as StripePanelAnswer });
    } catch {
      setFailed(true);
    }
  }, [projectId]);

  useEffect(() => {
    void load(env);
  }, [load, env]);

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/stripe`, { method: "DELETE", cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAsking(false);
      setWord("");
      await load(env);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const data = panel?.env === env ? panel.data : null;
  const account = data?.account ?? null;
  const full = data && "payments" in data ? data : null;
  const confirmWord = t("disconnectWord");

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label={t("mode")} className="inline-flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900">
          {(["draft", "live"] as const).map((e) => (
            <button
              key={e}
              type="button"
              role="tab"
              aria-selected={env === e}
              onClick={() => setEnv(e)}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${env === e ? "bg-white shadow-sm dark:bg-zinc-800" : "text-zinc-500"}`}
            >
              {t(e === "draft" ? "test" : "live")}
            </button>
          ))}
        </div>
        {account && (
          <span className="text-[12.5px] text-zinc-500">
            {t("account", { name: account.name ?? account.id })}
          </span>
        )}
        {full && (
          <a href={full.dashboardUrl} target="_blank" rel="noreferrer noopener" className="ml-auto text-[12.5px] font-medium text-coral-600 hover:underline">
            {t("openInStripe")}
          </a>
        )}
      </div>

      {failed && (
        <p role="alert" className="mt-3 text-[12px] text-red-600 dark:text-red-400">
          {t("loadError")}
        </p>
      )}
      {!data && !failed && <p className="mt-4 text-[12.5px] text-zinc-500">{t("loading")}</p>}
      {data && !account && <p className="mt-4 max-w-xl text-[12.5px] text-zinc-500">{t("empty")}</p>}

      {account && env === "live" && account.chargesEnabled === false && (
        <p className="mt-3 max-w-xl rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
          {t("cannotChargeYet")}{" "}
          <a href="https://dashboard.stripe.com/account/onboarding" target="_blank" rel="noreferrer noopener" className="underline">
            {t("finishInStripe")}
          </a>
        </p>
      )}

      {full && (
        <>
          <Section title={t("payments")} empty={full.payments.length === 0 ? t("noPayments") : null}>
            {full.payments.map((p) => (
              <Row key={p.id} href={p.dashboardUrl} label={t("openInStripe")}>
                <span className="tabular-nums">{money(p.amount, p.currency, locale)}</span>
                <span className="truncate text-zinc-500">{p.email ?? "—"}</span>
                <span className="text-zinc-500">{new Date(p.created * 1000).toLocaleDateString(locale)}</span>
              </Row>
            ))}
          </Section>
          <Section title={t("subscriptions")} empty={full.subscriptions.length === 0 ? t("noSubscriptions") : null}>
            {full.subscriptions.map((s) => (
              <Row key={s.id} href={s.dashboardUrl} label={t("openInStripe")}>
                <span className="truncate">{s.email ?? "—"}</span>
                <span className="text-zinc-500">{s.price ?? ""}</span>
                <span className="text-zinc-500">{s.status}</span>
              </Row>
            ))}
          </Section>
          <Section title={t("products")} empty={full.products.length === 0 ? t("noProducts") : null}>
            {full.products.map((p) => (
              <Row key={p.id} href={`${full.dashboardUrl}/products/${p.id}`} label={t("openInStripe")}>
                <span className="truncate">{p.name}</span>
                <span className="text-zinc-500">
                  {p.prices.map((pr) => `${money(pr.amount, pr.currency, locale)}${pr.interval ? ` / ${pr.interval}` : ""}`).join(" · ")}
                </span>
              </Row>
            ))}
          </Section>
          <Section title={t("webhooks")} empty={full.webhookEndpoints.length === 0 ? t("noWebhooks") : null}>
            {full.webhookEndpoints.map((w) => (
              <Row key={w.url} href={`${full.dashboardUrl}/webhooks`} label={t("openInStripe")}>
                <span className="truncate font-mono text-[11.5px]">{w.url}</span>
                <span className="text-zinc-500">{w.status}</span>
              </Row>
            ))}
          </Section>

          <div className="mt-8 max-w-xl border-t border-zinc-200 pt-4 dark:border-zinc-800">
            {!asking ? (
              <button type="button" onClick={() => setAsking(true)} className="text-[12.5px] font-medium text-red-600 hover:underline">
                {t("disconnect")}
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] text-zinc-600 dark:text-zinc-300">{t("disconnectWarning")}</p>
                <label htmlFor="stripe-disconnect" className="text-[12px] text-zinc-500">
                  {t("disconnectTypeHint", { word: confirmWord })}
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="stripe-disconnect"
                    value={word}
                    onChange={(e) => setWord(e.target.value)}
                    autoComplete="off"
                    className="w-40 rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-[13px] dark:border-zinc-800"
                  />
                  <button
                    type="button"
                    disabled={busy || word.trim() !== confirmWord}
                    onClick={() => void disconnect()}
                    className="rounded-md bg-red-600 px-3 py-1 text-[12.5px] font-medium text-white disabled:opacity-50"
                  >
                    {t("disconnectConfirm")}
                  </button>
                  <button type="button" onClick={() => { setAsking(false); setWord(""); }} className="text-[12.5px] text-zinc-500 hover:underline">
                    {t("cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string | null; children: React.ReactNode }) {
  return (
    <section className="mt-6 max-w-2xl">
      <h2 className="mb-2 text-[13px] font-semibold">{title}</h2>
      {empty ? (
        <p className="text-[12.5px] text-zinc-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">{children}</ul>
      )}
    </section>
  );
}

function Row({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
      <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
      <a href={href} target="_blank" rel="noreferrer noopener" className="shrink-0 text-[12px] text-coral-600 hover:underline">
        {label}
      </a>
    </li>
  );
}
