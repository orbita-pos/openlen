// /@handle — EL PERFIL DE UNA PERSONA (docs/superpowers/specs/2026-10-10-profile-design.md).
// El servidor decide qué ve quien mira (`getProfile`); ProfileView lo pinta.
import { notFound } from "next/navigation";
import { User } from "lucide-react";

import { auth } from "@/auth";
import BackNav from "@/components/community/back-nav";
import { ProfileView } from "@/components/profile/profile-view";
import { getProfile } from "@/lib/profile/store";

export const dynamic = "force-dynamic";

export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle: rawHandle } = await params;
  // Next sirve el segmento con %-escapes: `/@ana` llega como "%40ana". Se
  // decodifica antes de mirar la «@» (un escape roto → 404, no un error).
  let handle: string | null;
  try {
    handle = decodeURIComponent(rawHandle);
  } catch {
    handle = null;
  }
  if (!handle || !handle.startsWith("@")) notFound();
  const session = await auth();
  const profile = await getProfile(handle.slice(1), session?.user?.id ?? null);
  if (!profile) notFound();
  return (
    <main className="min-h-dvh bg-[#0a0a0b] text-neutral-100">
      <BackNav title={profile.name?.trim() || `@${profile.handle}`} icon={<User size={16} />} />
      <ProfileView profile={profile} />
    </main>
  );
}
