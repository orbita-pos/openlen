import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/auth";
import { listProjects } from "@/lib/projects";
import { ProjectsView } from "./projects-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "projects" });
  return { title: t("metaTitle") };
}

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    redirect({ href: "/login?next=/projects", locale });
    return null;
  }
  const projects = await listProjects(userId);
  return <ProjectsView projects={projects} />;
}
