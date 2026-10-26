/** Real Len selection via the existing HTTP session/brain/recorder. Dry by
 * default. Export acceptance is separate: these projects stay durably paused. */
import { randomUUID,createHash } from "node:crypto";
import { mkdir,writeFile } from "node:fs/promises";
import { resolve,join } from "node:path";
import { ARTIFACT_SELECTION_CASES } from "../lib/len-bench/casos/artifacts";
import { gradeArtifactSelection,type SelectionArtifact } from "../lib/len-bench/artifact-selection";
import { BASE_LEN_BENCH,DIR_CORRIDAS,DIR_GRABACIONES } from "../lib/len-bench/entorno";
import { arrancarCorredor,TIMEOUT_TURNO_MS } from "../lib/len-bench/arranque";
import { createThrowawayProject,deleteThrowawayProject,snapshotAgentMemory,restoreAgentMemory } from "../lib/len-bench/proyecto-de-eval";
import { enviarTurno,herramientasDeLen,textoDeLen } from "../lib/len-bench/sesion";
import { historialParaElAgente } from "../lib/chat/historial-del-agente";
import { filaComoLaDeUnDueno } from "../lib/len-bench/fila-del-dueno";
import { esperarUsdDeProyecto,USD_POR_TURNO_ESTIMADO,MARGEN_NO_GRABADO,estimadoExcedeTope,centimosDelEstimado } from "../lib/len-bench/coste";
import { esqueletoDeApp } from "../lib/apps/esqueleto";
import { createArtifactDatabase } from "../lib/artifacts/database";
import type { DatosDelCaso } from "../lib/len-bench/tipos";
const arg=(name:string)=>process.argv.find(a=>a.startsWith(`${name}=`))?.slice(name.length+1);
function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
async function main():Promise<number>{
  const only=arg("--solo"),surface=arg("--surface")??"both",base=arg("--base")??BASE_LEN_BENCH;
  if(base!==BASE_LEN_BENCH)throw new Error(`Use the existing Len-Bench server at ${BASE_LEN_BENCH}`);
  if(!["app","page","both"].includes(surface))throw new Error("--surface=app|page|both");
  const cases=ARTIFACT_SELECTION_CASES.filter(c=>!c.correction&&(!only||c.id===only));
  if(!cases.length)throw new Error("No selection cases matched. Existing-piece correction belongs to completed-output continuity acceptance.");
  const surfaces=surface==="both"?["app","page"]:[surface];
  const estimate=cases.length*surfaces.length*USD_POR_TURNO_ESTIMADO*MARGEN_NO_GRABADO;
  const budget=Number(arg("--budget-usd")??"0.30");
  if(!Number.isFinite(budget)||budget<=0)throw new Error("Invalid --budget-usd");
  console.log(JSON.stringify({suite:"Len-Bench artifact selection",cases:cases.map(c=>c.id),surfaces,estimatedUsd:centimosDelEstimado(estimate)/100,budgetUsd:budget,formatsVerified:false,correction:"deferred to completed-output acceptance",workers:"projects durably paused; exports not executed"}));
  if(estimadoExcedeTope(estimate,budget))throw new Error("Estimate exceeds declared budget");
  if(!process.argv.includes("--yes")){console.log("Dry plan only: no database, model, provider or browser calls. Paid execution requires --yes and an explicit --budget-usd.");return 0;}
  if(arg("--budget-usd")===undefined)throw new Error("Declare the approved --budget-usd before paid execution");
  const {owner,cookie}=await arrancarCorredor(base);
  const database=createArtifactDatabase(process.env.DATABASE_URL!);
  const dir=resolve(arg("--output")??DIR_CORRIDAS);await mkdir(dir,{recursive:true});
  const rows:Record<string,unknown>[]=[];let spent=0,skipped=0;
  const timestamp=new Date().toISOString().replace(/[:.]/g,"-");
  async function contentHash(projectId:string){
    const [row]=await database.query(`select "data" from "projects" where "id"=$1`,[projectId]);
    const data=row?.data as Record<string,unknown>|undefined;
    const files=await database.query(`select "path","content" from "projectFiles" where "projectId"=$1 order by "path"`,[projectId]);
    return createHash("sha256").update(JSON.stringify(canonical({html:data?.html,pages:data?.pages,app:data?.app,settings:data?.settings,files}))).digest("hex");
  }
  try{
    for(const kind of surfaces)for(const test of cases){
      if(spent*MARGEN_NO_GRABADO>=budget){skipped++;rows.push({id:test.id,surface:kind,skipped:"declared budget reached"});continue;}
      const memory=await snapshotAgentMemory(owner.id);
      let projectId:string|null=null,sent=false;
      let observation:Record<string,unknown>={id:test.id,surface:kind,selectionPassed:false,formatsVerified:false};
      let cost:{usd:number;aviso?:string}={usd:0},costUnknown=false;
      try{
        const app=esqueletoDeApp({titulo:"Mi negocio",idioma:"es"});
        const initial:DatosDelCaso=kind==="app"?{html:app.html,app:app.app,ficheros:app.ficheros}:{html:'<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Mi negocio</title></head><body><h1>Mi negocio</h1><p>Un catálogo de productos y solicitudes de contacto.</p></body></html>'};
        projectId=await createThrowawayProject(owner.id,`artifact-selection-${test.id}`,initial,filaComoLaDeUnDueno(initial));
        // This row survives a killed runner. No renderer can admit these jobs,
        // even if a separate worker is started before cleanup completes.
        await database.query(`insert into "artifactProjectControls" ("projectId","paused") values ($1,true)`,[projectId]);
        const response=await fetch(`${base}/api/projects/${projectId}/artifacts`,{headers:{cookie}});
        const capabilities=await response.json().catch(()=>null) as {kinds?:string[]}|null;
        if(!response.ok||!["dashboard","slides","image","motion"].every(k=>capabilities?.kinds?.includes(k)))throw new Error("Len-Bench server does not advertise all four installed artifact kinds; finish renderer/configuration acceptance first");
        const before=await contentHash(projectId);
        const {history}=historialParaElAgente([],null);
        sent=true;
        const events=await enviarTurno({base,cookie,cuerpo:{projectId,prompt:test.message,turnId:randomUUID(),history,esfuerzo:"auto",zonaHoraria:"America/Chihuahua"},timeoutMs:TIMEOUT_TURNO_MS});
        const saved=await database.query(`select "id","kind","itemKey","status" from "artifacts" where "projectId"=$1 order by "createdAt","id"`,[projectId]) as unknown as SelectionArtifact[];
        observation={...observation,...gradeArtifactSelection(test.creates,[],saved,{assistantResponded:!!textoDeLen(events).trim(),sourceUnchanged:before===await contentHash(projectId),allowSourceChange:test.id==="ordinary-app-edit",error:events.some(e=>e.nombre==="error")}),tools:herramientasDeLen(events),projectId,recordingDirectory:resolve(DIR_GRABACIONES)};
      }catch(error){observation.error=error instanceof Error?error.message:"selection run failed";}
      finally{
        try{
          if(sent&&projectId){cost=await esperarUsdDeProyecto(resolve(DIR_GRABACIONES),projectId);costUnknown=!!cost.aviso;}
        }catch(error){costUnknown=true;cost={usd:0,aviso:error instanceof Error?error.message:"recorded usage unavailable"};}
        finally{try{await restoreAgentMemory(owner.id,memory);}finally{if(projectId)await deleteThrowawayProject(projectId);}}
      }
      if(!costUnknown)spent+=cost.usd;rows.push({...observation,usd:costUnknown?null:cost.usd,...(cost.aviso?{costWarning:cost.aviso}:{})});
      await writeFile(join(dir,`artifacts-selection-${timestamp}.json`),JSON.stringify({suite:"selection only",spentUsd:costUnknown?null:spent,knownSpentUsd:spent,budgetUsd:budget,formatsVerified:false,rows},null,2));
      console.log(JSON.stringify({case:test.id,surface:kind,selectionPassed:observation.selectionPassed,usd:costUnknown?null:cost.usd,error:observation.error}));
      // A broken setup must not spend the rest of the budget measuring it.
      if(!sent&&observation.error)throw new Error(String(observation.error));
      if(costUnknown)throw new Error("Recorder usage was unavailable; stopped before spending on another case. Inspect the saved report.");
    }
    return skipped?2:rows.every(r=>r.selectionPassed)?0:1;
  }finally{await database.close();}
}
main().then(code=>{process.exitCode=code;},error=>{console.error(error instanceof Error?error.message:"Len-Bench artifact setup failed");process.exitCode=2;});
