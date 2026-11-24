# Len 3.1 contra la producción del 12 de noviembre — 2026-11-16

> **Corregida el 24/11.** La prueba «nada inventado» suspendía avisos que Len sí dio, en otro idioma o citando los
> valores. Las mismas corridas, recalificadas: `../2026-11-24-len-3.1-clientes-recalificada/`.

La tabla con la que se nombró Len 3.1 (etiqueta `len-3.1`, sobre `ca7f92566`). Mide el flujo que usan los clientes
—crear una página, seguir editándola y publicarla— con el mismo corredor y los mismos casos sobre lo que había en
producción el 12 de noviembre y sobre 3.1.

| | Base | Len 3.1 |
|---|---|---|
| código de Len | `92f4f7e21`, producción del 12/11 | `ca7f92566` |
| corridas | 24 casos × 3, del 15 al 16/11 | 24 casos × 3, el 16/11 |
| modelo de Len | el mismo en las dos | |
| vara | Len-Bench, juego `clientes` (`lib/len-bench/`) | la misma, con el mismo evaluador |

**Los casos.** 24 encargos reales de clientes de OpenLen: lo que pidió cada uno y su ficha (los datos de su negocio).
Su texto NO está en este repositorio, que es público: el corredor los lee fuera de él (`npm run bench:clientes:fetch`)
y las corridas, que guardan la conversación, tampoco se publican. Aquí sólo van los totales.

**Cómo se mide.** Cada encargo lo hace Len de principio a fin, con un dueño simulado que contesta desde la ficha, y
unas pruebas sin modelo leen la página PUBLICADA en un navegador (`lib/len-bench/graders.ts`). Un encargo está
terminado cuando pasan todas las pruebas que votan. El juez con modelo («cumple lo pedido») observa y no vota: su
acuerdo con las etiquetas de referencia fue del 82,6 %, por debajo del 90 % que pedimos para que vote. El margen de
cada fila se escribió antes de correrla.

Las dos columnas se califican con la misma regla:

- «Nada inventado» acepta un dato que el dueño no dio cuando Len le dijo que era de ejemplo o supuesto, nombrando su
  tipo (teléfono, correo, precio), aunque no repita la cifra (`9db186f4e`).
- Un turno que el reloj del banco cortó a los 20 minutos cuenta como NO terminado en las dos columnas, como se corrió
  la batería. En producción nada corta un turno que trabaja; esos cortes (4 en la base, corrida de noche, y 9 en 3.1,
  corrida de día con el proveedor más lento; todos en las tiendas más grandes) perjudican más a 3.1. Desde
  `31d59c81e` el banco los cuenta aparte y les da 60 minutos.

## Resultados

| | Base | Len 3.1 | Margen |
|---|---|---|---|
| Encargos terminados | 41 de 72 (56,9 %) | 43 de 72 (59,7 %) | ±11,8 pts |
| Publica sin que se rechace la dirección que dio el dueño (F2) | 1 de 3 | **3 de 3** | ±57,7 pts |
| Coste por encargo, a precio de lista (media · mediana · p90) | $0,0756 · $0,0554 · $0,1704 | **$0,0615 · $0,0521 · $0,1501** | ±$0,0009 |
| Coste por encargo terminado | $0,1328 | **$0,1031** | — |
| Llamadas al modelo por encargo (media · mediana · p90) | 44 · 39 · 89 | **37 · 36 · 63** | ±1,1 |
| Minutos por encargo (media · mediana · p90) | 7,9 · 6,5 · 17,5 | 8,3 · 7,2 · 20,0 | ±0,1 |
| Entrada leída de caché | 96,7 % | 96,8 % | ±0,2 pts |
| Escrituras rechazadas por no haber leído antes (F3) | 0,01 por encargo | 0,07 por encargo | ±0,02 |
| Bucles: corridas con llamadas repetidas (F4) | 0 de 72 | 0 de 72 | recuento |
| Turnos cortados por el reloj del banco | 4 | 9 | recuento |

**Cómo leerla.** Los encargos terminados no cambian fuera del ruido. Baja el coste por encargo (−18,7 % en la media;
−22,4 % por encargo terminado) y bajan las llamadas al modelo. F2 deja de aparecer. Los minutos no bajan: los turnos
largos de las tiendas tardaron más con el proveedor más lento. F3 sube: eran notas de memoria que Len escribió en un
turno y que el siguiente daba por no leídas; está arreglado después de 3.1 (`6e77b19ac`), sin medir aquí.

**Lo que esta tabla no cubre.** Apps, juegos, subagentes, herramientas, el asistente propio, los conectores y el
teléfono; y con unos pocos turnos al día, producción no puede confirmar nada por sí sola.

**Gasto.** $5,69 la base y $4,43 Len 3.1, a precio de lista, más $0,33 del piloto.

## Volver a una conversación

La rebaja al volver a una conversación más tarde no sale de esta tabla: se midió aparte el 14/11, con 12
conversaciones, tres brazos y tres corridas (`4dd211976`). Cuando la caché del proveedor ya caducó, retomar una
conversación larga —40.000 tokens o más, donde Len deja un resumen mientras la conversación descansa— cuesta un
48,7 % menos; en las más cortas la rebaja es menor. Las 324 respuestas salieron correctas en los tres brazos.
