import { redirect } from "@/i18n/navigation";

// /analytics now lives inside the workspace as a section. Keep the URL working
// (bookmarks, old links) by redirecting to /new with the Analytics section open.
export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/new?view=analytics", locale });
}
