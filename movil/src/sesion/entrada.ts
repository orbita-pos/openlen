// Entrar desde la app (spec §2): se abre el navegador del sistema en
// /<idioma>/movil/entrar con un `estado` inventado aquí; OpenLen devuelve a la
// app con un código de un solo uso y ESE estado. Si el estado no es el que
// esta app abrió, el regreso se ignora. El estado se recuerda fuera de la
// memoria porque en el navegador de la PC el regreso recarga la página.
export interface DepsDeEntrada {
  base: string;
  idioma: string;
  enWeb: boolean;
  abrir(url: string): Promise<void>;
  aleatorio(): string;
  recordar: { leer(): string | null; guardar(v: string | null): void };
  canjear(codigo: string, estado: string): Promise<string | null>;
  guardarLlave(llave: string): Promise<void>;
}

export function crearEntrada(d: DepsDeEntrada) {
  return {
    async empezar(): Promise<void> {
      const estado = d.aleatorio();
      d.recordar.guardar(estado);
      const q = new URLSearchParams({ estado, retorno: d.enWeb ? "dev" : "app" });
      await d.abrir(`${d.base}/${d.idioma}/movil/entrar?${q.toString()}`);
    },
    async alVolver(url: string): Promise<"ok" | "ignorado" | "caducado"> {
      let p: URLSearchParams;
      try {
        p = new URL(url).searchParams;
      } catch {
        return "ignorado";
      }
      const esperado = d.recordar.leer();
      const estado = p.get("estado");
      const codigo = p.get("codigo");
      if (!esperado || !codigo || estado !== esperado) return "ignorado";
      d.recordar.guardar(null);
      const llave = await d.canjear(codigo, estado);
      if (!llave) return "caducado";
      await d.guardarLlave(llave);
      return "ok";
    },
  };
}
