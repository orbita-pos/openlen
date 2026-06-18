# AVENIR — pack de prompts de imagen (ChatGPT / GPT-Image) · fotos de coche

Imágenes para la plantilla `avenir` (coche eléctrico de lujo, estilo Tesla Model S). **TODAS con su
fondo (NO transparentes)** → no hay que recortar nada en Canva. Estilo: fotografía automotriz
fotorrealista y cinematográfica. El coche es un **modelo ORIGINAL** (NO un Tesla ni ninguna marca real).

> **10 fotos.** Genera la `hero` primero para fijar el diseño del coche; para el resto di "el MISMO
> coche, mismo diseño y color, distinto encuadre". Manténlo coherente.

> ⚠️ IP: el coche NO debe parecerse a un Tesla ni llevar ningún logo/insignia de marca real. Diseño
> propio (frontal, faros y proporciones distintos). Sin texto, sin logos, sin marcas de agua.

---

## ESTILO BASE (pégalo antes de cada prompt)

```
Fotografía automotriz de catálogo, fotorrealista y cinematográfica, de un coche ELÉCTRICO DE LUJO
ORIGINAL (NO un Tesla ni ninguna marca real, sin logos ni insignias): un gran turismo / liftback
deportivo de líneas limpias y aerodinámicas, faros LED finos, llantas aero, color ROJO CARMÍN
metalizado. Acabado premium, iluminación dramática, altísimo detalle, sin texto, sin marcas de agua.
```

---

## Las 10 fotos

- **hero** — `[ESTILO BASE] Vista cenital/3-4 del coche en marcha por una carretera escénica de montaña
  o un puente, fondo desenfocado por velocidad, hora dorada, composición horizontal 16:9, mucho espacio
  arriba para el título.` (con fondo)

- **interior** — `[ESTILO BASE] Interior amplio y luminoso de la cabina: asientos claros, gran pantalla
  central horizontal, volante minimalista, techo panorámico de cristal y vistas a montañas y mar por
  las ventanas. Luz natural, 16:9.`

- **cockpit** — `[ESTILO BASE] Plano frontal del puesto de conducción: volante, pantalla central
  encendida con un mapa/interfaz, consola limpia, ambiente oscuro y elegante. 16:9.`

- **screen** — `[ESTILO BASE] Primer plano de la gran pantalla central encendida mostrando una interfaz
  limpia (mapa de navegación y multimedia), con la cabina desenfocada detrás. 16:9.`

- **rear** — `[ESTILO BASE] Plano de la segunda fila: pantalla trasera de entretenimiento encendida
  montada en la consola central trasera, asientos claros, ambiente premium. 16:9.`

- **trunk** — `[ESTILO BASE] Portón trasero abierto mostrando un maletero enorme con una bicicleta
  plegada y equipaje dentro, exterior soleado, cielo azul. 16:9.`

- **wheel** — `[ESTILO BASE] Detalle de estudio de la llanta delantera y la pinza de freno (roja),
  neumático de perfil bajo, sobre fondo gris claro liso de estudio. 4:3.`

- **aero** — `[ESTILO BASE] Detalle de estudio del alerón trasero / la línea aerodinámica de la cola
  del coche, sobre fondo gris claro liso de estudio. 4:3.`

- **light** — `[ESTILO BASE] Detalle de estudio del faro delantero LED encendido y el morro del coche,
  sobre fondo gris claro liso de estudio. 4:3.`

- **aerial** — `[ESTILO BASE] Vista aérea (dron) del coche rojo circulando por una carretera sinuosa de
  montaña junto a un lago azul rodeado de pinos, día despejado, épico. 16:9.`

---

## Dónde caen en la plantilla

| Foto | Slot |
|---|---|
| `hero` | hero a sangre completa |
| `interior` | sección interior a sangre + carrusel |
| `cockpit` `screen` `rear` | carrusel "Interior de otro nivel" + características |
| `trunk` | característica "Guárdalo todo" |
| `wheel` `aero` `light` | trío de detalles (sección oscura) |
| `aerial` | sección "Ve a cualquier parte" |

Manda las 10 como `hero.png`, `interior.png`, `cockpit.png`, `screen.png`, `rear.png`, `trunk.png`,
`wheel.png`, `aero.png`, `light.png`, `aerial.png`. Yo las paso a `avenir/<slug>.webp` y las publico en
`images.openlen.com/avenir/`. (No hace falta transparencia — todas con su fondo.)
