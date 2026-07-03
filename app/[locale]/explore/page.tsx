import Link from "next/link";
import { Compass } from "lucide-react";
import { listExplore } from "@/lib/community/store";
import ExploreCard from "@/components/community/explore-card";
import BackNav from "@/components/community/back-nav";

export const dynamic = "force-dynamic";

export default async function ExplorePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sort?: string }>;
}) {
  const { locale } = await params;
  const { sort: sortParam } = await searchParams;
  const sort = sortParam === "remixed" ? "remixed" : "recent";
  const { items } = await listExplore({ sort });

  const tab = (value: "recent" | "remixed", label: string) => (
    <Link
      href={`/${locale}/explore?sort=${value}`}
      className={`rounded-md px-3 py-1.5 text-sm transition ${
        sort === value ? "bg-white/10 text-white" : "text-neutral-400 hover:text-white"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <main className="min-h-dvh bg-[#0a0a0b] text-neutral-100">
      <BackNav title="Explore" icon={<Compass size={16} />} />
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:pt-12">
        <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Explore</h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-neutral-400">
              Real pages, made public by their creators. Open any one, then remix it into your
              own project and make it yours.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-[#141416] p-1">
            {tab("recent", "Recent")}
            {tab("remixed", "Most remixed")}
          </div>
        </header>

        <div className="mt-10">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 py-24 text-center">
              <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-white/[0.06] text-neutral-400">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              <p className="text-[15px] font-medium text-neutral-200">Nothing here yet</p>
              <p className="mt-1 text-sm text-neutral-500">Publish a page publicly and it lands here for everyone to remix.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((it) => (
                <ExploreCard
                  key={it.id}
                  data={{
                    id: it.id,
                    title: it.title,
                    thumbnailUrl: it.thumbnailUrl,
                    deployUrl: it.deployUrl,
                    handle: it.handle,
                    avatarUrl: it.avatarUrl,
                    remixCount: it.remixCount,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
