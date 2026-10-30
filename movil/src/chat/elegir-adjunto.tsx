import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useAtras } from "../atras";
import { Icono } from "../iconos";
import { ACEPTAR_ARCHIVOS, validarArchivos } from "./archivos";
import "./adjuntos.css";

export function ElegirAdjunto({disabled,cantidad,onFoto,onArchivos,onError}:{disabled:boolean;cantidad:number;onFoto:(f:File)=>void;onArchivos:(fs:File[])=>void;onError:(error:string|null)=>void}) {
  const t=useTranslations("movil.adjuntos");
  const [menu,setMenu]=useState(false);
  const camara=useRef<HTMLInputElement>(null),fotos=useRef<HTMLInputElement>(null),archivos=useRef<HTMLInputElement>(null);
  const boton=useRef<HTMLButtonElement>(null),dialogo=useRef<HTMLDivElement>(null);
  useAtras(menu,()=>setMenu(false));
  useEffect(()=>{if(disabled)setMenu(false)},[disabled]);
  useEffect(()=>{
    if(!menu)return;
    const origen=boton.current;
    dialogo.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
    return ()=>{if(origen?.isConnected)origen.focus({preventScroll:true})};
  },[menu]);
  const elegir=(input:HTMLInputElement|null)=>{setMenu(false);input?.click()};
  const foto=(el:HTMLInputElement)=>{const f=el.files?.[0];el.value="";if(f){onError(null);onFoto(f)}};
  return <span className="app-elegir-adjunto" data-no-deslizar>
    <input ref={camara} hidden type="file" accept="image/*" capture="environment" data-origen="camara" onChange={e=>foto(e.currentTarget)}/>
    <input ref={fotos} hidden type="file" accept="image/*" data-origen="fotos" onChange={e=>foto(e.currentTarget)}/>
    <input ref={archivos} hidden type="file" accept={ACEPTAR_ARCHIVOS} multiple data-origen="archivos" onChange={e=>{
      const fs=Array.from(e.currentTarget.files??[]);e.currentTarget.value="";if(!fs.length)return;
      const error=validarArchivos(fs,cantidad);onError(error);if(!error)onArchivos(fs);
    }}/>
    <button ref={boton} className="ch-plus" type="button" aria-label={t("adjuntar")} aria-haspopup="dialog" aria-expanded={menu} disabled={disabled} onClick={()=>setMenu(m=>!m)}><Icono nombre="plus"/></button>
    {menu&&<>
      <div className="app-adjunto-fondo" aria-hidden="true" onPointerDown={()=>setMenu(false)}/>
      <div ref={dialogo} role="dialog" aria-modal="true" aria-label={t("adjuntar")} className="app-adjunto-menu" onKeyDown={e=>{
        if(e.key==="Escape"){e.preventDefault();e.stopPropagation();setMenu(false)}
        if(e.key==="Tab"){
          const bs=[...(dialogo.current?.querySelectorAll<HTMLButtonElement>('button')??[])],i=bs.indexOf(document.activeElement as HTMLButtonElement);
          if(e.shiftKey&&i===0){e.preventDefault();bs.at(-1)?.focus()}else if(!e.shiftKey&&i===bs.length-1){e.preventDefault();bs[0]?.focus()}
        }
      }}>
        <button type="button" onClick={()=>elegir(camara.current)}>{t("camara")}</button>
        <button type="button" onClick={()=>elegir(fotos.current)}>{t("fotos")}</button>
        <button type="button" onClick={()=>elegir(archivos.current)}>{t("archivos")}</button>
        <p>{t("limite")}</p><button type="button" className="app-adjunto-cancelar" onClick={()=>setMenu(false)}>{t("cancelar")}</button>
      </div>
    </>}
  </span>;
}
