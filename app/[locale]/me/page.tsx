// /me — «TU PERFIL» (el menú de cuenta). Con @, a /@handle; sin él, primero se
// elige (ChooseHandle). Sin sesión, a entrar.
import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import ChooseHandle from "@/components/profile/choose-handle";
import { redirect } from "@/i18n/navigation";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function MePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect({ href: "/login?next=/me", locale });
  const [u] = await db.select({ handle: schema.users.handle }).from(schema.users).where(eq(schema.users.id, userId!)).limit(1);
  if (u?.handle) redirect({ href: `/@${u.handle}`, locale });
  return <ChooseHandle />;
}
