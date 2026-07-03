"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";

export type ExploreCardData = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  deployUrl: string | null;
  handle: string | null;
  avatarUrl: string | null;
  remixCount: number;
};

export default function ExploreCard({ data }: { data: ExploreCardData }) {
  const router = useRouter();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const live = data.deployUrl ?? undefined;

  async function remix() {
    setBusy(true);
    const res = await fetch(`/api/projects/${data.id}/remix`, { method: "POST" });
    if (res.status === 401) {
      router.push(`/${locale}/login`);
      return;
    }
    const j = await res.json().catch(() => null);
    if (j?.projectId) router.push(`/${locale}/new?project=${j.projectId}`);
    else setBusy(false);
  }

  async function report() {
    const reason = window.prompt("Report this page for: spam, adult, phishing, or other", "spam");
    if (!reason) return;
    await fetch(`/api/explore/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: data.id, reason }),
    });
    window.alert("Thanks — our team will take a look.");
  }

  return (
    <div className="group flex flex-col">
      {/* Preview — links to the live page */}
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#141416] transition-colors duration-200 group-hover:border-white/25">
        <a
          href={live ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="block aspect-[16/10] outline-none focus-visible:ring-2 focus-visible:ring-[#ff5a36]"
          aria-label={`Open ${data.title}`}
        >
          {data.thumbnailUrl ? (
            <img
              src={data.thumbnailUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[#1b1b1e] to-[#0f0f11] text-xs text-neutral-600">
              No preview
            </div>
          )}
        </a>

        {/* Hover scrim + actions */}
        <div className="pointer-events-none absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/70 via-black/0 to-black/0 p-2.5 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100 motion-reduce:transition-none">
          <button
            onClick={remix}
            disabled={busy}
            className="pointer-events-auto rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black shadow-sm transition hover:bg-neutral-200 disabled:opacity-60"
          >
            {busy ? "Remixing…" : "Remix"}
          </button>
          <button
            onClick={report}
            title="Report"
            className="pointer-events-auto rounded-md p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="Report page"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Meta */}
      <div className="mt-3 flex items-start gap-2.5">
        {data.avatarUrl ? (
          <img src={data.avatarUrl} alt="" className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-white/10" />
        ) : (
          <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-gradient-to-br from-[#ff7e55] to-[#ff5a36]" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-neutral-100">{data.title}</p>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500">
            {data.handle && (
              <a href={`/${locale}/@${data.handle}`} className="truncate hover:text-neutral-300">
                @{data.handle}
              </a>
            )}
            <span className="text-neutral-700">·</span>
            <span className="inline-flex shrink-0 items-center gap-1" title="Remixes">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 6a9 9 0 0 1-9 9" /><circle cx="18" cy="6" r="3" />
              </svg>
              {data.remixCount}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
