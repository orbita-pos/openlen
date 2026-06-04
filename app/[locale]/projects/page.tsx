import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/auth";
import { listProjects } from "@/lib/projects";
import { listProfiles } from "@/lib/business-profiles/store";
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
  const [projects, profileRows] = await Promise.all([
    listProjects(userId),
    listProfiles(userId),
  ]);
  const profiles = profileRows.map((p) => ({
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
  }));
  return <ProjectsView projects={projects} profiles={profiles} />;
}
