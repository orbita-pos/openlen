import {notFound} from "next/navigation";
import {eq} from "drizzle-orm";
import {auth} from "@/auth";
import {redirect} from "@/i18n/navigation";
import {db,schema} from "@/lib/db";
import {accesoAlProyecto} from "@/lib/projects/acceso";
import {artifactsEnabled} from "@/lib/artifacts/runtime";
import {ArtifactLibrary} from "@/components/workspace-v2/artifacts/artifact-library";
import "@/app/[locale]/new/tokens.css";

export const dynamic="force-dynamic";
export default async function ArtifactHistoryPage({params}:{params:Promise<{locale:string;id:string}>}){
  if(!artifactsEnabled())notFound();
  const {locale,id}=await params,session=await auth(),actorId=session?.user?.id;
  if(!actorId)return redirect({href:"/login",locale});
  const access=await accesoAlProyecto(id,actorId);
  if(!access)notFound();
  const [project]=await db.select({title:schema.projects.title}).from(schema.projects).where(eq(schema.projects.id,id)).limit(1);
  if(!project)notFound();
  return <ArtifactLibrary projectId={id} projectName={project.title} readOnly={access.rol==="lector"}/>;
}
