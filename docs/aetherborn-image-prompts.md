# AETHERBORN — pack de prompts de imagen (ChatGPT / GPT-Image)

Imágenes para la plantilla `templates/starter/aetherborn.html`. Genera cada una en ChatGPT
(modelo de imágenes), **pídele fondo transparente (PNG)** donde se indique, y mándame los
archivos o súbelos a R2 / tu librería *By OpenLen*; yo los cableo en la plantilla.

> Estilo elegido: **splash art pintado (LoL / Arcane)**. Pega el bloque **ESTILO BASE** al
> inicio de cada prompt para que todos los personajes parezcan del mismo universo.

---

## ESTILO BASE (pégalo antes de cada prompt)

```
Splash art de videojuego, ilustración pintada a mano estilo League of Legends / Arcane.
Fantasía oscura con tecnología arcana ("aetherium"). Iluminación cinematográfica dramática
con luz de borde (rim light) dorada. Paleta: azul noche profundo + dorado + acentos de magia.
Altísimo nivel de detalle, render épico, atmósfera, partículas mágicas. Sin texto, sin logos,
sin marcas de agua, sin marco.
```

---

## 1) Campeones del selector — 6 personajes (PNG, FONDO TRANSPARENTE)

**Formato:** vertical 3:4 (~900×1200), **fondo transparente**, cuerpo completo, pose dinámica de acción.
Estos reemplazan el `.ph-art` de cada clase en el selector.

- **Nyx — Asesina** (aura violeta)
  `[ESTILO BASE] Una asesina ágil con capucha y máscara, dos dagas curvas de energía violeta,
  envuelta en sombras y humo púrpura, pose de salto al ataque. Aura mágica violeta.`

- **Gromm — Luchador** (aura roja)
  `[ESTILO BASE] Un guerrero corpulento con armadura de placas desgastada y un hacha doble
  ardiente, cicatrices, pose de carga feroz, chispas y brasas rojas a su alrededor.`

- **Lyra — Maga** (aura azul)
  `[ESTILO BASE] Una hechicera elegante con túnica fluida y un báculo de cristal flotante,
  runas azules girando en el aire, cabello al viento, pose lanzando un conjuro arcano.`

- **Vex — Tiradora** (aura verde)
  `[ESTILO BASE] Una arquera/tiradora ágil con ballesta de tecnología arcana, capa ligera,
  pose disparando una flecha de energía verde, dinámica y en movimiento.`

- **Sera — Soporte** (aura turquesa)
  `[ESTILO BASE] Una sanadora serena con alas de luz y un orbe curativo turquesa, túnica
  blanca y dorada, pose protectora con las manos extendidas, partículas de luz suaves.`

- **Thorne — Tanque** (aura ámbar)
  `[ESTILO BASE] Un coloso acorazado con un escudo enorme de piedra y oro y un martillo,
  yelmo imponente, pose defensiva firme, polvo y roca a sus pies, presencia monumental.`

---

## 2) Key art del hero (con fondo, panorámico)

**Formato:** horizontal 16:9 (~1920×1080), **con fondo** (paisaje épico). Va detrás del logo "AETHERBORN".

```
[ESTILO BASE] Key art panorámico de un MOBA de fantasía: un campo de batalla arcano al
atardecer, montañas y un gran portal de energía ("el Núcleo") brillando al fondo, varios
campeones heroicos en silueta dramática listos para la batalla. Composición épica, mucho
espacio de cielo arriba (para colocar el logo). Tonos azul noche + dorado.
```

## 3) Aspecto destacado — sección "Domina con Estilo" (rombo)

**Formato:** cuadrado ~1000×1000, personaje centrado (transparente o con fondo oscuro).

```
[ESTILO BASE] Un campeón con un aspecto premium "legendario": armadura ornamentada con
detalles dorados luminosos y efectos de aspecto especiales, pose heroica de presentación,
fondo oscuro con brillo dorado para que destaque dentro de un marco de diamante.
```

## 4) Noticias — 3 imágenes (con fondo, 16:10)

**Formato:** horizontal 16:10 (~800×500), con fondo.

- **Notas de versión:** `[ESTILO BASE] Escena de la línea inferior de un mapa MOBA, dos campeones tiradores enfrentándose, energía azul.`
- **Aspectos "Eclipse Arcano":** `[ESTILO BASE] Grupo de campeones con aspectos a juego de tema "eclipse arcano", morados y dorados, presentación de colección.`
- **Esports / Mundial:** `[ESTILO BASE] Estadio de esports lleno, trofeo dorado "Copa del Aetherium" iluminado en el escenario, confeti, ambiente de campeonato.`

---

## Dónde caen en la plantilla

| Imagen | Slot en `aetherborn.html` | Cómo |
|---|---|---|
| 6 campeones | `.ph-art` dentro de `.champ-portrait` (selector) | cambio `.ph-art` → `<img>` y añado `img:` a cada clase en el JS `CHAMPS` |
| Key art hero | `<section>` del hero | añado `<img class="absolute inset-0 object-cover -z-10">` sobre `.hero-arcane` |
| Aspecto destacado | `.ph-art` dentro de `.diamond` | reemplazo por `<img>` |
| 3 noticias | `.ph-art` dentro de cada `.news-img` | reemplazo por `<img>` |

> Consejo: para los **6 campeones**, pídele a ChatGPT que mantenga el **mismo estilo y encuadre**
> entre los seis (misma altura de cámara, misma luz) para que el selector se vea coherente.
> Genera primero a Nyx y luego usa "mismo estilo que la imagen anterior" para el resto.
