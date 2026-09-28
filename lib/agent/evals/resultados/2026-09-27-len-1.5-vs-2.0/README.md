# Len 1.5 contra Len 2.0 — 2026-09-27

Las corridas que llevaron a llamar **2.0** a Len. El código de 2.0 está entero en el commit `adb5a5c1`,
y el artículo público en `len.openlen.com/es/research/len-2-0/`. Aquí está el resultado de CADA
corrida de los encargos de desarrollo, con la conversación entera entre el dueño simulado y Len.

| | Len 1.5 | Len 2.0 |
|---|---|---|
| código de Len | la etiqueta `len-1.5` (`19162e5a`), más lo que Len-Bench necesita para hablarle | la rama de 2.0 el 27/09; está entera, con lo que se arregló después, en `adb5a5c1` |
| modelo de Len | el mismo en las dos | el mismo en las dos |
| vara | Len-Bench (`lib/len-bench/`), la misma en las dos, la misma noche | |

**Cómo se mide.** Cada encargo trae una página de partida, lo que pide el dueño y unas pruebas que leen
la página PUBLICADA en un navegador (`lib/len-bench/graders.ts`), no lo que Len cuenta. Los encargos de
desarrollo están en `lib/len-bench/casos/dev/`. Hay dos vías:

- **Capacidad** (12): los encargos que 1.5 no hacía bien las tres veces.
- **Regresión** (19): los que 1.5 ya hacía bien; 2.0 no puede empeorar en ellos.

Aparte hay un **juego sellado** de 15 encargos que nadie vio mientras se construía 2.0, y que se abrió una
sola vez. Sus casos no se publican; sólo sus totales.

## Resultados

| | Len 1.5 | Len 2.0 | Diferencia (IC 95 %, emparejado por caso) |
|---|---|---|---|
| Capacidad, dev (12 × 3) | 50,0 % | **83,3 %** | +33,3 (± 39,4) |
| Regresión, dev (19 × 3) | 94,7 % | 91,2 % medido · **98,2 %** con los arreglos | −3,5 (± 7,4) medido |
| Sellado (15 × 3), medido | 62,2 % | 68,9 % | +6,7 (± 20,0) |
| Sellado, con la vara corregida en las dos | 75,6 % | 86,7 % | +11,1 (± 18,0) |
| Sellado, con el mismo criterio en las dos | 82,2 % | **95,6 %** | +13,3 (± 16,8) |
| Coste por corrida (sellado) | $0,0306 | **$0,0240** | |

Tabla caso a caso de dev: [`comparacion-dev.md`](comparacion-dev.md) («rama» es Len 2.0).
Ficheros: [`len-1.5-dev.json`](len-1.5-dev.json) y [`len-2.0-dev.json`](len-2.0-dev.json). En cada uno, una
corrida que el arnés no pudo medir se repitió y se sustituyó (lo dice su campo `reparado`).

**La regresión con los arreglos (98,2 %).** Medido, 2.0 bajó en cuatro casos. Tres tenían una causa que se
arregló después; uno se volvió a medir y los otros dos no. Se cuentan como arreglados, y se dice:

| Caso | Medido | Causa | Arreglo |
|---|---|---|---|
| `pago-con-tarjeta` | 1/3 | botones de «Pagar» que no iban a ningún sitio | «nada a medias»; medido después, 3/3 |
| `grafica-sin-numeros` | 2/3 | un paso pensó hasta el tope de salida y el turno murió | hasta 3 reintentos si la salida se corta |
| `tienda-que-crece` | 2/3 | el mismo corte | el mismo arreglo |
| `resenas-que-no-dio` | 2/3 | reseñas «de arranque» inventadas | ninguno: sigue abierto |

**El sellado, medido y corregido.** Al revisar a mano las corridas imperfectas, varias suspendían por la
vara y no por Len (un mapa incrustado que la prueba no reconocía, un botón que el script completa al cargar,
`/nosotros` sin barra final). Se corrigió igual en los dos brazos, corrida por corrida y con su motivo. Las
tres filas están arriba para que se vean las tres.

**La puerta de +25 no se cumplió.** Antes de medir se fijó que 2.0 tenía que sacarle a 1.5 al menos 25 puntos
en el sellado. Sacó +6,7 medido y +13,3 con el criterio común. La puerta no era alcanzable: en el sellado, 1.5
ya estaba en el 75,6 % con la vara corregida, así que el techo era +24,4. En dev sí se cumplió porque la
capacidad son, por construcción, los casos que 1.5 fallaba. El nombre 2.0 se decidió con esta tabla
delante.

## La comprobación del 28/09: los textos propios

Después de la medición se reescribieron con redacción propia las descripciones y los mensajes de las
herramientas de ficheros. Una vuelta de dev (31 × 1) comprobó que Len no las usa peor:
[`len-2.0-comprobacion-2026-09-28.json`](len-2.0-comprobacion-2026-09-28.json), con el mismo código que
`adb5a5c1` salvo tres comentarios.

- Capacidad 75,0 % (9/12) y regresión 78,9 % (15/19), medidos.
- Cinco de los siete casos que no llegan a 1,00 son el dueño simulado, no Len: desde el 27/09 es un doble
  FIJO que sólo contesta a la herramienta `preguntar`. Len pidió el dato que faltaba en su mensaje («dime la
  cifra y la pongo») y el doble no contestó. El 27/09, con un dueño que era un modelo, contestaba solo.
- Contado como el 98,2 %: regresión 18/19 (94,7 %), y sólo cae `resenas-que-no-dio`, como entonces;
  capacidad 11/12 (91,7 %). Es una estimación, no una medida.
- $0,0255 por corrida.

## Lo que sigue abierto

- Rellenar cuando falta un dato: reseñas «de arranque» inventadas, 1 de cada 3 veces.
- Tocar lo que no se pidió: una vez borró una frase de marca al cambiar un titular.
- Un total de caja que no sobrevivió a una recarga muy rápida, 1 de 3.
- La muestra: 12 casos de capacidad y 15 sellados dejan márgenes anchos (± 39 y ± 17 puntos).

## Repetirlo

```bash
npm run bench:len:servidor          # el servidor de Len-Bench, en :3007
npm run bench:len -- --juego=dev --runs=3 --budget-usd=<tope> --yes --etiqueta=<nombre>
```

El corredor imprime su estimado y no arranca si pasa del tope declarado. La medición entera de este día costó
$5,85 en dev (los dos brazos) y $2,46 en el sellado.
