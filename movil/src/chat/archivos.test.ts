// @vitest-environment node
import { expect, it, vi } from "vitest";
import { subirArchivo, validarArchivos, archivosDelHistorial, MAX_ARCHIVO } from "./archivos";
const pdf = new File(["%PDF-1.7"], "Lista.pdf", {type:"application/pdf"});
it("valida tamaño, cantidad y formatos antes de subir, incluyendo Office sin MIME", () => {
  expect(validarArchivos([pdf,new File(["PK"],"Ventas.XLSX")])).toBeNull();
  expect(validarArchivos([new File(["x"],"programa.exe")])).toBe("tipo");
  expect(validarArchivos(Array(5).fill(pdf))).toBe("cantidad");
  const grande=new File(["x"],"x.pdf");Object.defineProperty(grande,"size",{value:MAX_ARCHIVO+1});expect(validarArchivos([grande])).toBe("grande");
});
it("sube con la llave, el proyecto y el MIME correcto; normaliza la URL", async () => {
  const pedir=vi.fn(async(_ruta:string,_init?:RequestInit)=>Response.json({url:"/uploads/p1/a.xlsx",size:2}));
  const r=await subirArchivo({pedir,avisarAlCerrar:()=>{}},"https://openlen.com","p1",new File(["PK"],"Ventas.xlsx"));
  const form=pedir.mock.calls[0]![1]!.body as FormData;
  expect(form.get("generationId")).toBe("p1");expect((form.get("file") as File).type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  expect(r).toEqual({url:"https://openlen.com/uploads/p1/a.xlsx",name:"Ventas.xlsx",size:2,kind:"xlsx"});
});
it("rechaza respuestas inválidas o URLs no http y comunica errores de subida", async () => {
  for(const r of [Response.json({url:"javascript:alert(1)"}),new Response(null,{status:415}),Response.json({})]){
    await expect(subirArchivo({pedir:async()=>r,avisarAlCerrar:()=>{}},"https://openlen.com","p1",pdf)).rejects.toThrow();
  }
});
it("el historial conserva documentos válidos e ignora metadatos rotos", () => {
  const a={url:"https://x/a.pdf",name:"Lista.pdf",size:8};
  expect(archivosDelHistorial([a,{...a,url:"javascript:x"},null,{...a,size:-1}])).toEqual([a]);
});
