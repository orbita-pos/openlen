"use client";
import {useEffect,useRef,useState,type Ref} from "react";
import type {ArtifactPreviewFrame} from "@/lib/artifacts/preview-frame";

/** Preserve the authored viewport and browser hit testing inside the opaque sandbox. */
export function FittedPreview({frame,frameRef,title,url}:{frame:ArtifactPreviewFrame;frameRef:Ref<HTMLIFrameElement>;title:string;url:string}){
  const container=useRef<HTMLDivElement>(null),[scale,setScale]=useState(0);
  useEffect(()=>{
    const node=container.current;if(!node)return;
    const fit=(width:number,height:number)=>setScale(Math.max(0,Math.min(1,width/frame.width,height/frame.height)));
    const rect=node.getBoundingClientRect();fit(rect.width,rect.height);
    const observer=new ResizeObserver(entries=>{const rect=entries[0]?.contentRect;if(rect)fit(rect.width,rect.height);});
    observer.observe(node);return()=>observer.disconnect();
  },[frame.width,frame.height]);
  return <div ref={container} style={{width:"100%",minWidth:0,height:"min(64dvh, 680px)",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{position:"relative",flexShrink:0,width:frame.width*scale,height:frame.height*scale}}>
      <iframe ref={frameRef} title={title} src={url} sandbox="allow-scripts" referrerPolicy="no-referrer" style={{position:"absolute",top:0,left:0,width:frame.width,height:frame.height,maxWidth:"none",border:0,background:"white",transformOrigin:"top left",transform:`scale(${scale})`}}/>
    </div>
  </div>;
}
