import { redirect } from "@/i18n/navigation";

// /projects now lives inside the workspace as a section. Keep the URL working
// (bookmarks, old links) by redirecting to /new with the Pages section open.
export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/new?view=projects", locale });
}
