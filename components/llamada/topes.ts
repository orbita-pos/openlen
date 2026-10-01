// La voz cobra por minuto aunque nadie hable: 60 s sin que hable ninguno de los
// dos (y sin Len trabajando) cuelgan, y ninguna llamada pasa de 10 minutos.
export type MotivoDeColgar = "silencio" | "duracion";

export const SILENCIO_MS = 60_000;
export const MAX_LLAMADA_MS = 600_000;

export function crearTopes(o: { silencioMs: number; maxMs: number; alColgar(m: MotivoDeColgar): void }) {
  let colgada = false;
  let trabajando = false;
  let silencio: ReturnType<typeof setTimeout> | null = null;
  const colgar = (m: MotivoDeColgar) => {
    if (colgada) return;
    colgada = true;
    parar();
    o.alColgar(m);
  };
  const reiniciarSilencio = () => {
    if (silencio) clearTimeout(silencio);
    silencio = trabajando || colgada ? null : setTimeout(() => colgar("silencio"), o.silencioMs);
  };
  const maximo = setTimeout(() => colgar("duracion"), o.maxMs);
  function parar() {
    if (silencio) clearTimeout(silencio);
    silencio = null;
    clearTimeout(maximo);
  }
  reiniciarSilencio();
  return {
    actividad: reiniciarSilencio,
    lenTrabajando(si: boolean) {
      trabajando = si;
      reiniciarSilencio();
    },
    parar() {
      colgada = true;
      parar();
    },
  };
}
