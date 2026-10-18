import {ArtifactError,type ArtifactDatabase} from "./types";
function number(value:unknown):number{
  const result=Number(value);
  if(value===null||!Number.isFinite(result)||result<0||result>Number.MAX_SAFE_INTEGER)throw new ArtifactError("invalid_operations_result");
  return result;
}
/** Operator-only aggregates. No project, actor, prompt, SQL, storage key or
 * fencing token is returned. Latency includes queue time; it is not a claim
 * about renderer CPU time or container peak memory. */
export async function readArtifactOperations(database:ArtifactDatabase){
  return database.transaction(async tx=>{
    await tx.query(`set transaction isolation level repeatable read read only`);
    const jobs=await tx.query(`select a."kind",j."status",count(*) as n from "artifactJobs" j join "artifacts" a on a."id"=j."artifactId" group by a."kind",j."status" order by a."kind",j."status"`);
    const [queue]=await tx.query(`select case when min("createdAt") is null then null else greatest(0,extract(epoch from now()-min("createdAt"))) end as wait from "artifactJobs" where "status"='queued'`);
    const latency=await tx.query(`select a."kind",count(*) as n,percentile_cont(0.5) within group (order by greatest(0,extract(epoch from j."updatedAt"-j."createdAt"))) as p50,percentile_cont(0.95) within group (order by greatest(0,extract(epoch from j."updatedAt"-j."createdAt"))) as p95 from "artifactJobs" j join "artifacts" a on a."id"=j."artifactId" where j."status" in ('completed','failed','cancelled','needs_attention') and j."updatedAt">=now()-interval '24 hours' group by a."kind" order by a."kind"`);
    const failures=await tx.query(`select a."kind",j."errorCode" as code,count(*) as n from "artifactJobs" j join "artifacts" a on a."id"=j."artifactId" where j."status" in ('failed','needs_attention') and j."updatedAt">=now()-interval '24 hours' group by a."kind",j."errorCode" order by a."kind",j."errorCode" limit 128`);
    const [cost]=await tx.query(`select count(*) as n,coalesce(sum(("receipt"->>'costMicroUsd')::bigint),0) as known,count(*) filter (where "receipt"->>'costMicroUsd' is null) as unknown from "artifactAttempts" where "createdAt">=now()-interval '24 hours'`);
    const [settled]=await tx.query(`select coalesce(sum("chargedCenticredits"),0) as charged from "artifactSettlements" where "createdAt">=now()-interval '24 hours'`);
    return {
      windowHours:24,
      jobs:jobs.map(row=>({kind:String(row.kind),status:String(row.status),count:number(row.n)})),
      queue:{oldestWaitSeconds:queue?.wait===null?null:number(queue?.wait)},
      latency:latency.map(row=>({kind:String(row.kind),samples:number(row.n),endToEndSeconds:{p50:number(row.p50),p95:number(row.p95)}})),
      failures:failures.map(row=>({kind:String(row.kind),code:row.code===null?null:String(row.code),count:number(row.n)})),
      externalCost:{attempts:number(cost?.n),knownMicroUsd:number(cost?.known),unknown:number(cost?.unknown)},
      chargedCenticredits:number(settled?.charged),
    };
  });
}
