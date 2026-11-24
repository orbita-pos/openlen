# Len 3.1 contra la producción del 12 de noviembre, recalificada — 2026-11-24

Las mismas 144 corridas de la tabla con la que se nombró Len 3.1 (`../2026-11-16-len-3.1-clientes/`), calificadas
otra vez con la prueba «nada inventado» corregida. Sin modelo y sin volver a correr nada: $0.

**Qué se corrigió.** Al revisar una a una las 29 corridas de Len 3.1 que no terminaron, las 10 que suspendían
«nada inventado» eran corridas en las que Len SÍ le había dicho al dueño que esos datos eran de ejemplo o supuestos.
La prueba sólo entendía el aviso en español y nombrando el tipo de dato con su palabra: Len avisó en portugués
(«Assumi o +55 no link do WhatsApp, porque o endereço é em Maringá»), en italiano («sono segnaposto»), citando los
valores («`info@…`, `+39 …` son de relleno») o nombrando lo que lleva el precio («las fichas son de ejemplo»). Desde
`c534e3100` la prueba entiende el aviso en los idiomas latinos de OpenLen y por el valor que cita. Las dos columnas
se recalifican con la misma regla.

Igual que en la tabla original, un turno que el reloj del banco cortó a los 20 minutos cuenta como NO terminado en
las dos columnas (4 en la base, 9 en 3.1).

## Resultados

| | Base | Len 3.1 | Margen |
|---|---|---|---|
| Encargos terminados | 47 de 72 (65,3 %) | 53 de 72 (73,6 %) | ±11,8 pts |
| Publica sin que se rechace la dirección que dio el dueño (F2) | 1 de 3 | **3 de 3** | ±57,7 pts |
| Coste por encargo, a precio de lista (media · mediana · p90) | $0,0756 · $0,0554 · $0,1704 | **$0,0615 · $0,0521 · $0,1501** | ±$0,0009 |
| Coste por encargo terminado | $0,1158 | **$0,0836** | — |
| Llamadas al modelo por encargo (media · mediana · p90) | 44 · 39 · 89 | **37 · 36 · 63** | ±1,1 |
| Minutos por encargo (media · mediana · p90) | 7,9 · 6,5 · 17,5 | 8,3 · 7,2 · 20,0 | ±0,1 |
| Turnos cortados por el reloj del banco | 4 | 9 | recuento |

Las filas que no tocan «nada inventado» (coste por encargo, llamadas, minutos, caché, F3, F4) son las mismas de la
tabla original.

**Cómo leerla.** Los encargos terminados suben en las dos columnas: la prueba suspendía avisos que sí se dieron. La
diferencia entre las dos sigue dentro del margen, así que la lectura de la tabla original no cambia: los mismos
resultados con un 18,7 % menos de coste por encargo. Por encargo terminado la rebaja pasa del 22,4 % al 27,8 %.

**Sin contar los cortes del reloj** quedan 47 de 68 (69,1 %) en la base y 53 de 63 (84,1 %) en 3.1. No se usa
para comparar: aparta más corridas de 3.1 (9) que de la base (4), y son las de los encargos más grandes.

**Lo que queda sin terminar en 3.1** (19 de 72): los 9 cortes del reloj; 4 páginas vacías en las que Len preguntó y
el dueño simulado contestó «déjalo como está», que se lee como «no hagas nada» (corregido en `c534e3100` para las
próximas corridas: ya no se ven en éstas); y 6 páginas con enlaces `#` sin destino, 4 de ellos avisados al dueño
porque no le dio su número o sus redes.
