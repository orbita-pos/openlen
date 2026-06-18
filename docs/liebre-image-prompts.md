# LIEBRE — pack de prompts de imagen (ChatGPT / GPT-Image) · render 3D

Imágenes para la plantilla `liebre` (marca de ropa/streetwear con mascota 3D). Estilo: **render 3D
estilizado de personaje** (tipo Pixar / Blender / toy designer), NO foto, NO 2D. La mascota es una
**liebre ORIGINAL** — distinta del conejo gris de "Inner Circle" (la nuestra: pelaje crema/arena,
orejas largas de liebre, su propio rollo) para que no haya líos.

> **8 imágenes, TODAS transparentes (PNG):** 1 logo-mark · 3 poses del personaje · 4 productos
> recortados. El patrón del hero y el layout van en CSS.

> ⚠️ Gotcha: pide **fondo transparente (PNG)** en LAS 8 (logo, 3 poses y los 4 productos). Si sale con
> cuadrícula o fondo sólido, pásalo por **Canva → Quitar fondo**. Yo verifico el alfa al optimizar.

---

## DISEÑO DE LA MASCOTA (pégalo para fijar el personaje — genera el HERO primero)

```
Personaje 3D estilizado (estilo Pixar / Blender / diseño de juguete coleccionable): una LIEBRE
antropomórfica genial, de pelaje CREMA/ARENA con las puntas de las orejas largas en gris carbón,
ojos grandes y expresivos tras unas gafas de sol retro de pasta. Materiales con subsurface y brillos
suaves, iluminación de estudio, render limpio de alta calidad. Actitud relajada y segura, "cool".
Viste streetwear de la marca LIEBRE: camiseta oversize negra con un pequeño logo magenta (orejas de
liebre estilizadas), pantalón corto/jogger color crema, gorra a juego y zapatillas chunky crema con
detalles MAGENTA. Paleta: negro + crema + magenta (#FF1F6B). FONDO 100% TRANSPARENTE (PNG), cuerpo
completo, sin texto, sin marcas de agua, sin suelo ni sombra proyectada.
```

> Consistencia: genera **hero** primero. Para `point` y `chill` di "EXACTAMENTE el mismo personaje,
> mismo diseño, pelaje, gafas y ropa; solo cambia la pose".

---

## 1) LOGO-MARK · slug `logo` (PNG transparente)
```
Diseña un LOGO-MARK minimalista para una marca de streetwear llamada "LIEBRE": un monograma limpio
que combine una letra "L" con dos orejas largas de liebre (o una silueta de cabeza de liebre muy
simplificada), estilo emblema de marca de ropa, plano y rotundo, acabado en blanco (y una variante en
magenta #FF1F6B). FONDO 100% TRANSPARENTE (PNG), vista frontal, alto contraste, nítido, vectorial-limpio.
Sin escena de fondo, sin texto extra.
```

## 2) Las 3 poses del personaje (PNG TRANSPARENTE, 3:4, cuerpo completo)
- **hero** — `[MASCOTA] Pose principal de presentación: de pie, segura y relajada, una mano en el
  bolsillo, ligero contrapposto, mirando al frente. El look completo bien visible.`
- **point** — `[MASCOTA] Misma liebre, señalando con el brazo hacia un lado (gesto de "mira esto"),
  sonrisa pícara, cuerpo en 3/4. (Para colocar junto a unas tarjetas.)`
- **chill** — `[MASCOTA] Misma liebre en pose chill: sentada de lado en un cubo/banco invisible o
  apoyada, brazos cruzados, muy cool. (Para la sección de manifiesto, fondo oscuro.)`

## 3) Los 4 productos (PNG TRANSPARENTE, recortados, cuadrado ~1200×1200, e-commerce)
Estilo: **bodegón de producto de e-commerce**, iluminación de estudio suave, **FONDO 100% TRANSPARENTE
(PNG)**, producto centrado y recortado, SIN sombra proyectada al suelo. Son las prendas que viste la mascota.
- **prod-tee**    — `Camiseta oversize negra de algodón con un logo magenta de orejas de liebre en el pecho, foto de producto limpia, fondo transparente.`
- **prod-hoodie** — `Sudadera con capucha color crema/arena, con un pequeño bordado magenta, foto de producto limpia tipo ghost-mannequin, fondo transparente.`
- **prod-cap**    — `Gorra negra con detalle magenta y un logo de orejas de liebre, foto de producto limpia 3/4, fondo transparente.`
- **prod-kicks**  — `Zapatillas chunky de calle color crema con detalles magenta y suela gruesa, foto de producto lateral limpia, fondo transparente.`

---

## Dónde caen en la plantilla

| Imagen | Slot | Notas |
|---|---|---|
| `logo` | nav + footer | mark transparente |
| `hero` `point` `chill` | hero · cards de beneficios · manifiesto | personaje transparente, 3 poses |
| `prod-tee` `prod-hoodie` `prod-cap` `prod-kicks` | grid de tienda "EL DROP" | transparentes, recortados |

Manda los 8 como PNG por slug (`logo.png`, `hero.png`, `point.png`, `chill.png`, `prod-tee.png`, …).
Yo los paso a `liebre/<slug>.webp` (alfa preservado en las 8) y los publico en
`images.openlen.com/liebre/`.
