import { notFound } from "next/navigation";
import { User } from "lucide-react";
import { getPublicProfile } from "@/lib/community/store";
import ExploreCard from "@/components/community/explore-card";
import ActivityHeatmap from "@/components/community/activity-heatmap";
import BackNav from "@/components/community/back-nav";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle: rawHandle } = await params;
  // Next serves the dynamic segment URL-encoded, so `/@name` arrives as
  // "%40name" — decode before the "@" guard (bad %-escapes → 404, not a crash).
  let handle: string | null;
  try {
    handle = decodeURIComponent(rawHandle);
  } catch {
    handle = null;
  }
  if (!handle || !handle.startsWith("@")) notFound();
  const profile = await getPublicProfile(handle.slice(1));
  if (!profile) notFound();

  const { user, pages } = profile;
  const displayName = user.name?.trim() || `@${user.handle}`;
  const totalRemixes = pages.reduce((n, p) => n + p.remixCount, 0);
  const activityDates = pages
    .map((p) => p.listedAt)
    .filter((d): d is Date => d instanceof Date);

  return (
    <main className="min-h-dvh bg-[#0a0a0b] text-neutral-100">
      <BackNav title={displayName} icon={<User size={16} />} backHref="/explore" backLabel="Back to Explore" />
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 pb-16 pt-10 sm:pt-12 lg:flex-row lg:gap-14">
        {/* Identity sidebar */}
        <aside className="lg:w-72 lg:shrink-0">
          <div className="lg:sticky lg:top-16">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt=""
                className="h-20 w-20 rounded-2xl object-cover ring-2 ring-[#ff5a36]/40"
              />
            ) : (
              <div className="grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-[#ff7e55] to-[#ff5a36] text-2xl font-semibold text-white ring-2 ring-white/10">
                {displayName.replace("@", "").charAt(0).toUpperCase()}
              </div>
            )}

            <h1 className="mt-5 text-xl font-semibold tracking-tight text-white">{displayName}</h1>
            <p className="text-sm text-neutral-500">@{user.handle}</p>
            {user.bio && (
              <p className="mt-4 max-w-prose text-sm leading-relaxed text-neutral-400">{user.bio}</p>
            )}

            <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-white/10 pt-6 lg:max-w-none">
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">Public pages</dt>
                <dd className="mt-1 text-lg font-semibold text-white">{pages.length}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">Total remixes</dt>
                <dd className="mt-1 text-lg font-semibold text-white">{totalRemixes}</dd>
              </div>
            </dl>
          </div>
        </aside>

        {/* Activity + Showcase */}
        <section className="min-w-0 flex-1">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-neutral-300">Activity</h2>
            <span className="text-xs text-neutral-600">Last 12 months</span>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#141416] p-5">
            <ActivityHeatmap dates={activityDates} />
          </div>

          <h2 className="mb-5 mt-12 text-sm font-medium text-neutral-300">Showcase</h2>
          {pages.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 py-24 text-center">
              <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-white/[0.06] text-neutral-400">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              <p className="text-sm text-neutral-500">No public pages yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 xl:grid-cols-3">
              {pages.map((p) => (
                <ExploreCard
                  key={p.id}
                  data={{
                    id: p.id,
                    title: p.title,
                    thumbnailUrl: p.thumbnailUrl,
                    deployUrl: p.deployUrl,
                    handle: p.handle,
                    avatarUrl: p.avatarUrl,
                    remixCount: p.remixCount,
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
