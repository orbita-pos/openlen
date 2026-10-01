// El cliente de la app: la base del servidor + la llave del teléfono en cada
// petición. Un 401 quiere decir que la llave ya no vale (la borraron desde
// «Salir» o caducó): la app vuelve a «Entrar».
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";

export function crearClienteDeLaApp(o: {
  base: string;
  llave: () => string | null;
  alNoAutorizado: () => void;
  fetch?: typeof fetch;
}): ClienteDeOpenLen {
  const f = o.fetch ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));
  const cabeceras = (init?: RequestInit): Headers => {
    const h = new Headers(init?.headers);
    const llave = o.llave();
    if (llave) h.set("authorization", `Bearer ${llave}`);
    return h;
  };
  return {
    async pedir(ruta, init) {
      const res = await f(`${o.base}${ruta}`, { ...init, headers: cabeceras(init) });
      if (res.status === 401) o.alNoAutorizado();
      return res;
    },
    avisarAlCerrar(ruta, cuerpo) {
      const h = cabeceras({ headers: { "content-type": "application/json" } });
      void f(`${o.base}${ruta}`, { method: "POST", body: cuerpo, headers: h, keepalive: true }).catch(() => {});
    },
  };
}
