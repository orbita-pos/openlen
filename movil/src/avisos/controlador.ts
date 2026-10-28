import type { ClienteDeOpenLen } from "@/components/llamada/cliente";

export type EstadoAvisos = {
  estado: "cargando" | "noDisponible" | "desactivados" | "activando" | "activos" | "denegados" | "error";
  recibido: { titulo: string; cuerpo: string; projectId: string; recipientUserId: string; type?: "mencion" } | null;
};
type Permiso = "granted" | "denied" | "prompt";
export interface EventosAvisos {
  token(token: string): Promise<void>;
  error(): void;
  abrir(datos: unknown): Promise<void>;
  recibir(datos: unknown, titulo: string, cuerpo: string): void;
}
export interface NativoAvisos {
  escuchar(eventos: EventosAvisos): Promise<() => void>;
  permiso(): Promise<Permiso>;
  pedirPermiso(): Promise<Permiso>;
  registrar(): Promise<void>;
  desregistrar(): Promise<void>;
  limpiar(): Promise<void>;
}

/** La identidad viene del servidor autenticado, nunca del aviso ni del almacenamiento local. */
export function crearControlDeAvisos(d: {
  cliente: ClienteDeOpenLen;
  nativo: NativoAvisos;
  configurado: boolean;
  onEstado(e: EstadoAvisos): void;
  onAbrirProyecto(id: string, destino?: "equipo"): void;
}) {
  let vivo = true;
  let permitido = false;
  let usuario: string | null = null;
  let disponible = d.configurado;
  let pendiente: unknown = null;
  let quitar: (() => void) | undefined;
  let operaciones: Promise<void> = Promise.resolve();
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  let estado: EstadoAvisos = { estado: "cargando", recibido: null };
  const emitir = (nuevo: Partial<EstadoAvisos>) => { estado = { ...estado, ...nuevo }; if (vivo) d.onEstado(estado); };
  const cancelarEspera = () => { if (temporizador) clearTimeout(temporizador); temporizador = undefined; };
  const pedir = (ruta: string, init?: RequestInit) => d.cliente.pedir(ruta, { ...init, signal: AbortSignal.timeout(12_000) });
  const datosValidos = (datos: unknown): { projectId: string; recipientUserId: string; type?: "mencion" } | null => {
    if (!datos || typeof datos !== "object") return null;
    const b = datos as Record<string, unknown>;
    if (typeof b.projectId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(b.projectId) || typeof b.recipientUserId !== "string" || b.recipientUserId !== usuario) return null;
    return { projectId: b.projectId, recipientUserId: b.recipientUserId, ...(b.type === "mencion" ? { type: "mencion" as const } : {}) };
  };
  async function abrir(datos: unknown) {
    if (!vivo) return;
    if (!usuario) { pendiente = datos; return; }
    const b = datosValidos(datos);
    if (!b) return;
    try {
      const res = await pedir(`/api/projects/${encodeURIComponent(b.projectId)}`);
      if (res.ok && vivo && b.recipientUserId === usuario) {
        emitir({ recibido: null });
        if (b.type === "mencion") d.onAbrirProyecto(b.projectId, "equipo");
        else d.onAbrirProyecto(b.projectId);
      }
    } catch { if (vivo) emitir({ estado: "error" }); }
  }
  function registrarToken(token: string): Promise<void> {
    operaciones = operaciones.then(async () => {
      if (!vivo || !permitido || !usuario) return;
      const res = await pedir("/api/movil/avisos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      if (!res.ok) throw new Error("registro");
      cancelarEspera();
      if (vivo && permitido) emitir({ estado: "activos" });
    }).catch(() => { cancelarEspera(); if (vivo && permitido) emitir({ estado: "error" }); });
    return operaciones;
  }
  async function registrar() {
    if (!vivo) return;
    permitido = true;
    emitir({ estado: "activando" });
    cancelarEspera();
    temporizador = setTimeout(() => { if (vivo && permitido) emitir({ estado: "error" }); }, 15_000);
    await d.nativo.registrar();
  }
  async function estadoServidor(): Promise<boolean> {
    const res = await pedir("/api/movil/avisos");
    if (!res.ok) throw new Error("estado");
    const b = await res.json() as { disponible: boolean; activa: boolean; recipientUserId: string };
    if (!vivo) return false;
    if (typeof b.recipientUserId !== "string" || !b.recipientUserId) throw new Error("identidad");
    usuario = b.recipientUserId;
    disponible = b.disponible === true;
    return b.activa === true;
  }
  async function bajaServidor() {
    await operaciones;
    const res = await pedir("/api/movil/avisos", { method: "DELETE" });
    if (!res.ok && res.status !== 401) throw new Error("baja");
  }
  async function limpiarNativo() {
    if (!d.configurado) return;
    await Promise.all([d.nativo.desregistrar(), d.nativo.limpiar()]);
  }
  function abandonar() {
    vivo = false; permitido = false; usuario = null; pendiente = null;
    cancelarEspera(); quitar?.(); quitar = undefined;
  }
  return {
    async iniciar() {
      if (!d.configurado) { emitir({ estado: "noDisponible" }); return; }
      try {
        const salir = await d.nativo.escuchar({ token: registrarToken, error: () => { cancelarEspera(); if (vivo && permitido) emitir({ estado: "error" }); }, abrir,
          recibir: (datos, titulo, cuerpo) => { const b = datosValidos(datos); if (b && vivo) emitir({ recibido: { ...b, titulo, cuerpo } }); },
        });
        if (!vivo) { salir(); return; }
        quitar = salir;
        const activa = await estadoServidor();
        if (!vivo) return;
        if (pendiente) { const datos = pendiente; pendiente = null; await abrir(datos); }
        if (!vivo) return;
        if (!disponible) { emitir({ estado: "noDisponible" }); return; }
        const permiso = await d.nativo.permiso();
        if (!vivo) return;
        if (permiso === "denied") {
          if (activa) { await bajaServidor(); await limpiarNativo(); }
          emitir({ estado: "denegados" });
        } else if (activa && permiso === "granted") await registrar();
        else emitir({ estado: "desactivados" });
      } catch { cancelarEspera(); emitir({ estado: "error" }); }
    },
    async activar() {
      if (!vivo || !d.configurado || !disponible) { if (vivo) emitir({ estado: "noDisponible" }); return; }
      if (estado.estado === "activando") return;
      try {
        if (!usuario) await estadoServidor();
        if (!vivo || !disponible) { emitir({ estado: "noDisponible" }); return; }
        const permiso = await d.nativo.pedirPermiso();
        if (!vivo) return;
        if (permiso !== "granted") { permitido = false; emitir({ estado: "denegados" }); return; }
        await registrar();
      } catch { cancelarEspera(); emitir({ estado: "error" }); }
    },
    async desactivar() {
      permitido = false; cancelarEspera(); emitir({ estado: "activando", recibido: null });
      try { await bajaServidor(); await limpiarNativo(); emitir({ estado: "desactivados" }); }
      catch { emitir({ estado: "error" }); }
    },
    abrirRecibido: async () => { if (estado.recibido) await abrir(estado.recibido); },
    /** Logout: invalida primero cualquier navegación, luego baja con la llave aún presente. */
    async cerrar() {
      abandonar();
      if (!d.configurado) return;
      const resultados = await Promise.allSettled([bajaServidor(), limpiarNativo()]);
      if (resultados.some(r => r.status === "rejected")) throw new Error("baja_de_avisos_incompleta");
    },
    /** Desmontaje normal: conserva la suscripción para seguir recibiendo en segundo plano. */
    abandonar,
  };
}
