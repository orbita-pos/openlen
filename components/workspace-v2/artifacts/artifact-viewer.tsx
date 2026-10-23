"use client";

import {useEffect,useId,useRef,useState,type MouseEvent} from "react";
import {useLocale,useTranslations} from "next-intl";
import {Check,ChevronLeft,ChevronRight,Download,FileQuestion,ImageIcon,LayoutDashboard,Loader2,Presentation,RefreshCw,Video,Volume2} from "lucide-react";
import {previewFrame,type ArtifactPreviewFrame} from "@/lib/artifacts/preview-frame";
import {FittedPreview} from "./fitted-preview";
import {ModalShell} from "../modal-shell";
import {artifactLiveRefreshClient,connectArtifactLivePreview,type ArtifactLiveView} from "@/lib/artifacts/live-preview";
import {artifactFetch,artifactFileUrl,artifactJson,artifactUrl,ArtifactClientError,inspectArtifact,validatePreviewUrl,type ArtifactFetch,type ArtifactOutputInfo,type ArtifactSummary} from "./client";

interface Props {projectId:string;item:ArtifactSummary;revision:number;onClose:()=>void;onAccessLost:()=>void;fetcher?:ArtifactFetch;
  /** In the workspace center (a project with no page shows its piece there, as Claude opens an artifact): the same
   *  preview and files, in the page instead of a dialog. */
  inline?:boolean}
type Preview={url:string;view:ArtifactLiveView;frame?:ArtifactPreviewFrame};
const kindIcons={dashboard:LayoutDashboard,slides:Presentation,image:ImageIcon,motion:Video,audio:Volume2};
const preferredFormats={dashboard:"html",slides:"pptx",image:"png",motion:"mp4",audio:"mp3"};
function fileSize(bytes:number,locale:string){
  const format=new Intl.NumberFormat(locale,{maximumFractionDigits:1});
  return bytes<1024?`${format.format(bytes)} B`:bytes<1024*1024?`${format.format(bytes/1024)} KB`:`${format.format(bytes/(1024*1024))} MB`;
}
export function ArtifactViewer({projectId,item,revision,onClose,onAccessLost,fetcher=artifactFetch,inline=false}:Props){
  const t=useTranslations("topbar.artifacts"),titleId=useId(),frame=useRef<HTMLIFrameElement>(null);
  const locale=useLocale();
  const callbacks=useRef({onAccessLost});callbacks.current={onAccessLost};
  const [reload,setReload]=useState(0);
  const [downloading,setDownloading]=useState<number|null>(null);
  const transfers=useRef(new Set<AbortController>()),downloads=useRef(new Map<string,ReturnType<typeof setTimeout>>());
  const identity=`${projectId}/${item.id}/${revision}`;
  const [state,setState]=useState<{identity:string;outputs:ArtifactOutputInfo[];preview:Preview|null;imageUrl?:string;loading:boolean;error:boolean}>({identity,outputs:[],preview:null,loading:true,error:false});
  const shown=state.identity===identity?state:{identity,outputs:[],preview:null,imageUrl:undefined,loading:true,error:false};
  useEffect(()=>{
    const controller=new AbortController();let disposed=false,objectUrl:string|undefined;
    setState({identity,outputs:[],preview:null,loading:true,error:false});
    void(async()=>{
      let outputs:ArtifactOutputInfo[]=[];
      try{
        const inspection=await inspectArtifact(fetcher,projectId,item.id,revision,controller.signal);
        if(disposed)return;
        if(inspection.revision.evidence?.valid!==true)throw new ArtifactClientError("unavailable");
        outputs=inspection.revision.outputs;
        const html=outputs.find(o=>o.format==="html"&&o.mime.startsWith("text/html"));
        const hasNativeMedia=outputs.some(o=>["video/mp4","audio/mpeg","audio/wav","audio/mp4","audio/ogg"].includes(o.mime));
        const preferHtml=!!html&&(item.kind==="dashboard"||item.kind==="slides"||!hasNativeMedia&&item.kind!=="image");
        const image=item.kind==="image"||!html&&!hasNativeMedia?outputs.find(o=>["image/png","image/jpeg","image/webp"].includes(o.mime)):undefined;
        if(image){
          if(image.bytes>20*1024*1024)throw new ArtifactClientError("preview_limit");
          const response=await fetcher(artifactFileUrl(projectId,item.id,revision,image.index),{signal:controller.signal,credentials:"same-origin",cache:"no-store"});
          if(!response.ok)throw new ArtifactClientError("unavailable",response.status);
          const blob=await response.blob();
          if(disposed)return;
          if(blob.size!==image.bytes||blob.type!==image.mime)throw new ArtifactClientError("invalid_image");
          objectUrl=URL.createObjectURL(blob);
          setState({identity,outputs,preview:null,imageUrl:objectUrl,loading:false,error:false});return;
        }
        setState({identity,outputs,preview:null,loading:preferHtml,error:false});
        if(!html||!preferHtml)return;
        const grant=await artifactJson(fetcher,`${artifactUrl(projectId,item.id)}/preview`,{method:"POST",signal:controller.signal,headers:{"content-type":"application/json"},body:JSON.stringify({revision,index:html.index})}) as Preview;
        if(disposed)return;
        const url=validatePreviewUrl(grant.url,window.location.origin),view=grant.view;
        if(!view||view.artifactId!==item.id||view.revision!==revision||typeof view.id!=="string"||!Array.isArray(view.liveDatasetIds)||!view.liveDatasetIds.every(id=>typeof id==="string"))throw new ArtifactClientError("invalid_preview");
        setState({identity,outputs,preview:{url,view,frame:item.kind==="dashboard"?previewFrame(grant.frame):undefined},loading:false,error:false});
      }catch(error){
        if(disposed)return;
        const lost=error instanceof ArtifactClientError&&[401,403,404].includes(error.status);
        setState({identity,outputs:lost?[]:outputs,preview:null,loading:false,error:true});
        if(lost)callbacks.current.onAccessLost();
      }
    })();
    return()=>{disposed=true;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[identity,projectId,item.id,item.kind,revision,fetcher,reload]);
  useEffect(()=>{
    if(!shown.preview||!frame.current?.contentWindow)return;
    const bridge=connectArtifactLivePreview({frame:frame.current.contentWindow,view:shown.preview.view,refresh:artifactLiveRefreshClient(projectId,item.id)});
    return()=>bridge.dispose();
  },[shown.preview,projectId,item.id]);
  const image=shown.imageUrl?shown.outputs.find(o=>["image/png","image/jpeg","image/webp"].includes(o.mime)):undefined;
  const video=shown.outputs.find(o=>o.mime==="video/mp4");
  const audio=shown.outputs.find(o=>["audio/mpeg","audio/wav","audio/mp4","audio/ogg"].includes(o.mime));
  const media=image??video??audio;
  const source=media?artifactFileUrl(projectId,item.id,revision,media.index):undefined;
  useEffect(()=>{
    const controllers=transfers.current,urls=downloads.current;
    return()=>{for(const c of controllers)c.abort();for(const [url,timer] of urls){clearTimeout(timer);URL.revokeObjectURL(url);}urls.clear();};
  },[identity]);
  const download=async(event:MouseEvent<HTMLAnchorElement>,output:ArtifactOutputInfo)=>{
    event.preventDefault();if(downloading!==null)return;
    const controller=new AbortController();transfers.current.add(controller);setDownloading(output.index);
    try{
      const response=await fetcher(artifactFileUrl(projectId,item.id,revision,output.index),{credentials:"same-origin",cache:"no-store",signal:controller.signal});
      if(!response.ok)throw new ArtifactClientError("unavailable",response.status);
      const blob=await response.blob();if(controller.signal.aborted)return;
      if(blob.size!==output.bytes)throw new ArtifactClientError("invalid_output");
      const url=URL.createObjectURL(blob),anchor=document.createElement("a");
      anchor.href=url;anchor.download=output.name;anchor.click();
      downloads.current.set(url,setTimeout(()=>{URL.revokeObjectURL(url);downloads.current.delete(url);},60000));
    }catch(error){
      if(controller.signal.aborted)return;
      if(error instanceof ArtifactClientError&&[401,403,404].includes(error.status)){
        setState({identity,outputs:[],preview:null,loading:false,error:true});callbacks.current.onAccessLost();
      }else setState(s=>({...s,error:true}));
    }finally{transfers.current.delete(controller);if(!controller.signal.aborted)setDownloading(null);}
  };
  const KindIcon=kindIcons[item.kind];
  // No live preview (its server unreachable, a grant refused): a deck or a dashboard still has its verified
  // pictures, so they are shown instead of only saying the preview is unavailable.
  const pictures=shown.outputs.filter(o=>o.mime==="image/png").sort((a,b)=>a.name.localeCompare(b.name));
  const pictureFallback=shown.error&&!shown.preview&&!shown.imageUrl&&pictures.length>0&&(item.kind==="slides"||item.kind==="dashboard");
  const hasPreview=!!(shown.preview||shown.imageUrl||pictureFallback||!shown.error&&(video||audio));
  const downloadOnly=!shown.loading&&!shown.error&&!hasPreview&&shown.outputs.length>0;
  const fallbackTitle=downloadOnly?"viewer.downloadOnlyTitle":shown.outputs.length?"viewer.previewTitle":"viewer.unavailableTitle";
  const fallbackBody=downloadOnly?"viewer.downloadOnlyBody":shown.outputs.length?"viewer.previewBody":"viewer.unavailableBody";
  const primaryFormat=shown.outputs.some(o=>o.format===preferredFormats[item.kind])?preferredFormats[item.kind]:shown.outputs[0]?.format;
  const title=<span className="flex items-center gap-3"><span aria-hidden="true" className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bd bg-elev fg-muted"><KindIcon size={19}/></span><span className="break-words leading-snug">{item.title}</span></span>;
  const subtitle=<span className="sm:pl-[52px]">{t(`kind.${item.kind}`)} <span aria-hidden="true" className="px-1">·</span> {t("revision",{number:revision})}</span>;
  const body=<div className={`artifact-scroll nice-scroll overflow-y-auto ${inline?"min-h-0 flex-1":"max-h-[80dvh]"}`}>
      <div className={`flex items-center justify-center relative ${hasPreview?"min-h-52 bg-side":"bg-elev"}`}>
        {shown.loading?<div role="status" className="flex min-h-64 flex-col items-center justify-center gap-4 p-10 text-sm fg-muted"><span className="flex h-14 w-14 items-center justify-center rounded-2xl border bd bg-side"><Loader2 size={23} className="motion-safe:animate-spin"/></span>{t("loading")}</div>
          :shown.preview?.frame?<FittedPreview frame={shown.preview.frame} frameRef={frame} title={t("preview")} url={shown.preview.url}/>
          :shown.preview?<iframe ref={frame} title={t("preview")} src={shown.preview.url} sandbox="allow-scripts" referrerPolicy="no-referrer" className="w-full h-[min(64dvh,680px)] border-0 bg-white"/>
          // Blob URLs are authorized private bytes, not Next image optimizer inputs.
          // eslint-disable-next-line @next/next/no-img-element
          :image&&shown.imageUrl?<img src={shown.imageUrl} alt={item.title} className="block max-h-[64dvh] w-auto max-w-full object-contain p-3 sm:p-5"/>
          :video&&!shown.error?<video key={source} src={source} controls preload="metadata" onError={()=>setState(s=>({...s,error:true}))} className="max-h-[64dvh] w-full"/>
          :pictureFallback?<PictureFallback key={identity} projectId={projectId} itemId={item.id} title={item.title} revision={revision} pictures={pictures} fetcher={fetcher}/>
          :audio&&!shown.error?<div className="w-full max-w-xl p-8 sm:py-12"><div aria-hidden="true" className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border bd bg-elev fg-muted"><Volume2 size={26}/></div><audio key={source} src={source} controls preload="metadata" onError={()=>setState(s=>({...s,error:true}))} className="w-full"/></div>
          :<div role="status" className="flex w-full flex-col items-center px-6 py-10 sm:px-12 sm:py-12 text-center">
            <div aria-hidden="true" className="relative mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border bd bg-side fg-muted">
              <KindIcon size={28} strokeWidth={1.5}/>
              <span className={`absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border bd bg-elev ${downloadOnly?"text-emerald-600 dark:text-emerald-400":"fg-faint"}`}>{downloadOnly?<Check size={13} strokeWidth={2.5}/>:<FileQuestion size={13}/>}</span>
            </div>
            <h3 className="max-w-md text-xl font-semibold tracking-tight fg leading-snug">{t(fallbackTitle)}</h3>
            <p className="max-w-sm mt-3 text-[13px] fg-muted leading-relaxed">{t(fallbackBody)}</p>
            {!downloadOnly&&<button type="button" onClick={()=>setReload(r=>r+1)} className="mt-6 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border bd-strong bg-elev px-4 text-xs font-medium fg shadow-sm hover:bg-hover transition"><RefreshCw size={14}/>{t("viewer.reload")}</button>}
          </div>}
      </div>
      {shown.outputs.length>0&&<section aria-labelledby={`${titleId}-files`} className="border-t bd bg-side px-4 py-4 sm:px-6 sm:py-5">
        <div className="mb-3 flex items-center justify-between gap-3"><h3 id={`${titleId}-files`} className="text-xs font-medium fg-muted">{t("viewer.files")} <span className="ml-1.5 fg-faint">{shown.outputs.length}</span></h3>
          {shown.preview&&<button type="button" onClick={()=>setReload(r=>r+1)} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] fg-muted hover:bg-hover"><RefreshCw size={12}/>{t("reloadPreview")}</button>}
        </div>
        <ul className="rounded-xl border bd bg-elev overflow-hidden">{shown.outputs.map(output=><li key={output.index} className="flex items-center gap-3 border-b last:border-b-0 bd p-3">
          <span aria-hidden="true" className="flex h-10 w-12 shrink-0 items-center justify-center rounded-lg border bd bg-side text-[10px] font-semibold fg-muted">{output.format.toUpperCase()}</span>
          <div className="min-w-0 flex-1"><p className="text-xs font-medium fg break-all leading-snug">{output.name}</p><p className="mt-1 text-[11px] fg-faint">{fileSize(output.bytes,locale)}</p></div>
          <a download={output.name} aria-label={`${t("download")} ${output.name}`} aria-disabled={downloading!==null} onClick={event=>void download(event,output)} href={artifactFileUrl(projectId,item.id,revision,output.index)} className={`inline-flex h-9 w-9 sm:w-auto shrink-0 items-center justify-center gap-2 rounded-lg sm:px-3 text-xs font-medium transition aria-disabled:opacity-50 ${output.format===primaryFormat?"bg-[var(--accent-strong)] text-white hover:brightness-110":"border bd fg-muted hover:bg-hover"}`}>
            {downloading===output.index?<Loader2 size={14} className="motion-safe:animate-spin"/>:<Download size={14}/>}<span className="hidden sm:inline">{t("download")}</span>
          </a>
        </li>)}</ul>
      </section>}
    </div>;
  if(inline)return <section aria-labelledby={titleId} className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bd bg-elev">
    <header className="shrink-0 border-b bd px-5 py-4"><h2 id={titleId} className="text-[15px] font-semibold fg">{title}</h2><p className="mt-1 text-xs fg-faint">{subtitle}</p></header>
    {body}
  </section>;
  return <ModalShell open onClose={onClose} titleId={titleId} title={title} subtitle={subtitle} size={hasPreview||shown.loading?"page":"xl"} closeLabel={t("close")}>{body}</ModalShell>;
}

/** A deck's or a dashboard's verified pictures, one at a time, read as private bytes like any output. */
function PictureFallback({projectId,itemId,title,revision,pictures,fetcher}:{projectId:string;itemId:string;title:string;revision:number;pictures:ArtifactOutputInfo[];fetcher:ArtifactFetch}){
  const t=useTranslations("topbar.artifacts");
  const [index,setIndex]=useState(0),[url,setUrl]=useState<string|null>(null);
  const current=pictures[Math.min(index,pictures.length-1)]!;
  useEffect(()=>{
    const controller=new AbortController();let disposed=false,objectUrl:string|undefined;
    setUrl(null);
    void(async()=>{
      try{
        const response=await fetcher(artifactFileUrl(projectId,itemId,revision,current.index),{signal:controller.signal,credentials:"same-origin",cache:"no-store"});
        if(!response.ok)return;
        const blob=await response.blob();
        if(disposed||blob.size!==current.bytes||blob.type!==current.mime)return;
        objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);
      }catch{/* the files list below still offers the download */}
    })();
    return()=>{disposed=true;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[projectId,itemId,revision,current.index,current.bytes,current.mime,fetcher]);
  return <div className="flex w-full flex-col items-center gap-3 p-3 sm:p-5">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {url?<img src={url} alt={`${title} · ${index+1}`} className="block max-h-[60dvh] w-auto max-w-full rounded-lg border bd object-contain"/>
      :<div role="status" className="flex h-64 items-center justify-center fg-muted"><Loader2 size={22} className="motion-safe:animate-spin"/></div>}
    {pictures.length>1&&<div className="flex items-center gap-3 text-xs fg-muted">
      <button type="button" aria-label={t("viewer.previous")} disabled={index===0} onClick={()=>setIndex(i=>Math.max(0,i-1))} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border bd hover:bg-hover disabled:opacity-40"><ChevronLeft size={15}/></button>
      <span className="tabular-nums">{index+1} / {pictures.length}</span>
      <button type="button" aria-label={t("viewer.next")} disabled={index===pictures.length-1} onClick={()=>setIndex(i=>Math.min(pictures.length-1,i+1))} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border bd hover:bg-hover disabled:opacity-40"><ChevronRight size={15}/></button>
    </div>}
  </div>;
}
