import { randomUUID } from "node:crypto";
import { requireArtifactAccess } from "./access";
import { ArtifactError, type ArtifactChargePolicy, type ArtifactContext, type ArtifactDatabase, type ArtifactExternalOutcome, type ArtifactKind, type ArtifactSql, type JobClaim, type Settlement } from "./types";

export function artifactChargePolicy(env:Readonly<Record<string,string|undefined>>):ArtifactChargePolicy|null {
  const image=env.OPENLEN_ARTIFACT_IMAGE_CENTICREDITS, render=env.OPENLEN_ARTIFACT_RENDER_CENTICREDITS;
  const valid=(n:string|undefined):n is string=>n!==undefined&&/^(0|[1-9]\d{0,8})$/.test(n)&&Number(n)<=100_000_000;
  return valid(image)&&valid(render)?{imageCenticredits:Number(image),renderCenticredits:Number(render)}:null;
}
function validateReceipt(value:ArtifactExternalOutcome):void {
  if(!["succeeded","rejected","failed","unknown"].includes(value.outcome)||typeof value.model!=="string"||value.model.length>200
    ||(value.requestId!==null&&(typeof value.requestId!=="string"||value.requestId.length>200))
    ||(value.costMicroUsd!==null&&(!Number.isSafeInteger(value.costMicroUsd)||value.costMicroUsd<0))||Buffer.byteLength(JSON.stringify(value))>16*1024)throw new ArtifactError("invalid_external_receipt");
}
export function createArtifactBilling(database:ArtifactDatabase,policy:ArtifactChargePolicy) {
  if(![policy.imageCenticredits,policy.renderCenticredits].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=100_000_000))throw new ArtifactError("charge_policy_unavailable");
  async function startAttempt(claim:JobClaim,ctx:ArtifactContext,kind:ArtifactKind,model:string):Promise<void> {
    if(!model||model.length>200)throw new ArtifactError("invalid_image_model");
    await database.transaction(async tx=>{
      const [job]=await tx.query(`select "id" from "artifactJobs" where "id"=$1 and "fencingToken"=$2 and "workerId"=$3 and "leaseUntil">now() and "status"='running' and not "cancelRequested" and "externalStartedAt" is null for update`,[claim.job.id,claim.fencingToken,claim.workerId]);
      if(!job)throw new ArtifactError("lease_lost");
      await requireArtifactAccess(tx,ctx,claim.job.artifactId,"write");
      const price=kind==="image"?policy.imageCenticredits:policy.renderCenticredits;
      const [payer]=await tx.query(`select "credits" from "users" where "id"=$1 for update`,[ctx.ownerId]);
      if(!payer||Number(payer.credits)<price)throw new ArtifactError("insufficient_credits");
      await tx.query(`insert into "artifactAttempts" ("attemptId","jobId","payerId","actorId","projectId","kind","model","centicredits") values ($1,$2,$3,$4,$5,$6,$7,$8)`,[claim.fencingToken,claim.job.id,ctx.ownerId,ctx.actorId,ctx.projectId,kind,model,price]);
      await tx.query(`update "artifactJobs" set "externalStartedAt"=now() where "id"=$1`,[claim.job.id]);
    });
  }
  async function recordOutcome(claim:JobClaim,receipt:ArtifactExternalOutcome):Promise<void> {
    validateReceipt(receipt);
    await database.transaction(async tx=>{
      const [attempt]=await tx.query(`select * from "artifactAttempts" where "attemptId"=$1 and "jobId"=$2 for update`,[claim.fencingToken,claim.job.id]);
      if(!attempt||attempt.model!==receipt.model)throw new ArtifactError("external_attempt_missing");
      const json=JSON.stringify(receipt);
      const changed=await tx.query(`update "artifactAttempts" set "receipt"=$2::jsonb where "attemptId"=$1 and ("receipt" is null or "receipt"=$2::jsonb) returning "attemptId"`,[claim.fencingToken,json]);
      if(!changed.length)throw new ArtifactError("external_receipt_conflict");
    });
  }
  async function ledger(tx:ArtifactSql,attempt:Record<string,unknown>,charge:boolean):Promise<{ledgerId:string;charged:number}> {
    if(attempt.ledgerId)throw new ArtifactError("external_attempt_already_closed");
    const receipt=attempt.receipt as ArtifactExternalOutcome|null;
    const price=charge?Number(attempt.centicredits):0;
    const [payer]=await tx.query(`select "credits","plan" from "users" where "id"=$1 for update`,[attempt.payerId]);
    if(!payer||Number(payer.credits)<price)throw new ArtifactError("insufficient_credits_at_settlement");
    const balance=Number(payer.credits)-price,id=randomUUID();
    await tx.query(`update "users" set "credits"=$2 where "id"=$1`,[attempt.payerId,balance]);
    const integer=(key:string)=>{const n=receipt?.usage?.[key];return typeof n==="number"&&Number.isSafeInteger(n)&&n>=0&&n<=2147483647?n:null;};
    await tx.query(`insert into "creditLedger" ("id","userId","plan","actorId","projectId","surface","refId","centicredits","listCenticredits","costMicroUsd","provider","model","inputTokens","outputTokens","balanceAfter","outcome") values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'openai',$11,$12,$13,$14,$15)`,[id,attempt.payerId,payer.plan,attempt.actorId,attempt.projectId,attempt.kind==="image"?"artifact_image":"artifact_render",attempt.jobId,price,attempt.centicredits,receipt?.costMicroUsd??null,attempt.model,integer("input_tokens"),integer("output_tokens"),balance,charge?"settle":"error"]);
    await tx.query(`update "artifactAttempts" set "ledgerId"=$2 where "attemptId"=$1`,[attempt.attemptId,id]);
    return {ledgerId:id,charged:price};
  }
  async function settleArtifactAttempt(tx:ArtifactSql,claim:JobClaim):Promise<Settlement> {
    const [attempt]=await tx.query(`select * from "artifactAttempts" where "attemptId"=$1 and "jobId"=$2 for update`,[claim.fencingToken,claim.job.id]);
    if(!attempt||(attempt.receipt as ArtifactExternalOutcome|null)?.outcome!=="succeeded")throw new ArtifactError("external_success_unconfirmed");
    const [prior]=await tx.query(`select * from "artifactSettlements" where "jobId"=$1`,[claim.job.id]);
    if(prior)return prior as unknown as Settlement;
    const movement=await ledger(tx,attempt,true);
    const [saved]=await tx.query(`insert into "artifactSettlements" ("jobId","attemptId","ledgerId","chargedCenticredits") values ($1,$2,$3,$4) returning *`,[claim.job.id,claim.fencingToken,movement.ledgerId,movement.charged]);
    return saved as unknown as Settlement;
  }
  async function recordFailure(claim:JobClaim):Promise<void> {
    await database.transaction(async tx=>{
      const [attempt]=await tx.query(`select * from "artifactAttempts" where "attemptId"=$1 and "jobId"=$2 for update`,[claim.fencingToken,claim.job.id]);
      if(attempt&&!attempt.ledgerId)await ledger(tx,attempt,false);
    });
  }
  return {startAttempt,recordOutcome,settleArtifactAttempt,recordFailure};
}
export type ArtifactBilling=ReturnType<typeof createArtifactBilling>;
