// lib/len-bench/reintentar-publicar.ts — el rename que Windows retiene un instante.
//
// Medido el 2026-09-28 en la máquina de desarrollo: publicar un sitio de VARIAS
// páginas fallaba a veces con `EPERM: operation not permitted, rename
// '…/releases/.tmp-…' -> '…/releases/<sha>'` (`sitio-que-se-muda` también). Un
// proceso de Windows —el antivirus o el indexador— tiene abiertos un momento los
// ficheros recién escritos, y renombrar la carpeta que los contiene falla; a los
// ~100 ms pasa (un reintento bastó en todas las medidas). Un rename suelto fuera
// de la publicación no lo reproducía.
//
// Va en el CORREDOR y no en `publishToDir`: en producción (Linux) no pasa, y una
// corrida pagada que muere al publicar tira el dinero de todo lo anterior.
// Sólo se reintenta ese error exacto; cualquier otro sale tal cual.

export async function conReintentoPorEperm<T>(
  publicar: () => Promise<T>,
  o: { intentos?: number; esperaMs?: number; dormir?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const intentos = o.intentos ?? 5;
  const esperaMs = o.esperaMs ?? 250;
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 1; ; i++) {
    try {
      return await publicar();
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code !== "EPERM" || e.syscall !== "rename" || i >= intentos) throw err;
      await dormir(esperaMs);
    }
  }
}
