import {createCipheriv,createDecipheriv,createHash,randomBytes} from "node:crypto";
import {ArtifactError,type ArtifactContext,type ArtifactDatabase,type Artifact} from "./types";
import type {ArtifactStore} from "./store";

const kinds=["dashboard","slides","image","motion","audio"];
const states:Record<string,readonly string[]>={ready:["ready"],active:["queued","running","validating","storing"],failed:["failed","needs_attention"],draft:["draft"],cancelled:["cancelled"]};
type Position={at:string;id:string};
type Filters={q:string;kind:string;status:string;until:string};
function parseFilters(url:URL):Filters{
  const q=(url.searchParams.get("q")??"").trim(),kind=url.searchParams.get("kind")??"",status=url.searchParams.get("status")??"",until=url.searchParams.get("until")??"";
  if(q.length>160||kind&&!kinds.includes(kind)||status&&!Object.hasOwn(states,status)||until&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(until)||!Number.isFinite(Date.parse(until))||new Date(until).toISOString()!==until))throw new ArtifactError("invalid_history_filter");
  return {q,kind,status,until};
}
/** Cursor payloads may cross hidden rows. Encrypt them rather than exposing
 * private artifact identities in an otherwise decodable continuation token. */
function cursorCodec(ctx:ArtifactContext,filters:Filters){
  const secret=process.env.AUTH_SECRET??process.env.NEXTAUTH_SECRET;
  if(!secret)throw new ArtifactError("history_unavailable");
  const key=createHash("sha256").update("openlen-artifact-history-v1\0"+secret).digest();
  const aad=Buffer.from(JSON.stringify([ctx.projectId,ctx.actorId,ctx.ownerId,filters]));
  return {
    encode(position:Position){
      const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);cipher.setAAD(aad);
      const encrypted=Buffer.concat([cipher.update(JSON.stringify(position),"utf8"),cipher.final()]);
      return "v1_"+Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString("base64url");
    },
    decode(token:string):Position{
      try{
        if(token.length>1024||!/^v1_[A-Za-z0-9_-]+$/.test(token))throw Error();
        const raw=Buffer.from(token.slice(3),"base64url");if(raw.length<30||raw.toString("base64url")!==token.slice(3))throw Error();
        const cipher=createDecipheriv("aes-256-gcm",key,raw.subarray(0,12));cipher.setAAD(aad);cipher.setAuthTag(raw.subarray(12,28));
        const value=JSON.parse(Buffer.concat([cipher.update(raw.subarray(28)),cipher.final()]).toString("utf8"));
        if(!value||Object.keys(value).length!==2||typeof value.id!=="string"||!value.id||value.id.length>200||typeof value.at!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.at)||!Number.isFinite(Date.parse(value.at)))throw Error();
        return value;
      }catch{throw new ArtifactError("invalid_history_cursor");}
    }
  };
}

export async function listArtifactHistory(services:{database:ArtifactDatabase;store:ArtifactStore},ctx:ArtifactContext,url:URL):Promise<{artifacts:Artifact[];nextCursor:string|null}>{
  const filters=parseFilters(url),rawLimit=url.searchParams.get("limit")??"24";
  if(!/^\d{1,2}$/.test(rawLimit)||Number(rawLimit)<1||Number(rawLimit)>50)throw new ArtifactError("invalid_history_limit");
  const limit=Number(rawLimit),codec=cursorCodec(ctx,filters),before=url.searchParams.get("before");
  let position=before?codec.decode(before):null,scanned=0;
  const artifacts:Artifact[]=[];
  while(scanned<400){
    const params:unknown[]=[ctx.projectId,ctx.actorId,ctx.ownerId];
    const bind=(v:unknown)=>{params.push(v);return "$"+params.length;};
    const where=[`"projectId"=$1`,`("visibility"='project' or $2=$3)`];
    if(filters.q)where.push(`position(lower(${bind(filters.q)}::text) in lower("title"))>0`);
    if(filters.kind)where.push(`"kind"=${bind(filters.kind)}`);
    if(filters.status)where.push(`"status"=any(${bind(states[filters.status])}::text[])`);
    if(filters.until)where.push(`"createdAt"<${bind(filters.until)}::timestamptz`);
    if(position)where.push(`("createdAt","id")<(${bind(position.at)}::timestamptz,${bind(position.id)}::text)`);
    const take=Math.min(64,400-scanned);
    const rows=await services.database.query(`select "id",to_char("createdAt" at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorAt" from "artifacts" where ${where.join(" and ")} order by "createdAt" desc,"id" desc limit ${bind(take)}`,params);
    for(let index=0;index<rows.length;index++){
      const row=rows[index]!;position={id:String(row.id),at:String(row.cursorAt)};scanned++;
      try{artifacts.push(await services.store.getArtifact(ctx,position.id));}
      catch(error){if(!(error instanceof ArtifactError))throw error;}
      if(artifacts.length===limit)return {artifacts,nextCursor:index<rows.length-1||rows.length===take?codec.encode(position):null};
    }
    if(rows.length<take)return {artifacts,nextCursor:null};
  }
  return {artifacts,nextCursor:position?codec.encode(position):null};
}
