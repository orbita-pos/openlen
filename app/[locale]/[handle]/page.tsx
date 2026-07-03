import { notFound } from "next/navigation";
import { getPublicProfile } from "@/lib/community/store";
import ExploreCard from "@/components/community/explore-card";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: { params: Promise<{ handle: string }> }) {
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

  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <header className="flex items-center gap-4 mb-8">
        {profile.user.avatarUrl
          ? <img src={profile.user.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover" />
          : <div className="w-16 h-16 rounded-full bg-neutral-200" />}
        <div>
          <h1 className="text-xl font-semibold">@{profile.user.handle}</h1>
          {profile.user.name && <p className="text-neutral-600">{profile.user.name}</p>}
          {profile.user.bio && <p className="text-neutral-500 text-sm mt-1 max-w-prose">{profile.user.bio}</p>}
        </div>
      </header>
      {profile.pages.length === 0 ? (
        <p className="text-neutral-400 py-16 text-center">No public pages yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {profile.pages.map((p) => (
            <ExploreCard key={p.id} data={{
              id: p.id, title: p.title, thumbnailUrl: p.thumbnailUrl,
              deployUrl: p.deployUrl, handle: p.handle, avatarUrl: p.avatarUrl,
              remixCount: p.remixCount,
            }} />
          ))}
        </div>
      )}
    </main>
  );
}
