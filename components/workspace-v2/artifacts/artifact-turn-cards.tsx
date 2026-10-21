"use client";

import {useTranslations} from "next-intl";
import {Check,ChevronRight,ImageIcon,LayoutDashboard,Loader2,Presentation,Video,Volume2} from "lucide-react";
import {artifactIdsOfTurn} from "@/lib/workspace-v2/center-content";
import {activeStatus} from "./client";
import {useWorkspaceArtifacts} from "./workspace-artifacts";

const icons={dashboard:LayoutDashboard,slides:Presentation,image:ImageIcon,motion:Video,audio:Volume2};

/**
 * The pieces a turn made, as Claude shows an artifact in the conversation: one card each, with its live status
 * (the bell's list), and «Abrir» once it has a ready version. A piece not listed yet (the list polls) waits.
 */
export function ArtifactTurnCards({actions}:{actions:readonly {tool:string;status:string;summary?:string;valores?:string}[]|undefined}){
  const t=useTranslations("topbar.artifacts");
  const workspace=useWorkspaceArtifacts();
  if(!workspace)return null;
  const pieces=artifactIdsOfTurn(actions).map(id=>workspace.items.find(a=>a.id===id)).filter(a=>a!==undefined);
  if(!pieces.length)return null;
  return <div className="flex flex-col gap-1.5">{pieces.map(item=>{
    const Icon=icons[item.kind],working=activeStatus(item.status)||item.status==="draft",failed=["failed","needs_attention"].includes(item.status);
    return <div key={item.id} data-turn-artifact={item.id} className="nc-card-in flex items-center gap-3 rounded-[14px] border bd bg-elev px-3 py-2.5">
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bd fg-muted"><Icon size={17}/></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium fg">{item.title}</span>
        <span className={`mt-0.5 flex items-center gap-1.5 text-[11.5px] ${item.status==="ready"?"text-emerald-700 dark:text-emerald-400":failed?"text-amber-700 dark:text-amber-400":"fg-muted"}`}>
          {working?<Loader2 size={11} className="motion-safe:animate-spin"/>:item.status==="ready"?<Check size={12}/>:null}
          {t(`kind.${item.kind}`)} · {t(`status.${item.status}`)}
        </span>
      </span>
      {item.lastReadyRevision!==null&&<button type="button" onClick={()=>workspace.open(item)} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg border bd px-2.5 text-[12px] font-medium fg hover:bg-hover">{t("open")}<ChevronRight size={13}/></button>}
    </div>;
  })}</div>;
}
