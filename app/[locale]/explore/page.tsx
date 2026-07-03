import { listExplore } from "@/lib/community/store";
import ExploreCard from "@/components/community/explore-card";

export const dynamic = "force-dynamic";

export default async function ExplorePage({
  searchParams,
}: { searchParams: Promise<{ sort?: string }> }) {
  const { sort } = await searchParams;
  const { items } = await listExplore({ sort: sort === "remixed" ? "remixed" : "recent" });
  return (
    <main className="max-w-6xl mx-auto px-4 py-10">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Explore</h1>
          <p className="text-neutral-500 text-sm">Pages the community made public. Remix any of them.</p>
        </div>
        <nav className="text-sm flex gap-3">
          <a href="?sort=recent" className="hover:underline">Recent</a>
          <a href="?sort=remixed" className="hover:underline">Most remixed</a>
        </nav>
      </header>
      {items.length === 0 ? (
        <p className="text-neutral-400 py-20 text-center">Nothing here yet — be the first to publish a page publicly.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((it) => (
            <ExploreCard key={it.id} data={{
              id: it.id, title: it.title, thumbnailUrl: it.thumbnailUrl,
              deployUrl: it.deployUrl, handle: it.handle, avatarUrl: it.avatarUrl,
              remixCount: it.remixCount,
            }} />
          ))}
        </div>
      )}
    </main>
  );
}
