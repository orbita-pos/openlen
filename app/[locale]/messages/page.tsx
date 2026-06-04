import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/auth";
import { listSubmissionsForUser } from "@/lib/projects/forms";
import { DashboardShell } from "@/components/app/dashboard-shell";
import { MessagesView } from "./messages-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "projects" });
  return { title: t("inbox.title") };
}

export default async function MessagesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    redirect({ href: "/login?next=/messages", locale });
    return null;
  }
  const rows = await listSubmissionsForUser(userId);
  // Strip raw ip/ua — the client only sees the derived triage fields.
  const leads = rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    projectTitle: r.projectTitle,
    subdomain: r.subdomain,
    data: r.data,
    country: r.meta?.country ?? null,
    device: r.meta?.device ?? null,
    createdAt: r.createdAt,
  }));
  return (
    <DashboardShell active="messages">
      <MessagesView leads={leads} />
    </DashboardShell>
  );
}
