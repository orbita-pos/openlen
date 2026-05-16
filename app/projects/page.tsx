import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listProjects } from "@/lib/projects";
import { ProjectsView } from "./projects-view";

export const metadata = {
  title: "My pages · OpenLen",
};

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/projects");
  const projects = await listProjects(session.user.id);
  return <ProjectsView projects={projects} />;
}
