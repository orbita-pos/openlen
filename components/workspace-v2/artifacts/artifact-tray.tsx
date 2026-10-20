"use client";

import {useEffect,useId,useRef,useState} from "react";
import {useTranslations} from "next-intl";
import {Bell,Check,ChevronRight,ImageIcon,LayoutDashboard,Loader2,Presentation,Video,Volume2,X} from "lucide-react";
import {activeStatus,artifactFetch,type ArtifactFetch,type ArtifactSummary} from "./client";
import {useArtifacts} from "./use-artifacts";
import {ArtifactViewer} from "./artifact-viewer";
import {Link} from "@/i18n/navigation";

const icons={dashboard:LayoutDashboard,slides:Presentation,image:ImageIcon,motion:Video,audio:Volume2};
interface Props {projectId:string;readOnly?:boolean;fetcher?:ArtifactFetch;historyHref?:string}
// The key fences the entire panel/viewer when the workspace changes projects.
export function ArtifactTray(props:Props){return <ProjectArtifactTray key={props.projectId} {...props}/>;}
function ProjectArtifactTray({projectId,readOnly=false,fetcher=artifactFetch,historyHref}:Props){
  const t=useTranslations("topbar.artifacts"),id=useId(),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const data=useArtifacts(projectId,fetcher);
  const {acknowledge,unread,disconnected}=data;
  const [open,setOpen]=useState(false),[selected,setSelected]=useState<{item:ArtifactSummary;revision:number}|null>(null);
  useEffect(()=>{if(open&&unread.length&&!disconnected)void acknowledge();},[open,unread,disconnected,acknowledge]);
  useEffect(()=>{
    if(!open||selected)return;
    const close=()=>{setOpen(false);trigger.current?.focus();};
    const key=(e:KeyboardEvent)=>{if(e.key==="Escape"){e.preventDefault();close();}};
    const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
    document.addEventListener("keydown",key);document.addEventListener("pointerdown",outside);
    return()=>{document.removeEventListener("keydown",key);document.removeEventListener("pointerdown",outside);};
  },[open,selected]);
  useEffect(()=>{if(data.enabled===false){setOpen(false);setSelected(null);}else if(selected&&!data.items.some(a=>a.id===selected.item.id))setSelected(null);},[data.enabled,data.items,selected]);
  if(data.enabled===false||data.enabled===null&&!data.disconnected)return null;
  const active=data.items.some(a=>activeStatus(a.status));
  const hasReadyUnread=data.items.some(a=>data.unread.includes(a.id)&&a.status==="ready");
  const groups=new Map<string,ArtifactSummary[]>();
  for(const item of [...data.items].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id))){const group=groups.get(item.requestId)??[];group.push(item);groups.set(item.requestId,group);}
  for(const group of groups.values())group.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  return <div ref={root} className="relative">
    <button ref={trigger} type="button" aria-label={t("title")} title={t("title")} aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(v=>!v)} className={`relative flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-hover ${open?"bg-hover fg":"fg-muted"}`}>
      <Bell size={17}/>
      {(hasReadyUnread||active)&&<span aria-hidden="true" className={`absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-[var(--bg-elev)] ${hasReadyUnread?"bg-emerald-500":"bg-[var(--accent)] motion-safe:animate-pulse"}`}/>}
      <span role="status" className="sr-only">{t("ready",{ready:data.items.filter(a=>a.status==="ready").length,total:data.items.length})}</span>
    </button>
    {open&&<section id={id} aria-label={t("title")} className="fixed top-14 right-3 z-40 flex flex-col max-h-[calc(100dvh-68px)] w-[min(410px,calc(100vw-24px))] rounded-2xl border bd-strong bg-elev shadow-[0_20px_60px_-16px_rgba(0,0,0,.3)] overflow-hidden">
      <header className="shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b bd">
        <div><h2 className="text-[15px] font-semibold fg">{t("title")}</h2><p className="text-xs fg-faint mt-1">{t("subtitle")}</p></div>
        <button type="button" aria-label={t("close")} onClick={()=>{setOpen(false);trigger.current?.focus();}} className="p-1.5 rounded-md fg-faint hover:bg-hover"><X size={16}/></button>
      </header>
      <div className="artifact-scroll nice-scroll min-h-0 max-h-[min(64dvh,620px)] overflow-y-auto overscroll-contain">
        {data.disconnected&&<div role="status" className="px-5 py-3 border-b bd text-xs fg-muted leading-relaxed">{t("disconnected")} <button type="button" onClick={()=>void data.refresh()} className="underline underline-offset-2">{t("reconnect")}</button></div>}
        {data.actionError&&<p role="alert" className="px-5 py-3 text-xs text-red-600 dark:text-red-400">{t("actionError")}</p>}
        {!data.items.length?<div className="px-7 py-10 text-center"><Bell size={24} className="mx-auto fg-faint mb-4"/><p className="text-sm font-medium fg">{t("empty")}</p><p className="text-xs fg-muted leading-relaxed mt-2">{t("hint")}</p></div>
          :[...groups].map(([requestId,items],index)=><section key={requestId} className="border-b last:border-b-0 bd">
            <div className="px-5 pt-4 pb-1 flex items-center justify-between gap-2 text-[11px] fg-faint"><h3>{t("request",{number:groups.size-index})}</h3><span>{t("ready",{ready:items.filter(a=>a.status==="ready").length,total:items.length})}</span></div>
            <ul className="px-2 pb-2">{items.map(item=>{
              const Icon=icons[item.kind],working=activeStatus(item.status),failed=["failed","needs_attention"].includes(item.status),previous=item.lastReadyRevision!==null&&item.lastReadyRevision!==item.currentRevision;
              return <li key={item.id} data-artifact={item.id} className="flex gap-3 px-3 py-3 rounded-xl hover:bg-hover transition">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bd fg-muted"><Icon size={17}/></div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] fg font-medium leading-snug break-words">{item.title}</p>
                  <p className="text-[11px] fg-faint mt-1">{t(`kind.${item.kind}`)}</p>
                  <div className={`flex items-center gap-1.5 text-[11px] mt-2 ${item.status==="ready"?"text-emerald-700 dark:text-emerald-400":failed?"text-amber-700 dark:text-amber-400":"fg-muted"}`}>
                    {working?<Loader2 size={11} className="motion-safe:animate-spin"/>:item.status==="ready"?<Check size={12}/>:null}<span>{t(`status.${item.status}`)}</span>
                  </div>
                  {failed&&<p className="text-[11px] fg-faint mt-1 leading-relaxed">{t("failedHint")}</p>}
                  {(item.lastReadyRevision!==null||working&&!readOnly)&&<div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2">
                    {item.lastReadyRevision!==null&&<button type="button" data-artifact-open onClick={()=>setSelected({item,revision:item.lastReadyRevision!})} className="inline-flex min-h-7 items-center gap-1 text-[11px] font-medium fg hover:underline underline-offset-2">{t(previous?"previous":"open")}<ChevronRight size={12}/></button>}
                    {working&&!readOnly&&<button type="button" data-artifact-cancel disabled={data.cancelling.includes(item.id)} onClick={()=>void data.cancel(item)} className="min-h-7 text-[11px] fg-faint hover:fg disabled:opacity-50">{t(data.cancelling.includes(item.id)?"cancelling":"cancel")}</button>}
                  </div>}
                </div>
              </li>;
            })}</ul>
          </section>)}
      </div>
      <footer className="shrink-0 border-t bd bg-side">
        <Link href={historyHref??`/projects/${encodeURIComponent(projectId)}/artifacts`} className="flex min-h-11 items-center justify-between gap-3 px-5 py-3 text-xs font-medium fg hover:bg-hover">{t("library.viewAll")}<ChevronRight size={14}/></Link>
        <p className="border-t bd px-5 py-3 text-[11px] fg-faint leading-relaxed">{t(readOnly?"readOnly":"hint")}</p>
      </footer>
    </section>}
    {selected&&<ArtifactViewer key={`${selected.item.id}/${selected.revision}`} projectId={projectId} item={selected.item} revision={selected.revision} fetcher={fetcher} onClose={()=>setSelected(null)} onAccessLost={()=>{setSelected(null);void data.refresh();}}/>}
  </div>;
}
