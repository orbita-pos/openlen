import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
// Contrato existente en master: lib/projects/chat-files.ts. Sólo adaptación
// de cliente para esta rama antigua; los bytes los validan/leen servidor y skills.
export const TIPOS_ARCHIVO = {
  pdf:"application/pdf", docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsm:"application/vnd.ms-excel.sheet.macroEnabled.12",
  pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation", csv:"text/csv",
} as const;
export type TipoArchivo = keyof typeof TIPOS_ARCHIVO;
export interface ArchivoAdjunto { readonly url:string; readonly name:string; readonly size:number; readonly kind?:TipoArchivo }
export const MAX_ARCHIVO = 20 * 1024 * 1024;
export const MAX_ARCHIVOS = 4;
export const ACEPTAR_ARCHIVOS = Object.entries(TIPOS_ARCHIVO).flatMap(([k,mime])=>[`.${k}`,mime]).join(",");
export const tipoArchivo = (name:string):TipoArchivo|null => {
  const ext=name.split(".").at(-1)?.toLowerCase()??"";
  return Object.hasOwn(TIPOS_ARCHIVO,ext)?ext as TipoArchivo:null;
};
export function validarArchivos(files:readonly File[], existentes=0):"tipo"|"grande"|"cantidad"|null {
  if(files.length+existentes>MAX_ARCHIVOS)return "cantidad";
  for(const f of files){if(!tipoArchivo(f.name))return "tipo";if(!f.size||f.size>MAX_ARCHIVO)return "grande";}
  return null;
}
export async function subirArchivo(c:ClienteDeOpenLen,base:string,projectId:string,file:File):Promise<ArchivoAdjunto>{
  const fallo=validarArchivos([file]);if(fallo)throw new Error(fallo);
  const kind=tipoArchivo(file.name)!;
  const form=new FormData();form.append("file",new File([file],file.name,{type:TIPOS_ARCHIVO[kind]}));form.append("generationId",projectId);
  const r=await c.pedir("/api/upload",{method:"POST",body:form});
  if(!r.ok)throw new Error(String(r.status));
  const j=await r.json() as {url?:unknown;size?:unknown};
  if(typeof j.url!=="string"||!j.url)throw new Error("url");
  const url=new URL(j.url,base);
  if(!["https:","http:"].includes(url.protocol)||url.username||url.password)throw new Error("url");
  const size=typeof j.size==="number"&&Number.isFinite(j.size)&&j.size>0?j.size:file.size;
  return {url:url.href,name:file.name,size,...(kind!=="pdf"?{kind}:{})};
}
export function archivosDelHistorial(valor:unknown):ArchivoAdjunto[]{
  if(!Array.isArray(valor))return [];
  return valor.filter((f):f is ArchivoAdjunto=>{
    if(!f||typeof f.url!=="string"||typeof f.name!=="string"||!f.name||typeof f.size!=="number"||!Number.isFinite(f.size)||f.size<0)return false;
    if(f.kind!==undefined&&!Object.hasOwn(TIPOS_ARCHIVO,f.kind))return false;
    try{const u=new URL(f.url);return ["https:","http:"].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}
  }).slice(0,MAX_ARCHIVOS);
}
export const tamanoArchivo = (size:number) => size<1024*1024?`${Math.max(1,Math.round(size/1024))} KB`:`${(size/1024/1024).toFixed(1)} MB`;
