"use client";

import {useEffect,useMemo,useState} from "react";
import {useLocale,useTranslations} from "next-intl";
import {ArrowLeft,ArrowUpRight,ChevronDown,FileSearch,ImageIcon,LayoutDashboard,Loader2,LockKeyhole,Presentation,RefreshCw,Search,Video,Volume2,X} from "lucide-react";
import {Link} from "@/i18n/navigation";
import {activeStatus,artifactFetch,ArtifactClientError,inspectArtifact,type ArtifactFetch,type ArtifactSummary} from "./client";
import {historyUntil} from "./history-client";
import {useArtifactHistory} from "./use-artifact-history";
import {ArtifactViewer} from "./artifact-viewer";

const icons={dashboard:LayoutDashboard,slides:Presentation,image:ImageIcon,motion:Video,audio:Volume2};
interface Props {projectId:string;projectName:string;readOnly?:boolean;fetcher?:ArtifactFetch;backHref?:string}
export function ArtifactLibrary(props:Props){return <ProjectLibrary key={props.projectId} {...props}/>;}
function ProjectLibrary({projectId,projectName,readOnly=false,fetcher=artifactFetch,backHref}:Props){
  const t=useTranslations("topbar.artifacts"),locale=useLocale();
  const [draft,setDraft]=useState(""),[query,setQuery]=useState(""),[kind,setKind]=useState(""),[status,setStatus]=useState(""),[day,setDay]=useState("");
  const [selected,setSelected]=useState<{item:ArtifactSummary;revision:number}|null>(null);
  useEffect(()=>{const timer=setTimeout(()=>setQuery(draft.trim()),250);return()=>clearTimeout(timer);},[draft]);
  const filters=useMemo(()=>({q:query,kind,status,until:historyUntil(day)}),[query,kind,status,day]);
  const data=useArtifactHistory(projectId,filters,fetcher);
  useEffect(()=>{if(data.unavailable)setSelected(null);},[data.unavailable]);
  const remove=data.remove;
  useEffect(()=>{
    if(!selected)return;
    const controller=new AbortController();let disposed=false,busy=false;
    const check=async()=>{
      if(busy||disposed)return;busy=true;
      try{await inspectArtifact(fetcher,projectId,selected.item.id,selected.revision,controller.signal);}
      catch(error){if(!disposed&&error instanceof ArtifactClientError&&[401,403,404].includes(error.status)){remove(selected.item.id);setSelected(null);}}
      finally{busy=false;}
    };
    const focus=()=>{void check();};
    const timer=setInterval(focus,30000);window.addEventListener("focus",focus);
    return()=>{disposed=true;controller.abort();clearInterval(timer);window.removeEventListener("focus",focus);};
  },[selected,fetcher,projectId,remove]);
  const back=backHref??`/new?project=${encodeURIComponent(projectId)}`;
  const filtered=!!(draft||kind||status||day);
  const clear=()=>{setDraft("");setQuery("");setKind("");setStatus("");setDay("");};
  const dateFormat=new Intl.DateTimeFormat(locale,{day:"numeric",month:"short",year:"numeric"});
  const monthFormat=new Intl.DateTimeFormat(locale,{month:"long",year:"numeric"});
  const groups=new Map<string,ArtifactSummary[]>();
  for(const item of data.items){const month=monthFormat.format(new Date(item.createdAt));const group=groups.get(month)??[];group.push(item);groups.set(month,group);}
  const badge=(item:ArtifactSummary)=><span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] leading-tight ${item.status==="ready"?"border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400":["failed","needs_attention"].includes(item.status)?"border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-400":"bd fg-muted"}`}>
    {activeStatus(item.status)&&<Loader2 size={10} className="motion-safe:animate-spin"/>}{t(`status.${item.status}`)}
  </span>;
  return <div className="workspace-v2 flex h-dvh min-h-0 flex-col">
    <header className="shrink-0 border-b bd bg-elev">
      <nav className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8" aria-label={t("library.back")}>
        <Link href={back} className="inline-flex min-w-0 items-center gap-3 text-xs fg-muted hover:fg"><ArrowLeft size={16}/><span className="truncate font-medium">{projectName}</span></Link>
        {readOnly&&<span className="inline-flex items-center gap-1.5 text-[11px] fg-faint"><LockKeyhole size={12}/><span className="hidden sm:inline">{t("readOnly")}</span></span>}
      </nav>
    </header>
    <main className="artifact-scroll nice-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
        <div className="flex items-start justify-between gap-4">
          <div><h1 className="text-[30px] font-semibold tracking-tight leading-tight fg">{t("title")}</h1><p className="mt-2 max-w-xl text-[13px] fg-muted leading-relaxed">{t("library.subtitle",{project:projectName})}</p></div>
          <button type="button" onClick={()=>void data.refresh()} disabled={data.loading||data.loadingMore||data.unavailable} title={t("library.refresh")} aria-label={t("library.refresh")} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bd bg-elev fg-muted hover:bg-hover disabled:opacity-40"><RefreshCw size={15} className={data.loading?"motion-safe:animate-spin":""}/></button>
        </div>
        {!data.unavailable&&<>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <form onSubmit={e=>{e.preventDefault();setQuery(draft.trim());}} className="relative flex-1">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-3 fg-faint"/>
              <input type="search" value={draft} maxLength={160} onChange={e=>setDraft(e.target.value)} aria-label={t("library.searchLabel")} placeholder={t("library.search")} className="h-10 w-full rounded-lg border bd bg-elev pl-10 pr-3 text-[13px] fg outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10"/>
            </form>
            <div className="flex gap-3">
              <div className="relative min-w-0 flex-1 sm:w-44">
                <select aria-label={t("library.status")} value={status} onChange={e=>setStatus(e.target.value)} className="h-10 w-full appearance-none rounded-lg border bd bg-elev pl-3 pr-8 text-xs fg outline-none focus:border-[var(--accent)]">
                  <option value="">{t("library.allStates")}</option><option value="ready">{t("status.ready")}</option><option value="active">{t("library.active")}</option><option value="failed">{t("library.attention")}</option><option value="draft">{t("status.draft")}</option><option value="cancelled">{t("status.cancelled")}</option>
                </select><ChevronDown size={13} className="pointer-events-none absolute right-3 top-3.5 fg-faint"/>
              </div>
              <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border bd bg-elev px-3 text-[11px] fg-faint sm:flex-none"><span className="hidden lg:inline">{t("library.until")}</span><input type="date" aria-label={t("library.until")} value={day} onChange={e=>setDay(e.target.value)} className="min-w-0 w-full bg-transparent text-xs fg outline-none [color-scheme:light] dark:[color-scheme:dark] sm:w-32"/></label>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 border-b bd pb-4">
            <div role="group" aria-label={t("library.type")} className="nice-scroll flex min-w-0 gap-1 overflow-x-auto pb-1">
              {(["",...Object.keys(icons)] as (""|keyof typeof icons)[]).map(value=><button key={value} type="button" data-history-kind={value} aria-pressed={kind===value} onClick={()=>setKind(value)} className={`shrink-0 rounded-md px-3 py-2 text-xs font-medium transition ${kind===value?"bg-hover fg":"fg-faint hover:bg-hover hover:fg"}`}>{value?t(`kind.${value}`):t("library.allTypes")}</button>)}
            </div>
            {filtered&&<button type="button" aria-label={t("library.clear")} onClick={clear} className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] fg-muted hover:bg-hover"><X size={13}/><span className="hidden sm:inline">{t("library.clear")}</span></button>}
          </div>
        </>}
        {data.unavailable?<div className="flex flex-col items-center py-20 text-center"><LockKeyhole size={28} className="fg-faint"/><h2 className="mt-5 text-lg font-medium fg">{t("library.unavailableTitle")}</h2><p className="mt-2 text-sm fg-muted">{t("library.unavailableBody")}</p><Link href={back} className="mt-6 text-sm font-medium fg underline underline-offset-4">{t("library.back")}</Link></div>
          :data.loading?<div role="status" className="flex items-center justify-center gap-2 py-20 text-sm fg-muted"><Loader2 size={17} className="motion-safe:animate-spin"/>{t("loading")}</div>
          :<>
            {data.error&&<div role="alert" className="mt-5 flex items-center justify-between gap-4 rounded-lg border bd bg-elev p-4 text-xs fg-muted"><p>{t("library.error")}</p><button type="button" onClick={()=>void(data.items.length?data.loadMore():data.refresh())} className="shrink-0 underline underline-offset-2">{t("library.refresh")}</button></div>}
            {!data.items.length&&!data.error&&<div className="flex flex-col items-center py-20 text-center"><FileSearch size={30} strokeWidth={1.5} className="fg-faint"/><h2 className="mt-5 text-lg font-medium fg">{t(data.nextCursor?"library.continueTitle":"library.emptyTitle")}</h2><p className="mt-2 max-w-sm text-[13px] leading-relaxed fg-muted">{t(data.nextCursor?"library.continueBody":"library.emptyBody")}</p>{filtered&&<button type="button" onClick={clear} className="mt-5 text-xs font-medium fg underline underline-offset-4">{t("library.clear")}</button>}</div>}
            {[...groups].map(([month,items])=><section key={month} className="mt-7">
              <h2 className="mb-3 text-[12px] font-medium fg-muted first-letter:uppercase">{month}</h2>
              <ul className="overflow-hidden rounded-xl border bd bg-elev">{items.map(item=>{
                const Icon=icons[item.kind],previous=item.lastReadyRevision!==null&&item.lastReadyRevision!==item.currentRevision;
                return <li key={item.id} data-history-item={item.id} className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 border-b last:border-b-0 bd px-3 py-4 sm:grid-cols-[40px_minmax(0,1fr)_120px_130px_130px] sm:px-4">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border bd bg-side fg-muted"><Icon size={17}/></span>
                  <div className="min-w-0"><p className="break-words text-[13px] font-medium fg leading-snug">{item.title}</p><p className="mt-1 text-[11px] fg-faint">{t(`kind.${item.kind}`)}{item.lastReadyRevision!==null&&<> · {t("revision",{number:item.lastReadyRevision})}</>}</p><div className="mt-2 sm:hidden">{badge(item)}<time className="ml-2 text-[10px] fg-faint" dateTime={item.createdAt}>{dateFormat.format(new Date(item.createdAt))}</time></div></div>
                  <div className="hidden sm:block">{badge(item)}</div><time className="hidden text-[11px] fg-faint sm:block" dateTime={item.createdAt}>{dateFormat.format(new Date(item.createdAt))}</time>
                  <div className="flex justify-end">{item.lastReadyRevision!==null&&<button type="button" data-history-open onClick={()=>setSelected({item,revision:item.lastReadyRevision!})} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border bd px-2.5 text-[11px] font-medium fg hover:bg-hover"><span className="hidden sm:inline">{t(previous?"previous":"open")}</span><ArrowUpRight size={14}/><span className="sr-only sm:hidden">{t("open")} {item.title}</span></button>}</div>
                </li>;
              })}</ul>
            </section>)}
            <div className="mt-6 flex flex-col items-center gap-4">{data.items.length>0&&<p className="text-[11px] fg-faint">{t("library.loaded",{count:data.items.length})}</p>}{data.nextCursor&&<button type="button" onClick={()=>void data.loadMore()} disabled={data.loadingMore} className="inline-flex min-h-10 items-center gap-2 rounded-lg border bd-strong bg-elev px-5 text-xs font-medium fg hover:bg-hover disabled:opacity-50">{data.loadingMore&&<Loader2 size={13} className="motion-safe:animate-spin"/>}{t("library.loadMore")}<ChevronDown size={13}/></button>}</div>
          </>}
      </div>
    </main>
    {selected&&<ArtifactViewer key={`${selected.item.id}/${selected.revision}`} projectId={projectId} item={selected.item} revision={selected.revision} fetcher={fetcher} onClose={()=>setSelected(null)} onAccessLost={()=>{data.remove(selected.item.id);setSelected(null);}}/>}
  </div>;
}
