import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useChat, type Chat } from "./use-chat";
import type { StoredChatTurn } from "@/lib/projects/types";
const m = vi.hoisted(() => ({ mandar: vi.fn(), archivo: vi.fn() }));
vi.mock("./archivos", async importar => ({...await importar<typeof import("./archivos")>(), subirArchivo:m.archivo}));
vi.mock("../api/chat", () => ({ mandarALen: m.mandar, dirigirA: vi.fn(), subirFoto: vi.fn(), transcribir: vi.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let chat: Chat;
const cliente = { pedir: vi.fn(), avisarAlCerrar: vi.fn() };
const historia: [] = [];
const recargar = vi.fn();
function Pantalla({ id, historial = historia }: { id: string; historial?: StoredChatTurn[] }) {
  chat = useChat({ cliente, base: "https://example.com", projectId: id, idioma: "es", historial, alCambiarLaPagina: recargar, textoDeFotoSola: "Foto", textoDeArchivoSolo: "Revisa el archivo" });
  return null;
}
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("crear un encargo envía el objetivo con goal y lo pone en el hilo", async () => {
  m.mandar.mockResolvedValue("terminado");
  await act(async () => root.render(<Pantalla id="a" />));
  await act(async () => chat.mandarEncargo("Completa el catálogo", "create"));
  expect(m.mandar).toHaveBeenCalledWith(cliente, expect.objectContaining({ projectId: "a", prompt: "Completa el catálogo", goal: "create" }), expect.any(Function));
  expect(chat.elementos.some((e) => e.tipo === "tu" && e.texto === "Completa el catálogo")).toBe(true);
});
it("un stream antiguo no cambia el progreso del proyecto nuevo", async () => {
  let terminar!: (v: string) => void;
  m.mandar.mockImplementation(() => new Promise((r) => { terminar = r; }));
  await act(async () => root.render(<Pantalla id="a" />));
  await act(async () => chat.mandar("Cambia A"));
  const evento = m.mandar.mock.calls[0][2];
  await act(async () => root.render(<Pantalla id="b" />));
  await act(async () => chat.mandar("Cambia B"));
  await act(async () => evento({ nombre: "text", datos: { text: "Respuesta de A" } }));
  expect(chat.elementos.some((e) => e.tipo === "len" && e.texto.includes("Respuesta de A"))).toBe(false);
  await act(async () => terminar("terminado"));
});
it("reintentar un encargo conserva el modo después de un fallo de red", async () => {
  m.mandar.mockResolvedValueOnce("sinRed").mockResolvedValueOnce("terminado");
  await act(async () => root.render(<Pantalla id="a" />));
  await act(async () => chat.mandarEncargo("Completa el catálogo", "resume"));
  const e = chat.elementos.find(e => e.tipo === "tu");
  expect(e && "estado" in e && e.estado).toBe("noSeEnvio");
  await act(async () => chat.reintentar(e!.clave));
  expect(m.mandar.mock.calls[1][1]).toMatchObject({ projectId: "a", goal: "resume" });
});
it("un turno nuevo empieza sin reutilizar los pasos del anterior", async () => {
  let terminar!: (v: string) => void;
  m.mandar.mockImplementation(() => new Promise(r => { terminar = r; }));
  const historial: StoredChatTurn[] = [{ id: "anterior", userText: "Cambia", assistantReasoning: "Falló", status: "error", actions: [{ tool: "Edit", status: "error", summary: "" }] }];
  await act(async () => root.render(<Pantalla id="a" historial={historial} />));
  expect(chat.progreso.some(p => p.estado === "error")).toBe(true);
  await act(async () => chat.mandar("Prueba de nuevo"));
  expect(chat.progreso).toEqual([]);
  await act(async () => terminar("terminado"));
});

it("reintenta sólo las subidas pendientes y conserva todos los archivos del mensaje", async () => {
  m.mandar.mockResolvedValue("terminado");
  const a={url:"https://x/a.pdf",name:"a.pdf",size:1},b={url:"https://x/b.pdf",name:"b.pdf",size:1};
  m.archivo.mockResolvedValueOnce(a).mockRejectedValueOnce(new Error("red")).mockResolvedValueOnce(b);
  await act(async()=>root.render(<Pantalla id="a"/>));
  await act(async()=>chat.mandar("",undefined,[new File(["x"],"a.pdf"),new File(["x"],"b.pdf")]));
  const e=chat.elementos.find(e=>e.tipo==="tu")!;
  expect(e.tipo==="tu"&&e.estado).toBe("noSeSubio");
  await act(async()=>chat.reintentar(e.clave));
  expect(m.archivo).toHaveBeenCalledTimes(3);expect(m.mandar.mock.calls[0][1]).toMatchObject({prompt:"Revisa el archivo",archivos:[a,b]});
});
it("una subida del proyecto anterior no envía archivos al proyecto nuevo", async()=>{
  let terminar!:(v:unknown)=>void;m.archivo.mockImplementation(()=>new Promise(r=>terminar=r));
  await act(async()=>root.render(<Pantalla id="a"/>));
  await act(async()=>chat.mandar("Documento A",undefined,[new File(["x"],"a.pdf")]));
  await act(async()=>root.render(<Pantalla id="b"/>));
  await act(async()=>terminar({url:"https://x/a.pdf",name:"a.pdf",size:1}));
  expect(m.mandar).not.toHaveBeenCalled();expect(chat.elementos.some(e=>e.tipo==="tu")).toBe(false);
});
