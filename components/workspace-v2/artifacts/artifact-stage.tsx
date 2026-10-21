"use client";

import {useTranslations} from "next-intl";
import {ImageIcon,LayoutDashboard,Loader2,Presentation,Video,Volume2} from "lucide-react";
import {activeStatus,artifactFetch,type ArtifactFetch,type ArtifactSummary} from "./client";
import {ArtifactViewer} from "./artifact-viewer";

const icons={dashboard:LayoutDashboard,slides:Presentation,image:ImageIcon,motion:Video,audio:Volume2};
interface Props {projectId:string;items:readonly ArtifactSummary[];selectedId:string|null;onSelect:(id:string)=>void;onAccessLost:()=>void;fetcher?:ArtifactFetch}

/**
 * The workspace center of a project that has no page but has deliverables: the piece itself, as Claude opens an
 * artifact beside the conversation. The newest piece unless one was chosen (from the chat's card, the bell or the
 * row on top); a piece still being made says so until its first version is ready.
 */
export function ArtifactStage({projectId,items,selectedId,onSelect,onAccessLost,fetcher=artifactFetch}:Props){
  const t=useTranslations("topbar.artifacts");
  const newestFirst=[...items].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
  const current=newestFirst.find(a=>a.id===selectedId)??newestFirst[0];
  if(!current)return null;
  const Icon=icons[current.kind],working=activeStatus(current.status)||current.status==="draft",failed=["failed","needs_attention"].includes(current.status);
  return <div className="flex min-w-0 flex-1 flex-col gap-3 bg-side p-3 sm:p-5">
    {newestFirst.length>1&&<nav aria-label={t("title")} className="flex shrink-0 gap-1.5 overflow-x-auto">{newestFirst.map(item=>{
      const ItemIcon=icons[item.kind],on=item.id===current.id;
      return <button key={item.id} type="button" data-stage-piece={item.id} aria-current={on?"true":undefined} onClick={()=>onSelect(item.id)} className={`inline-flex max-w-[240px] shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] transition ${on?"bd-strong bg-elev fg font-medium":"bd fg-muted hover:bg-hover"}`}>
        <ItemIcon size={14} aria-hidden="true"/><span className="truncate">{item.title}</span>
      </button>;
    })}</nav>}
    {current.lastReadyRevision!==null
      ?<>
        {working&&<p role="status" className="flex shrink-0 items-center gap-1.5 text-xs fg-muted"><Loader2 size={12} className="motion-safe:animate-spin"/>{t(`status.${current.status}`)}</p>}
        <ArtifactViewer key={`${current.id}/${current.lastReadyRevision}`} inline projectId={projectId} item={current} revision={current.lastReadyRevision} fetcher={fetcher} onClose={()=>{}} onAccessLost={onAccessLost}/>
      </>
      :<section role="status" className="flex flex-1 flex-col items-center justify-center rounded-2xl border bd bg-elev px-6 py-12 text-center">
        <span aria-hidden="true" className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border bd bg-side fg-muted"><Icon size={24} strokeWidth={1.5}/></span>
        <h2 className="max-w-md text-lg font-semibold fg leading-snug">{current.title}</h2>
        <p className={`mt-2 flex items-center gap-1.5 text-[13px] ${failed?"text-amber-700 dark:text-amber-400":"fg-muted"}`}>
          {working&&<Loader2 size={13} className="motion-safe:animate-spin"/>}{t(`kind.${current.kind}`)} · {t(`status.${current.status}`)}
        </p>
        {failed&&<p className="mt-2 max-w-sm text-xs fg-faint leading-relaxed">{t("failedHint")}</p>}
      </section>}
  </div>;
}
