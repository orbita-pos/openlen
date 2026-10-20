"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import {ArtifactTray} from "@/components/workspace-v2/artifacts/artifact-tray";
import {createFixtureFetcher,useFixtureTheme} from "./fixture";
import "../../new/tokens.css";

export function ArtifactsPreview(){
  const [dark,setDark]=useState(false),[readOnly,setReadOnly]=useState(false),[offline,setOffline]=useState(false);
  useFixtureTheme(dark);
  const offlineRef=useRef(offline);offlineRef.current=offline;
  useEffect(()=>{window.dispatchEvent(new Event("online"));},[offline]);
  const fetcher=useMemo(()=>createFixtureFetcher(()=>offlineRef.current),[]);
  return <div className={dark?"dark":""}>
    <div className="workspace-v2 min-h-screen">
      <header className="h-14 px-5 flex items-center justify-between border-b bd bg-elev"><div className="flex items-center gap-5 text-sm"><b>Open<span className="text-[var(--accent)]">Len</span></b><span className="fg-faint">/</span><span>Norte</span></div><ArtifactTray projectId="fixture" readOnly={readOnly} fetcher={fetcher} historyHref="/dev/artifacts/history"/></header>
      <div className="flex min-h-[calc(100dvh-56px)]">
        <aside className="hidden md:flex w-72 shrink-0 border-r bd bg-side p-5 flex-col gap-5"><p className="text-xs fg-faint">CHAT CON LEN</p><p className="text-sm fg leading-relaxed">Mañana presento mi app. Dame una presentación, un video, dos imágenes para promocionarla y un dashboard de ventas.</p><p className="text-sm fg-muted leading-relaxed">Estoy preparando cada pieza. Puedes abrir las que estén listas desde la campana.</p><div className="mt-auto rounded-xl border bd px-3 py-3 text-xs fg-faint">Pídele algo a Len…</div></aside>
        <main className="flex-1 min-w-0 p-5 md:p-12 bg-preview-a">
          <div className="max-w-4xl mx-auto rounded-2xl border bd bg-elev overflow-hidden"><div className="border-b bd px-6 py-4 text-sm font-medium flex justify-between"><span>NORTE</span><span className="fg-faint">Pedidos · Clientes · Reportes</span></div><div className="p-7 md:p-10"><p className="text-xs fg-faint">TU NEGOCIO, EN ORDEN</p><h1 className="text-3xl md:text-4xl font-semibold tracking-tight mt-3">Cada pedido cuenta.</h1><p className="fg-muted mt-3 max-w-sm leading-relaxed">Una vista clara de lo que vendes y de las personas que vuelven a elegirte.</p><div className="grid grid-cols-2 gap-5 border-y bd mt-8 py-6"><div><p className="text-xs fg-faint">Ventas del mes</p><p className="text-3xl font-medium mt-2">$31,200</p></div><div><p className="text-xs fg-faint">Pedidos entregados</p><p className="text-3xl font-medium mt-2">128</p></div></div><div className="h-36 flex items-end gap-3 pt-5">{[34,56,43,72,60,86,100].map((h,i)=><div key={i} className="flex-1 rounded-t bg-[var(--accent)] opacity-75" style={{height:`${h}%`}}/>)}</div></div></div>
          <div className="max-w-4xl mx-auto mt-6 text-xs fg-muted flex flex-wrap items-center gap-4"><span>Demo con datos de ejemplo. No usa créditos.</span><button className="underline" onClick={()=>setDark(v=>!v)}>Claro / oscuro</button><button className="underline" onClick={()=>setReadOnly(v=>!v)}>Lector: {readOnly?"sí":"no"}</button><button className="underline" onClick={()=>setOffline(v=>!v)}>Conexión: {offline?"sin conexión":"activa"}</button></div>
        </main>
      </div>
    </div>
  </div>;
}

