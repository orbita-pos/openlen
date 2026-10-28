import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,expect,it,vi} from "vitest";
import {ElegirAdjunto} from "./elegir-adjunto";
vi.mock("use-intl",()=>({useTranslations:()=>(s:string)=>s}));vi.mock("../atras",()=>({useAtras:()=>{}}));
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement;
afterEach(()=>{act(()=>root.unmount());host.remove()});
const montar=(onArchivos=vi.fn(),onError=vi.fn())=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);act(()=>root.render(<ElegirAdjunto disabled={false} cantidad={0} onFoto={vi.fn()} onArchivos={onArchivos} onError={onError}/>));return {onArchivos,onError}};
it("abre un menú con cámara, fotos y archivos; cada selector tiene su contrato nativo",()=>{
 montar();act(()=>host.querySelector<HTMLButtonElement>('button')!.click());
 expect(host.querySelector('[role=dialog]')?.textContent).toContain("camara");expect(host.textContent).toContain("archivos");
 expect(host.querySelector('input[capture]')?.getAttribute('capture')).toBe('environment');
 expect(host.querySelector('input[data-origen=fotos]')?.hasAttribute('capture')).toBe(false);
 expect(host.querySelector('input[data-origen=archivos]')?.getAttribute('accept')).toContain('.xlsx');
 act(()=>host.querySelector('[role=dialog]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(host.querySelector('[role=dialog]')).toBeNull();
});
it("rechaza un archivo incompatible antes de adjuntarlo y permite volver a elegir",()=>{
 const {onArchivos,onError}=montar();const campo=host.querySelector<HTMLInputElement>('input[data-origen=archivos]')!;
 Object.defineProperty(campo,'files',{configurable:true,value:[new File(['x'],'app.exe')]});act(()=>campo.dispatchEvent(new Event('change',{bubbles:true})));
 expect(onError).toHaveBeenCalledWith('tipo');expect(onArchivos).not.toHaveBeenCalled();
 Object.defineProperty(campo,'files',{value:[new File(['%PDF-'],'lista.pdf') ]});act(()=>campo.dispatchEvent(new Event('change',{bubbles:true})));
 expect(onArchivos).toHaveBeenCalledOnce();
});
