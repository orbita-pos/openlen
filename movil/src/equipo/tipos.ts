export interface Persona { userId: string; nombre: string; rol: "dueno" | "editor" | "lector"; avatar?: string | null }
export interface MensajeEquipo { id: string; autorId: string; autor: string; texto: string; fecha: number; fotos: { url: string; alt: string }[] }
export interface HiloEquipo {
  id: string; ruta: string; linea: number; codigo: string; estado: "abierto" | "resuelto"; creadoPor: string; createdAt: string; sinVer: number;
  mensajes: { id: string; autorId: string | null; autor: string | null; texto: string; filaId: string | null; createdAt: string }[];
}
export interface DatosEquipo { yo: string; rol: Persona["rol"]; puedeLen: boolean; personas: Persona[]; mensajes: MensajeEquipo[]; hilos: HiloEquipo[] }
export type AccionEquipo =
  | { accion: "mensaje"; texto: string; menciones: string[]; idioma: string }
  | { accion: "respuesta"; hiloId: string; texto: string; menciones: string[]; len: boolean; idioma: string }
  | { accion: "estado"; hiloId: string; estado: HiloEquipo["estado"] }
  | { accion: "vistas"; chat?: boolean; hilos?: string[] };
