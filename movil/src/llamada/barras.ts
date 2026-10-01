// Las barras de la tarjeta de visitas, con la medida del prototipo (44 px el
// día más alto, que lleva su número) y el último día como «hoy».
const ALTO = 44;

export function barrasDeVisitas(porDia: { dia: string; vistas: number }[]) {
  const max = Math.max(0, ...porDia.map((d) => d.vistas));
  return porDia.map((d, i) => ({
    dia: d.dia,
    valor: d.vistas,
    alto: max === 0 ? 0 : Math.round((d.vistas / max) * ALTO),
    esMax: max > 0 && d.vistas === max,
    esHoy: i === porDia.length - 1,
  }));
}
