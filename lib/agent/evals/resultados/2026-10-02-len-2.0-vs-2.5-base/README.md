# Len 2.0 contra la base de Len 2.5 — 2026-10-02

Los 31 encargos de desarrollo de Len-Bench con la base de Len 2.5: el código del 2 de octubre, con la
terminal encendida, antes de las piezas que entraron el 5 de octubre (preguntas con opciones, modo plan,
encargos por rondas, Storage y tiempo real). El artículo público está en
`len.openlen.com/es/research/len-2-5/`.

| | Len 2.0 | Base de Len 2.5 |
|---|---|---|
| código de Len | la rama de 2.0 el 27/09 (ver `../2026-09-27-len-1.5-vs-2.0/`) | `550f2139`, con `OPENLEN_TERMINAL=1` |
| corridas | 31 encargos × 3, el 27/09 | 31 encargos × 1, el 02/10 |
| modelo de Len | el mismo en las dos | |
| vara | Len-Bench (`lib/len-bench/`) | la misma, con dos cambios entre las dos fechas (abajo) |

**Cómo se mide.** Igual que en `../2026-09-27-len-1.5-vs-2.0/`: cada encargo trae una página de partida,
lo que pide el dueño y unas pruebas que leen la página PUBLICADA en un navegador
(`lib/len-bench/graders.ts`). Capacidad (12) son los encargos que 1.5 no hacía bien; regresión (19), los
que ya hacía bien.

## Resultados

| | Len 2.0 | Base de Len 2.5 | Diferencia (IC 95 %, emparejado por caso) |
|---|---|---|---|
| Capacidad (12) | 83,3 % | **91,7 %** | +8,3 (± 27,3) |
| Regresión (19) | 91,2 % | 84,2 % | −7,0 (± 19,7) |
| Coste por corrida | $0,0282 | $0,0280 | |
| Tiempo por corrida | 232 s | **199 s** | |
| Turnos por corrida | 2,8 | 1,9 | |

Tabla caso a caso: [`comparacion-dev.md`](comparacion-dev.md), generada con
`npx tsx --tsconfig tsconfig.eval.json scripts/len-bench-comparar.ts 2.0=<len-2.0-dev.json> 2.5-base=len-2.5-base-dev.json`.
Fichero de las corridas: [`len-2.5-base-dev.json`](len-2.5-base-dev.json) (el de 2.0 está en su carpeta).

**Los casos de regresión por debajo de 1,00 en la base de 2.5:**

| Caso | Len 2.0 | Base de 2.5 | Qué pasó |
|---|---|---|---|
| `precios-y-whatsapp-de-la-ficha` | 3/3 | 0/1 | cambió los seis precios y tres botones; dejó «Agenda por WhatsApp →» llevando a `#visitanos`, y lo razonó como un ancla que funciona |
| `tour-nuevo-sin-datos` | 3/3 | 0/1 | también 0/1 en Len 2.1 (30/09) |
| `resenas-que-no-dio` | 2/3 | 0/1 | reseñas «de arranque» inventadas, como en 2.0 |

En capacidad, `quitar-producto-en-todas-partes` queda en 0,74: el dueño simulado no da el precio del set.

**La vara entre las dos fechas.** `0b972f0a`: `tienda-que-crece` acepta las dos piezas nuevas en cualquier
orden (antes suspendía una página correcta). Y el conductor manda la zona horaria del dueño en cada turno, así
que Len ve la hora del dueño y no la del servidor. El dueño simulado no cambió.

**Cómo se juntaron.** La tanda corrió en tres trozos el 2 de octubre (dos se cortaron por memoria de la máquina
que la corría, no por Len), y `len-2.5-base-dev.json` los junta: 31 casos, una corrida cada uno.
