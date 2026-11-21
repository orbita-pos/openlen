import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useChat, type Chat } from "./use-chat";
import type { StoredChatTurn } from "@/lib/projects/types";
const m = vi.hoisted(() => ({ mandar: vi.fn(), archivo: vi.fn(), foto: vi.fn() }));
vi.mock("./archivos", async importar => ({...await importar<typeof import("./archivos")>(), subirArchivo:m.archivo}));
vi.mock("./foto", () => ({ achicarFoto: async (foto: Blob) => foto }));
vi.mock("../api/chat", () => ({ mandarALen: m.mandar, dirigirA: vi.fn(), subirFoto: m.foto, transcribir: vi.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let chat: Chat;
const cliente = { pedir: vi.fn(), avisarAlCerrar: vi.fn() };
const historia: [] = [];
const recargar = vi.fn();
function Pantalla({ id, historial = historia, assistantId, viewingProjectId }: { id: string; historial?: StoredChatTurn[]; assistantId?: string; viewingProjectId?: string }) {
  chat = useChat({ cliente, base: "https://example.com", projectId: id, idioma: "es", historial, alCambiarLaPagina: recargar, textoDeArchivoSolo: "Revisa el archivo", ...(assistantId ? { assistantId } : {}), ...(viewingProjectId ? { viewingProjectId } : {}) });
  return null;
}
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
it("sends the project on screen with each message to her (spec local 2026-11-16-movil-es-tu-asistente, §5.3)", async () => {
  m.mandar.mockResolvedValue("terminado");
  await act(async () => root.render(<Pantalla id="p1" assistantId="a1" viewingProjectId="p2" />));
  await act(async () => chat.mandar("botón verde"));
  expect(m.mandar).toHaveBeenCalledWith(cliente, expect.objectContaining({ projectId: "p1", assistantId: "a1", viewingProjectId: "p2" }), expect.any(Function));
});
// Delivery 1 deferred it: an agent opened first on the phone never sent her file's first message.
it("🔴 her first message goes as the person's bubble, marked as her opening", async () => {
  m.mandar.mockResolvedValue("terminado");
  await act(async () => root.render(<Pantalla id="space" assistantId="a4" />));
  await act(async () => chat.abrirCon("¡Hola! Empecemos."));
  expect(m.mandar).toHaveBeenCalledWith(cliente, expect.objectContaining({ projectId: "space", assistantId: "a4", prompt: "¡Hola! Empecemos.", opening: true }), expect.any(Function));
  expect(chat.elementos.find((e) => e.tipo === "tu")).toMatchObject({ texto: "¡Hola! Empecemos.", estado: "ok" });
});

it("🔴 already sent from the web: her bubble here goes, with no error, and her conversation is read again", async () => {
  m.mandar.mockResolvedValue({ status: 409, code: "already_opened" });
  await act(async () => root.render(<Pantalla id="space" assistantId="a4" />));
  await act(async () => chat.abrirCon("¡Hola! Empecemos."));
  expect(chat.elementos.filter((e) => e.tipo === "tu")).toEqual([]);
  expect(recargar).toHaveBeenCalled();
});

it("a message the person writes isn't an opening", async () => {
  m.mandar.mockResolvedValue("terminado");
  await act(async () => root.render(<Pantalla id="space" assistantId="a4" />));
  await act(async () => chat.mandar("hola"));
  expect(m.mandar.mock.calls[0]![1]).not.toHaveProperty("opening");
});

it.each(["", "mira esta foto"])("conserva la captura y su texto (%j) al enviar y reintentar", async (texto) => {
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = () => "blob:captura";
    static revokeObjectURL = vi.fn();
  });
  const captura = new Blob(["captura"], { type: "image/png" });
  const url = "https://example.com/captura.jpg";
  m.foto.mockResolvedValue(url);
  m.mandar.mockResolvedValueOnce("sinRed").mockResolvedValueOnce("terminado");
  await act(async () => root.render(<Pantalla id="p1" assistantId="a1" viewingProjectId="p2" />));
  await act(async () => chat.mandar(texto, captura));
  const mensaje = chat.elementos.find((e) => e.tipo === "tu")!;
  expect(mensaje).toMatchObject({ texto, foto: "blob:captura", estado: "noSeEnvio" });
  await act(async () => chat.reintentar(mensaje.clave));
  expect(m.foto).toHaveBeenCalledTimes(1);
  const cuerpo = expect.objectContaining({ projectId: "p1", assistantId: "a1", viewingProjectId: "p2", prompt: texto, foto: url });
  expect(m.mandar.mock.calls.map(([, turno]) => turno)).toEqual([cuerpo, cuerpo]);
  expect(chat.elementos.find((e) => e.tipo === "tu")).toMatchObject({ texto, estado: "ok" });
});
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

it("mantiene enviando hasta que el servidor confirma el turno", async () => {
  let terminar!: (v: string) => void;
  m.mandar.mockImplementation(() => new Promise(r => { terminar = r; }));
  await act(async () => root.render(<Pantalla id="a" />));
  await act(async () => chat.mandar("Cambio pendiente"));
  try {
    expect(chat.elementos.find(e => e.tipo === "tu")).toMatchObject({ estado: "enviando" });
    const evento = m.mandar.mock.calls[0][2];
    await act(async () => evento({ nombre: "turno", datos: { turnoId: "servidor" } }));
    expect(chat.elementos.find(e => e.tipo === "tu")).toMatchObject({ estado: "ok" });
  } finally { await act(async () => terminar("terminado")); }
});
