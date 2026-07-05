"use client";

// Explore as an in-workspace center view (?view=explore), consuming the same
// GET /api/explore + listExplore the public /explore route uses — but
// theme-aware (workspace tokens, light + dark) instead of the public route's
// fixed dark look. The card body is NOT the shared `ExploreCard` component:
// that component hard-codes its meta text (text-neutral-100/500/700) with no
// background behind it, assuming the public route's permanent bg-[#0a0a0b]
// page — on the workspace's light bg those colors would be near-invisible.
// Same open/remix/report actions, rebuilt here with workspace tokens for the
// meta row. The photo-overlay chrome (dark scrim + white "Remix" pill) is kept
// as-is deliberately: it composites onto arbitrary thumbnail photos, not the
// page background, so it stays legible in both themes without token styling
// (same convention as any photo-card hover scrim, e.g. video thumbnails).

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { appendExplorePage, type ExploreItem } from "./explore-view-utils";
import { Button, Segmented } from "@/components/workspace-v2/ui";
import { AlertTriangle, Compass } from "@/components/workspace-v2/icons";
import { useToast } from "@/components/workspace-v2/toast";

type Sort = "recent" | "remixed";
type Status = "loading" | "ready" | "error";

export function ExploreView() {
  const t = useTranslations("explore");
  const [sort, setSort] = useState<Sort>("recent");
  const [items, setItems] = useState<ExploreItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<Status>("loading");
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (nextSort: Sort, nextCursor?: string) => {
    const isMore = !!nextCursor;
    if (isMore) setLoadingMore(true);
    else setStatus("loading");
    try {
      const q = new URLSearchParams({ sort: nextSort });
      if (nextCursor) q.set("cursor", nextCursor);
      const res = await fetch(`/api/explore?${q}`);
      if (!res.ok) throw new Error(String(res.status));
      const data: { items?: ExploreItem[]; nextCursor?: string | null } = await res.json();
      setItems((prev) => (isMore ? appendExplorePage(prev, data.items ?? []) : (data.items ?? [])));
      setCursor(data.nextCursor ?? undefined);
      setStatus("ready");
    } catch {
      if (!isMore) setStatus("error");
    } finally {
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load(sort);
  }, [sort, load]);

  return (
    <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-app">
      <div className="flex-1 min-h-0 overflow-y-auto nice-scroll">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-8 py-9">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-7">
            <div className="min-w-0">
              <h2 className="text-[17px] font-semibold fg mb-1">{t("title")}</h2>
              <p className="text-[13px] fg-muted max-w-lg leading-relaxed">{t("subtitle")}</p>
            </div>
            <Segmented
              value={sort}
              onChange={setSort}
              size="sm"
              className="shrink-0"
              options={[
                { value: "recent", label: t("sortRecent") },
                { value: "remixed", label: t("sortRemixed") },
              ]}
            />
          </header>

          {status === "loading" ? (
            <SkeletonGrid />
          ) : status === "error" ? (
            <ErrorState onRetry={() => load(sort)} />
          ) : items.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-9">
                {items.map((item) => (
                  <ExploreItemCard key={item.id} item={item} />
                ))}
              </div>
              {cursor && (
                <div className="mt-9 flex justify-center">
                  <Button variant="outline" onClick={() => load(sort, cursor)} disabled={loadingMore}>
                    {loadingMore ? t("loadingMore") : t("loadMore")}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function SkeletonGrid() {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-9"
      aria-hidden="true"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex flex-col">
          <div
            className="aspect-[16/10] rounded-xl animate-pulse"
            style={{ background: "var(--bg-elev)" }}
          />
          <div className="mt-3 flex items-center gap-2.5">
            <div
              className="h-6 w-6 shrink-0 rounded-full animate-pulse"
              style={{ background: "var(--bg-elev)" }}
            />
            <div
              className="h-3 flex-1 max-w-[70%] rounded animate-pulse"
              style={{ background: "var(--bg-elev)" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("explore");
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bd py-24 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-hover text-[var(--accent-strong)]">
        <AlertTriangle size={20} />
      </div>
      <p className="text-[15px] font-medium fg">{t("loadError")}</p>
      <Button variant="outline" className="mt-4" onClick={onRetry}>
        {t("retry")}
      </Button>
    </div>
  );
}

function EmptyState() {
  const t = useTranslations("explore");
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bd py-24 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-hover fg-muted">
        <Compass size={20} />
      </div>
      <p className="text-[15px] font-medium fg">{t("emptyTitle")}</p>
      <p className="mt-1 text-sm fg-muted max-w-xs">{t("emptyHint")}</p>
    </div>
  );
}

function ExploreItemCard({ item }: { item: ExploreItem }) {
  const t = useTranslations("explore");
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const live = item.deployUrl ?? undefined;

  async function remix() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${item.id}/remix`, { method: "POST" });
      if (res.status === 401) {
        router.push(`/${locale}/login`);
        return;
      }
      const j = await res.json().catch(() => null);
      if (j?.projectId) {
        router.push(`/${locale}/new?project=${j.projectId}`);
        return;
      }
      toast.error(t("remixError"));
    } catch {
      toast.error(t("remixError"));
    } finally {
      setBusy(false);
    }
  }

  async function report() {
    const reason = window.prompt(t("reportPrompt"), "spam");
    if (!reason) return;
    await fetch(`/api/explore/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: item.id, reason }),
    });
    toast.success(t("reportThanks"));
  }

  return (
    <div className="group flex flex-col">
      {/* Preview — links to the live page */}
      <div className="relative overflow-hidden rounded-xl border bd transition-colors duration-200 group-hover:border-[color:var(--border-strong)]">
        <a
          href={live ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="block aspect-[16/10] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-strong)]"
          aria-label={t("openAria", { title: item.title })}
        >
          {item.thumbnailUrl ? (
            <img
              src={item.thumbnailUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid h-full w-full place-items-center bg-hover text-[11px] fg-faint">
              {t("noPreview")}
            </div>
          )}
        </a>

        {/* Hover scrim + actions — overlay chrome atop the thumbnail photo, not
            the page background, so it intentionally stays dark/white in both
            themes (same convention as any photo-card hover scrim). */}
        <div className="pointer-events-none absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/70 via-black/0 to-black/0 p-2.5 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100 motion-reduce:transition-none">
          <button
            type="button"
            onClick={remix}
            disabled={busy}
            className="pointer-events-auto rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black shadow-sm transition hover:bg-neutral-200 disabled:opacity-60"
          >
            {busy ? t("remixing") : t("remix")}
          </button>
          <button
            type="button"
            onClick={report}
            title={t("report")}
            aria-label={t("reportAria")}
            className="pointer-events-auto rounded-md p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Meta — token-styled (this is the part that broke in light mode on
          the shared ExploreCard: it has no background of its own). */}
      <div className="mt-3 flex items-start gap-2.5">
        {item.avatarUrl ? (
          <img
            src={item.avatarUrl}
            alt=""
            className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-[color:var(--border)]"
          />
        ) : (
          <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-[var(--accent-strong)]" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium fg">{item.title}</p>
          <div className="mt-0.5 flex items-center gap-2 text-xs fg-muted">
            {item.handle && (
              <a href={`/${locale}/@${item.handle}`} className="truncate hover:fg">
                @{item.handle}
              </a>
            )}
            <span className="fg-faint">·</span>
            <span className="inline-flex shrink-0 items-center gap-1" title={t("remixesTitle")}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 6a9 9 0 0 1-9 9" /><circle cx="18" cy="6" r="3" />
              </svg>
              {item.remixCount}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
