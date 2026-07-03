"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";

export type ExploreCardData = {
  id: string; title: string; thumbnailUrl: string | null;
  deployUrl: string | null; handle: string | null; avatarUrl: string | null;
  remixCount: number;
};

export default function ExploreCard({ data }: { data: ExploreCardData }) {
  const router = useRouter();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);

  async function remix() {
    setBusy(true);
    const res = await fetch(`/api/projects/${data.id}/remix`, { method: "POST" });
    if (res.status === 401) { router.push(`/${locale}/login`); return; }
    const j = await res.json().catch(() => null);
    if (j?.projectId) router.push(`/${locale}/new?project=${j.projectId}`);
    else setBusy(false);
  }

  async function report() {
    const reason = window.prompt("Reason? (spam / adult / phishing / other)", "spam");
    if (!reason) return;
    await fetch(`/api/explore/report`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: data.id, reason }),
    });
    window.alert("Thanks — reported.");
  }

  return (
    <div className="group rounded-xl border border-black/10 overflow-hidden bg-white">
      <a href={data.deployUrl ?? "#"} target="_blank" rel="noreferrer" className="block aspect-[4/3] bg-neutral-100">
        {data.thumbnailUrl
          ? <img src={data.thumbnailUrl} alt={data.title} className="w-full h-full object-cover" loading="lazy" />
          : <div className="w-full h-full grid place-items-center text-neutral-400 text-sm">No preview</div>}
      </a>
      <div className="p-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{data.title}</p>
          {data.handle && (
            <a href={`/${locale}/@${data.handle}`} className="text-xs text-neutral-500 hover:underline">@{data.handle}</a>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-neutral-400" title="remixes">⑂ {data.remixCount}</span>
          <button onClick={remix} disabled={busy}
            className="text-xs px-2 py-1 rounded-md bg-black text-white disabled:opacity-50">
            {busy ? "…" : "Remix"}
          </button>
          <button onClick={report} className="text-xs px-1.5 py-1 rounded-md text-neutral-400 hover:text-neutral-700" title="Report">⚑</button>
        </div>
      </div>
    </div>
  );
}
