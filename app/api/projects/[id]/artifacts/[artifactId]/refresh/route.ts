import {runArtifactRoute} from "@/lib/artifacts/routes";
export const runtime="nodejs";
export async function POST(request:Request,ctx:{params:Promise<{id:string;artifactId:string}>}){return runArtifactRoute(request,await ctx.params,"refresh");}
