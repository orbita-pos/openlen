import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/auth";
import { listProjects } from "@/lib/projects";
import { getProjectStatsForUser } from "@/lib/analytics/queries";
import { DashboardShell } from "@/components/app/dashboard-shell";
import { AnalyticsView } from "./analytics-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "projects" });
  return { title: t("analytics.title") };
}

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    redirect({ href: "/login?next=/analytics", locale });
    return null;
  }
  const [projects, statsMap] = await Promise.all([
    listProjects(userId),
    getProjectStatsForUser(userId, 30),
  ]);
  const perPage = projects
    .map((p) => {
      const s = statsMap.get(p.id) ?? { views: 0, clicks: 0, leads: 0 };
      return {
        id: p.id,
        title: p.title,
        subdomain: p.subdomain,
        views: s.views,
        clicks: s.clicks,
        leads: s.leads,
      };
    })
    .filter((p) => p.subdomain !== null || p.views > 0 || p.leads > 0)
    .sort((a, b) => b.views - a.views || b.leads - a.leads);
  const totals = perPage.reduce(
    (acc, p) => ({
      views: acc.views + p.views,
      clicks: acc.clicks + p.clicks,
      leads: acc.leads + p.leads,
    }),
    { views: 0, clicks: 0, leads: 0 },
  );
  return (
    <DashboardShell active="analytics">
      <AnalyticsView totals={totals} perPage={perPage} />
    </DashboardShell>
  );
}
