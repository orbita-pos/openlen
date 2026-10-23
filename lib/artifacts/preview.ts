import {createHash,randomBytes} from "node:crypto";
import {requireArtifactAccess} from "./access";
import type {ArtifactStore} from "./store";
import type {ArtifactStorage} from "./private-storage";
import {ArtifactError,type ArtifactContext,type ArtifactDatabase} from "./types";
import {ARTIFACT_CSP,SLIDES_CSP} from "./html-policy";
import {datasetsFromRevision} from "./data";
import {livePreviewScript} from "./live-preview-runtime";
import {deckSlideWidth,withDeckScreenCss} from "./adapters/slides/screen";
import {previewFrame} from "./preview-frame";
import {SLIDE_WIDTH} from "./adapters/slides/deck";
export interface ArtifactPreviewConfig {readonly origin:string;readonly appOrigin:string}
export function previewConfig(env:Readonly<Record<string,string|undefined>>):ArtifactPreviewConfig|null{
  if(!env.OPENLEN_ARTIFACT_PREVIEW_ORIGIN)return null;
  try{
    const preview=new URL(env.OPENLEN_ARTIFACT_PREVIEW_ORIGIN),app=new URL(env.NEXT_PUBLIC_SITE_URL??"");
    const local=(url:URL)=>url.protocol==="http:"&&(["localhost","127.0.0.1","[::1]"].includes(url.hostname)||url.hostname.endsWith(".localhost"));
    if(preview.origin!==env.OPENLEN_ARTIFACT_PREVIEW_ORIGIN||preview.hostname===app.hostname||preview.username||preview.password||preview.search||preview.hash||(!local(preview)&&preview.protocol!=="https:")||(!local(app)&&app.protocol!=="https:"))throw new Error("invalid");
    return {origin:preview.origin,appOrigin:app.origin};
  }catch{throw new ArtifactError("invalid_preview_origin");}
}
const hash=(token:string)=>createHash("sha256").update(token).digest("hex");
const ttlSeconds=300;
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const publicIdPattern=/^[a-f0-9]{24}$/;
const notFound=()=>new Response("Not found",{status:404,headers:{"cache-control":"private, no-store","referrer-policy":"no-referrer","x-content-type-options":"nosniff"}});
function context(ticket:Record<string,unknown>):ArtifactContext{return {actorId:String(ticket.actorId),ownerId:String(ticket.ownerId),projectId:String(ticket.projectId),requestId:"",role:"dueno"};}
/** Only this separate server serves authored HTML. The authenticated app
 * mints single-use grants; no application cookie/token enters the document. */
export function createArtifactPreview(database:ArtifactDatabase,store:ArtifactStore,storage:ArtifactStorage,config:ArtifactPreviewConfig){
  async function mint(ctx:ArtifactContext,artifactId:string,revision:number,outputIndex:number){
    if(!Number.isSafeInteger(revision)||revision<0||!Number.isSafeInteger(outputIndex)||outputIndex<0)throw new ArtifactError("invalid_preview_reference");
    const source=await store.getRevision(ctx,artifactId,revision),output=source.outputs[outputIndex];
    if(!source.sealedAt||source.evidence?.valid!==true||!output||output.format!=="html"||output.mime!=="text/html"||output.bytes>8*1024*1024)throw new ArtifactError("preview_not_found");
    const token=randomBytes(32).toString("base64url"),publicId=randomBytes(12).toString("hex");
    await database.transaction(async tx=>{
      await requireArtifactAccess(tx,ctx,artifactId,"read");
      await tx.query(`select "id" from "users" where "id"=$1 for update`,[ctx.actorId]);
      await tx.query(`delete from "artifactPreviewTickets" where "expiresAt"<=now()`);
      const [count]=await tx.query(`select count(*)::int as n from "artifactPreviewTickets" where "actorId"=$1`,[ctx.actorId]);
      if(Number(count!.n)>=50)throw new ArtifactError("preview_limit");
      await tx.query(`insert into "artifactPreviewTickets" ("hash","publicId","kind","actorId","ownerId","projectId","artifactId","revision","outputIndex","outputHash","expiresAt") values ($1,$2,'grant',$3,$4,$5,$6,$7,$8,$9,now()+interval '5 minutes')`,[hash(token),publicId,ctx.actorId,ctx.ownerId,ctx.projectId,artifactId,revision,outputIndex,output.hash]);
    });
    const artifact=await store.getArtifact(ctx,artifactId);
    const liveDatasetIds=artifact.kind==="dashboard"?datasetsFromRevision(source).filter(d=>d.mode==="live").map(d=>d.id):[];
    let frame;
    if(artifact.kind==="dashboard"){
      try{frame=previewFrame(JSON.parse(source.files["dashboard.json"]??""));}catch{/* Older revisions without a viewport keep their existing preview. */}
    }
    return {frame,url:`${config.origin}/grant/${token}`,expiresInSeconds:ttlSeconds,view:{id:publicId,artifactId,revision,liveDatasetIds}};
  }
  async function handle(request:Request):Promise<Response>{
    try{
      if(request.method!=="GET"||new URL(request.url).origin!==config.origin)return notFound();
      const url=new URL(request.url);
      if(url.search||url.hash)return notFound();
      if(url.pathname.startsWith("/grant/")){
        const token=url.pathname.slice(7);if(!tokenPattern.test(token))return notFound();
        const secret=randomBytes(32).toString("base64url");
        const ticket=await database.transaction(async tx=>{
          const [row]=await tx.query(`delete from "artifactPreviewTickets" where "hash"=$1 and "kind"='grant' and "expiresAt">now() returning *`,[hash(token)]);
          if(!row)throw new ArtifactError("preview_not_found");
          await requireArtifactAccess(tx,context(row),String(row.artifactId),"read");
          await tx.query(`insert into "artifactPreviewTickets" ("hash","publicId","kind","actorId","ownerId","projectId","artifactId","revision","outputIndex","outputHash","expiresAt") values ($1,$2,'session',$3,$4,$5,$6,$7,$8,$9,$10)`,[hash(secret),row.publicId,row.actorId,row.ownerId,row.projectId,row.artifactId,row.revision,row.outputIndex,row.outputHash,row.expiresAt]);
          return row;
        });
        return new Response(null,{status:303,headers:{location:`/view/${ticket.publicId}`,"set-cookie":`__Host-len-preview-${ticket.publicId}=${secret}; Path=/; Max-Age=${ttlSeconds}; Secure; HttpOnly; SameSite=Strict`,"cache-control":"private, no-store","referrer-policy":"no-referrer"}});
      }
      if(!url.pathname.startsWith("/view/"))return notFound();
      const publicId=url.pathname.slice(6);if(!publicIdPattern.test(publicId))return notFound();
      const cookieName=`__Host-len-preview-${publicId}`;
      const cookie=(request.headers.get("cookie")??"").split(";").map(s=>s.trim()).find(s=>s.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
      if(!cookie||!tokenPattern.test(cookie))return notFound();
      const [ticket]=await database.query(`select * from "artifactPreviewTickets" where "hash"=$1 and "publicId"=$2 and "kind"='session' and "expiresAt">now()`,[hash(cookie),publicId]);
      if(!ticket)return notFound();
      const source=await store.getRevision(context(ticket),String(ticket.artifactId),Number(ticket.revision));
      const output=source.outputs[Number(ticket.outputIndex)];
      if(!output||output.hash!==ticket.outputHash||source.evidence?.valid!==true||output.mime!=="text/html"||output.bytes>8*1024*1024)return notFound();
      const bytes=await storage.get(output.key);
      if(bytes.length!==output.bytes||createHash("sha256").update(bytes).digest("hex")!==output.hash)return notFound();
      const artifact=await store.getArtifact(context(ticket),String(ticket.artifactId));
      const liveIds=artifact.kind==="dashboard"?datasetsFromRevision(source).filter(d=>d.mode==="live").map(d=>d.id):[];
      // Add trusted mediation after verifying the original saved bytes. The
      // downloaded export remains an immutable snapshot with no live bridge.
      // A deck saved before its HTML carried the screen rule still fits the viewer's width: the rule is added here,
      // after the saved bytes were verified (adapters/slides/screen.ts). Downloads stay the saved file.
      const text=()=>new TextDecoder("utf-8",{fatal:true}).decode(bytes);
      const html=liveIds.length?`${text()}<script>${livePreviewScript({appOrigin:config.appOrigin,channel:publicId,datasetIds:liveIds})}</script>`
        :artifact.kind==="slides"?withDeckScreenCss(text(),deckSlideWidth(source.files,SLIDE_WIDTH)):new Uint8Array(bytes);
      return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"private, no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","content-security-policy":`sandbox allow-scripts; ${artifact.kind==="slides"?SLIDES_CSP:ARTIFACT_CSP}; frame-ancestors ${config.appOrigin}`,"permissions-policy":"camera=(), microphone=(), geolocation=(), payment=()"}});
    }catch{return notFound();}
  }
  return {mint,handle};
}
export type ArtifactPreview=ReturnType<typeof createArtifactPreview>;
