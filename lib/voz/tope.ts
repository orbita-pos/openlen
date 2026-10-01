// Tope de llamadas por proceso y día. Es una red de DEV, no el tope de
// producción (ése va por usuario y en la base, antes de subir): está para que un
// fallo que se pusiera a abrir sesiones solo no gaste más de N llamadas.
export function crearTopeDiario(max: number, ahora: () => Date = () => new Date()): { intentar(): boolean } {
  let dia = "";
  let usadas = 0;
  return {
    intentar() {
      const hoy = ahora().toISOString().slice(0, 10);
      if (hoy !== dia) {
        dia = hoy;
        usadas = 0;
      }
      if (usadas >= max) return false;
      usadas++;
      return true;
    },
  };
}

export const topeDeLlamadas = crearTopeDiario(Number(process.env.OPENLEN_VOZ_LLAMADAS_DIA) || 20);

/** Las notas de voz del chat (pieza 2): la misma red de DEV que las llamadas. */
export const topeDeNotas = crearTopeDiario(Number(process.env.OPENLEN_VOZ_NOTAS_DIA) || 100);
