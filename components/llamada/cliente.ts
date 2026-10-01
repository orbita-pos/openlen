// Cómo habla la llamada con OpenLen. La web usa rutas relativas y su cookie;
// la app del teléfono pasa su propio cliente (la dirección del servidor y su
// llave en «Authorization»). Así el puente, los topes y los eventos —lo que ya
// está probado— son el MISMO código en los dos sitios.
export interface ClienteDeOpenLen {
  pedir(ruta: string, init?: RequestInit): Promise<Response>;
  /** Un aviso que debe salir aunque la página se cierre. */
  avisarAlCerrar(ruta: string, cuerpo: string): void;
}

export const clienteDeLaWeb: ClienteDeOpenLen = {
  pedir: (ruta, init) => fetch(ruta, init),
  avisarAlCerrar: (ruta, cuerpo) => {
    navigator.sendBeacon?.(ruta, new Blob([cuerpo], { type: "application/json" }));
  },
};
