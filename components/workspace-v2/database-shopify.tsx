"use client";
// THE SHOPIFY TAB of the Database view (spec local 2026-10-22-shopify-storefront, §6.6):
// the store the project sells from — its name, domains, currency, country, counts (as read
// when it was connected) — a link to its Shopify admin, and «Desconectar», which asks first
// and says plainly that the pages don't change. The store is connected by talking to Len.
// Read only: OpenLen keeps no copy of the catalog. Only the owner gets here (the API answers
// a member 403).

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import type { ShopifyPanel } from "@/lib/shopify/panel";

/** The panel as it arrives over JSON: its dates are strings. */
type Panel = Omit<ShopifyPanel, "store"> & {
  readonly store: (Omit<NonNullable<ShopifyPanel["store"]>, "checkedAt" | "connectedAt"> & { readonly checkedAt: string; readonly connectedAt: string }) | null;
};

export function ShopifyTab({ projectId }: { projectId: string }) {
  const t = useTranslations("wsChrome.database.shopify");
  const locale = useLocale();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [disconnected, setDisconnected] = useState(false);

  const send = useCallback(
    async (init?: RequestInit) => {
      const res = await fetch(`/api/projects/${projectId}/shopify`, { ...init, cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as Panel & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      return body;
    },
    [projectId],
  );

  const load = useCallback(async () => {
    try {
      setPanel(await send());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [send]);

  useEffect(() => {
    void load();
  }, [load]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    try {
      setPanel(await send({ method: "DELETE" }));
      setAsking(false);
      setDisconnected(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [send]);

  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });

  if (failed) return <Shell><p role="alert" className="text-[12.5px] text-red-600 dark:text-red-400">{t("loadError")}</p></Shell>;
  if (!panel) return <Shell><p className="text-[12.5px] text-zinc-500">{t("loading")}</p></Shell>;
  const s = panel.store;
  if (!s) {
    return (
      <Shell>
        {disconnected && <p className="max-w-xl rounded-lg bg-zinc-50 px-3 py-2 text-[12.5px] text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">{t("disconnected")}</p>}
      </Shell>
    );
  }
  return (
    <Shell>
      <section className="max-w-xl rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-[12px] font-medium text-zinc-500">{t("title")}</p>
        <h2 className="mt-1 text-[15px] font-semibold">{s.name}</h2>
        <p className="mt-1 font-mono text-[12.5px] text-zinc-600 dark:text-zinc-300">
          {s.primaryDomain}
          {s.primaryDomain !== s.shopDomain && <span className="text-zinc-400"> · {s.shopDomain}</span>}
        </p>
        <p className="mt-3 text-[12.5px] text-zinc-600 dark:text-zinc-300">{t("currencyCountry", { currency: s.currency, country: s.country })}</p>
        <p className="mt-1 text-[12.5px] text-zinc-600 dark:text-zinc-300">{t("catalog", { products: s.productsCount, collections: s.collectionsCount, date: date(s.checkedAt) })}</p>
        <p className="mt-1 text-[12px] text-zinc-500">{t("connectedAt", { date: date(s.connectedAt) })}</p>
        <a href={s.adminUrl} target="_blank" rel="noopener" className="mt-4 inline-flex rounded-md bg-coral-500 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-coral-600">
          {t("open")}
        </a>
        <p className="mt-4 text-[12px] text-zinc-500">{t("readOnly")}</p>
      </section>

      <div className="mt-8 max-w-xl border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {!asking ? (
          <button type="button" onClick={() => setAsking(true)} className="text-[12.5px] font-medium text-red-600 hover:underline">
            {t("disconnect")}
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-zinc-600 dark:text-zinc-300">{t("disconnectConfirm")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy} onClick={() => void disconnect()} className="rounded-md bg-red-600 px-3 py-1 text-[12.5px] font-medium text-white disabled:opacity-50">
                {t("disconnectYes")}
              </button>
              <button type="button" onClick={() => setAsking(false)} className="text-[12.5px] text-zinc-500 hover:underline">
                {t("cancel")}
              </button>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5">{children}</div>;
}
