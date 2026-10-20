"use client";
import {useMemo,useState} from "react";
import {ArtifactLibrary} from "@/components/workspace-v2/artifacts/artifact-library";
import {createFixtureFetcher,useFixtureTheme} from "../fixture";
import "../../../new/tokens.css";
export function HistoryPreview(){
  const fetcher=useMemo(()=>createFixtureFetcher(),[]),[dark,setDark]=useState(false);
  useFixtureTheme(dark);
  return <>
    <ArtifactLibrary projectId="fixture" projectName="Norte" fetcher={fetcher} backHref="/dev/artifacts"/>
    <div className="workspace-v2 fixed bottom-3 left-3 z-30 flex items-center gap-3 rounded-lg border bd px-3 py-2 text-[10px] fg-faint shadow-sm"><span>246 ejemplos · sin créditos</span><button type="button" onClick={()=>setDark(d=>!d)} className="underline underline-offset-2">Claro / oscuro</button></div>
  </>;
}
