// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { crearControlDeAvisos, type EventosAvisos, type EstadoAvisos, type NativoAvisos } from "./controlador";

function prueba(o: { configurado?: boolean; activa?: boolean; permiso?: "granted" | "denied" | "prompt"; disponible?: boolean } = {}) {
  let eventos: EventosAvisos | undefined;
  const llamadas: string[] = [];
  const tokens: string[] = [];
  const abiertos: string[] = [];
  const destinos: (string | undefined)[] = [];
  const estados: EstadoAvisos[] = [];
  const nativo: NativoAvisos = {
    escuchar: async (e) => { eventos = e; llamadas.push("escuchar"); return () => { llamadas.push("quitar"); }; },
    permiso: async () => o.permiso ?? "granted",
    pedirPermiso: async () => { llamadas.push("pedirPermiso"); return o.permiso ?? "granted"; },
    registrar: async () => { llamadas.push("registrar"); },
    desregistrar: async () => { llamadas.push("desregistrar"); },
    limpiar: async () => { llamadas.push("limpiar"); },
  };
  const cliente = { avisarAlCerrar: () => {}, pedir: vi.fn(async (ruta: string, init?: RequestInit) => {
    llamadas.push(`${init?.method ?? "GET"} ${ruta}`);
    if (ruta.startsWith("/api/projects/")) return Response.json({ project: { id: "p1" } });
    if (init?.method === "POST") { tokens.push(JSON.parse(String(init.body)).token); return new Response(null, { status: 204 }); }
    if (init?.method === "DELETE") { tokens.length = 0; return new Response(null, { status: 204 }); }
    return Response.json({ disponible: o.disponible ?? true, activa: o.activa ?? false, recipientUserId: "ana" });
  }) };
  const entregados: [string, string][] = [];
  const control = crearControlDeAvisos({ cliente, nativo, configurado: o.configurado ?? true, onEstado: e => estados.push(e), onAbrirProyecto: (p, destino) => { abiertos.push(p); destinos.push(destino); }, onAbrirEntregado: (p, url) => { entregados.push([p, url]); } });
  return { control, cliente, nativo, llamadas, tokens, abiertos, destinos, estados, entregados, eventos: () => eventos! };
}
// A finished task's push opens what Len delivered (spec local 2026-10-31-len-movil, §5.4).
describe("the push of a finished task", () => {
  const url = "/api/projects/p1/deliveries/t1/ab12cd34-informe.pdf";
  it("opens the delivered file, after checking recipient and access", async () => {
    const p = prueba(); await p.control.iniciar();
    await p.eventos().abrir({ projectId: "p1", recipientUserId: "ana", type: "len_turno", abrir: url });
    expect(p.entregados).toEqual([["p1", url]]);
    expect(p.abiertos).toEqual([]);
  });
  it("ignores an `abrir` that isn't one of the project's deliveries", async () => {
    const p = prueba(); await p.control.iniciar();
    for (const abrir of ["https://evil.example/x.pdf", "/api/projects/p2/deliveries/t1/ab12cd34-x.pdf", "/api/projects/p1/publish"]) {
      await p.eventos().abrir({ projectId: "p1", recipientUserId: "ana", type: "len_turno", abrir });
    }
    expect(p.entregados).toEqual([]);
    expect(p.abiertos).toEqual(["p1", "p1", "p1"]);
  });
});

describe("avisos del teléfono", () => {
  it("una mención abre equipo sólo tras comprobar destinatario y acceso", async () => {
    const p = prueba(); await p.control.iniciar();
    await p.eventos().abrir({ projectId: "p1", recipientUserId: "otra", type: "mencion" }); expect(p.destinos).toEqual([]);
    await p.eventos().abrir({ projectId: "p1", recipientUserId: "ana", type: "mencion" });
    expect(p.abiertos).toEqual(["p1"]); expect(p.destinos).toEqual(["equipo"]);
  });
  it("un aviso de Len Watch abre Gestión, donde están el arreglo y sus interruptores", async () => {
    const p = prueba(); await p.control.iniciar();
    await p.eventos().abrir({ projectId: "p1", recipientUserId: "ana", type: "len_watch" });
    expect(p.abiertos).toEqual(["p1"]); expect(p.destinos).toEqual(["gestion"]);
  });
  it("una mención recibida en primer plano conserva su destino al tocar Abrir", async () => {
    const p = prueba(); await p.control.iniciar();
    p.eventos().recibir({ projectId: "p1", recipientUserId: "ana", type: "mencion" }, "Equipo", "Hola");
    await p.control.abrirRecibido(); expect(p.destinos).toEqual(["equipo"]);
  });
  it("sin Firebase no llama ningún plugin nativo ni red", async () => {
    const p = prueba({ configurado: false }); await p.control.iniciar(); await p.control.activar(); await p.control.cerrar();
    expect(p.estados.at(-1)?.estado).toBe("noDisponible"); expect(p.llamadas).toEqual([]);
  });
  it("permisos se piden sólo al tocar activar; denegarlos no registra", async () => {
    const p = prueba({ permiso: "denied" }); await p.control.iniciar();
    expect(p.llamadas).not.toContain("pedirPermiso");
    await p.control.activar();
    expect(p.estados.at(-1)?.estado).toBe("denegados"); expect(p.llamadas).not.toContain("registrar");
  });
  it("registra el token y su rotación en la misma sesión", async () => {
    const p = prueba(); await p.control.iniciar(); await p.control.activar();
    await p.eventos().token("token-1"); await p.eventos().token("token-2");
    expect(p.tokens).toEqual(["token-1", "token-2"]);
    expect(p.estados.at(-1)?.estado).toBe("activos");
  });
  it("reinicia una suscripción activa sin volver a pedir permisos", async () => {
    const p = prueba({ activa: true }); await p.control.iniciar();
    expect(p.llamadas).toContain("registrar"); expect(p.llamadas).not.toContain("pedirPermiso");
  });
  it("desactivar limpia servidor, token nativo y bandeja; ignora rotaciones tardías", async () => {
    const p = prueba(); await p.control.iniciar(); await p.control.activar(); await p.eventos().token("token-1"); await p.control.desactivar(); await p.eventos().token("tardio");
    expect(p.tokens).toEqual([]); expect(p.llamadas).toContain("desregistrar"); expect(p.llamadas).toContain("limpiar");
    expect(p.estados.at(-1)?.estado).toBe("desactivados");
  });
  it("abrir el aviso valida destinatario y acceso al proyecto", async () => {
    const p = prueba(); await p.control.iniciar();
    await p.eventos().abrir({ projectId: "p1", recipientUserId: "otra" });
    await p.eventos().abrir({ projectId: "https://malicioso.invalid", recipientUserId: "ana" });
    expect(p.abiertos).toEqual([]);
    await p.eventos().abrir({ projectId: "p1", recipientUserId: "ana" });
    expect(p.abiertos).toEqual(["p1"]); expect(p.llamadas).toContain("GET /api/projects/p1");
  });
  it("no abre un proyecto al que ya no tiene acceso", async () => {
    const p = prueba(); await p.control.iniciar(); p.cliente.pedir.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await p.eventos().abrir({ projectId: "p1", recipientUserId: "ana" }); expect(p.abiertos).toEqual([]);
  });
  it("conserva el toque de arranque en frío mientras obtiene la identidad", async () => {
    const p = prueba();
    const escuchar = p.nativo.escuchar;
    p.nativo.escuchar = async e => { const salir = await escuchar(e); void e.abrir({ projectId: "p1", recipientUserId: "ana" }); return salir; };
    await p.control.iniciar(); expect(p.abiertos).toEqual(["p1"]);
  });
  it("cerrar invalida navegación en vuelo antes de cambiar de cuenta", async () => {
    const p = prueba(); await p.control.iniciar();
    let terminar!: (r: Response) => void;
    p.cliente.pedir.mockImplementationOnce(() => new Promise(resolve => { terminar = resolve; }));
    const navegando = p.eventos().abrir({ projectId: "p1", recipientUserId: "ana" });
    await p.control.cerrar(); terminar(Response.json({ project: { id: "p1" } })); await navegando;
    expect(p.abiertos).toEqual([]); expect(p.llamadas).toContain("quitar");
  });
  it("la recepción en primer plano no navega hasta tocar Abrir", async () => {
    const p = prueba(); await p.control.iniciar();
    p.eventos().recibir({ projectId: "p1", recipientUserId: "ana" }, "Len", "Listo");
    expect(p.abiertos).toEqual([]); expect(p.estados.at(-1)?.recibido?.cuerpo).toBe("Listo");
    await p.control.abrirRecibido(); expect(p.abiertos).toEqual(["p1"]);
  });
});
