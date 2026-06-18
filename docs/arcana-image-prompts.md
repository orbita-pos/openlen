# ARCANA — pack de prompts de imagen (ChatGPT / GPT-Image, modelo nuevo) · estilo KOF

Imágenes para la plantilla `arcana` (portal de una saga de lucha, estilo The King of Fighters).
Estilo de ilustración: **King of Fighters / anime semirealista de pelea** (NO el painterly LoL/Arcane,
ese ya lo usa AETHERBORN). Genera cada una en ChatGPT, **pide fondo TRANSPARENTE (PNG)** donde se
indique, y mándame los archivos. Yo optimizo a `.webp`, subo a R2 y cableo.

> **10 imágenes:** 1 logo/emblema (transparente) · 1 key-art de hero (con fondo, ancho) · 8 personajes
> (busts transparentes). El layout, la barra amarilla, el filmstrip y el semitono van en CSS.

> ⚠️ Gotcha de transparencia (real, nos pasó con AETHERBORN): si ChatGPT dice “transparente” pero al
> ponerlo sobre negro ves cuadrícula, horneó el patrón en vez de alfa → **Canva → Quitar fondo**. Yo
> verifico el alfa al optimizar.

---

## ESTILO BASE (pégalo ANTES de cada prompt de PERSONAJE)

```
Ilustración de personaje de videojuego de lucha, estilo The King of Fighters / SNK: anime
semirealista, pintado, líneas definidas, sombreado dramático, mucha actitud y dinamismo. Diseño de
personaje moderno y estilizado (no medieval): silueta única, ropa de combate con carácter, efecto de
ELEMENTO visible. Iluminación cinematográfica con rim light. Cuerpo de 3/4 a cuerpo completo, pose de
combate dinámica, encuadre vertical 3:4 (~900×1200). FONDO 100% TRANSPARENTE (PNG), recorte limpio.
Sin texto, sin logos, sin marcas de agua, sin marco, sin suelo ni sombra proyectada.
```

> Coherencia: genera **KAEL primero**. Para el resto di “mismo estilo, misma altura de cámara y misma
> luz que la imagen anterior”, para que todo el roster se vea de un mismo juego.

---

## 1) LOGO / EMBLEMA · *slug `logo`* (PNG TRANSPARENTE)

```
Diseña un EMBLEMA / logotipo de marca para un videojuego de lucha llamado "ARCANA". Marca limpia,
audaz y memorable: un monograma/sigilo basado en una "A" afilada fusionada con dos hojas o rayos
cruzados (vibe arcano + combate), estilo emblema de franquicia de lucha (referencia de tratamiento:
los emblemas tipo SNK / King of Fighters). Acabado metálico blanco-plata con un filo de luz, sobre
FONDO 100% TRANSPARENTE (PNG). Vista frontal, simétrico, alto contraste, nítido, vectorial-limpio.
Sin escena de fondo. Incluye opcionalmente la palabra "ARCANA" en tipografía pesada en itálica debajo.
```
> Tip: pídele 2-3 variantes del emblema y elige; el texto en GPT-Image a veces sale torcido — si la
> palabra "ARCANA" sale mal, pide **solo el emblema sin texto** (yo pongo el wordmark con la fuente).

## 2) KEY-ART DEL HERO · *slug `hero`* (CON FONDO, ANCHO 16:9 ~2400×1350)

```
[Estilo The King of Fighters, anime semirealista pintado, cinematográfico]
Key-art épico de portada de un juego de lucha: DOS protagonistas en primer plano, espalda con espalda
o encarándose — a la izquierda KAEL, héroe disciplinado con aura/llama DORADA en los puños; a la
derecha KORR, villano intenso de abrigo oscuro con energía CARMESÍ. Detrás, un montaje DESENFOCADO de
varios otros luchadores. Iluminación dramática, partículas, mucha actitud. Composición horizontal con
espacio central despejado arriba (ahí irá el logo). Sin texto, sin logos, sin marcas de agua.
```

---

## 3) Los 8 personajes (PNG, FONDO TRANSPARENTE, 3:4)

- **KAEL — "El Heraldo"** · *slug `kael`* (protagonista, glow dorado)
  `[ESTILO BASE] Héroe joven y disciplinado, artista marcial con chaqueta moderna de cuello alto,
  puños y antebrazos envueltos en llama/luz DORADA, pose de guardia confiada, mirada decidida.`

- **KORR — "El Ocaso"** · *slug `korr`* (jefe final tipo Rugal, glow carmesí)
  `[ESTILO BASE] Villano imponente y carismático con abrigo largo oscuro de hombros marcados, energía
  CARMESÍ crepitando en una mano alzada, una cicatriz o un ojo que brilla en rojo, sonrisa fría, pose
  dominante y amenazante.`

- **MORA — "La Sombra"** · *slug `mora`* (kunoichi, glow violeta)
  `[ESTILO BASE] Asesina ágil con traje ajustado oscuro y capucha media, dos cuchillas cortas con
  energía VIOLETA, humo púrpura, pose felina baja lista para atacar.`

- **VESTA — "La Pira"** · *slug `vesta`* (boxeadora, glow naranja)
  `[ESTILO BASE] Boxeadora de cabello encendido con top deportivo y vendas, guantes envueltos en
  llamas NARANJAS, pose de boxeo agresiva, chispas y brasas alrededor.`

- **BRANN — "El Yunque"** · *slug `brann`* (agarrador colosal, glow bronce)
  `[ESTILO BASE] Luchador gigante y musculoso tipo grappler, pantalón de combate y muñequeras de
  hierro, pose de agarre poderosa, energía/polvo TIERRA-BRONCE, presencia monumental.`

- **AELITH — "El Juicio"** · *slug `aelith`* (luchadora aérea, glow turquesa)
  `[ESTILO BASE] Luchadora elegante y veloz con traje aerodinámico claro, corrientes de VIENTO
  turquesa girando a su alrededor, pose de patada aérea en pleno salto, dinámica.`

- **VORN — "La Siega"** · *slug `vorn`* (guadañero, glow verde-veneno)
  `[ESTILO BASE] Luchador siniestro y delgado con capucha andrajosa y máscara, una guadaña o garras,
  niebla VERDE venenosa, rostro en penumbra, pose baja y amenazante.`

- **ISOLDE — "La Escarcha"** · *slug `isolde`* (hechicera de combate, glow cian)
  `[ESTILO BASE] Hechicera de combate regia con abrigo azul y plata, conjurando esquirlas de HIELO y
  cristal CIAN flotantes, pose lanzando un golpe gélido, escarcha en el aire.`

---

## Dónde caen en la plantilla

| Imagen | Slot | Cómo |
|---|---|---|
| `logo` | nav (pequeño) + hero (grande) | mismo <img>, dos tamaños |
| `hero` | fondo del hero (object-cover) | key-art ancho con su escena |
| 8 personajes | filmstrip (recorte a la cara) + base de datos (bust) | comparten el mismo cutout transparente |

Manda los 10 como PNG nombrados por slug (`logo.png`, `hero.png`, `kael.png`, …). Yo los convierto a
`arcana/<slug>.webp` (alfa preservado en logo + personajes) y los publico en `images.openlen.com/arcana/`.

---

## Extra: 3 thumbnails de NOTICIAS (16:9, CON fondo, NO transparente)

Para la sección "Últimas noticias". Escenas cinematográficas, **NO recortes**. Slugs `news1/news2/news3`.

ESTILO BASE noticias (pégalo antes de cada uno):
```
Ilustración cinematográfica estilo The King of Fighters / SNK: escena pintada semirealista, dramática,
oscura con acentos dorados/ámbar. Composición horizontal 16:9 (~1600×900), CON fondo. Sin texto, sin
logos, sin marcas de agua (el rótulo se superpone luego en la web).
```

- **news1 — Torneo / "Se abre el Coliseo de ARCANA VII"**
  `[BASE] Vista épica del interior de un gran coliseo de combate de fantasía a rebosar de público,
  focos dramáticos sobre una arena central iluminada, humo y haces de luz dorada, escala monumental.`

- **news2 — Actualización / "Parche 7.2 · VESTA y KORR"**
  `[BASE] Dos luchadores enfrentados en primer plano: a la izquierda una boxeadora de cabello en llamas
  con guantes ardientes (energía naranja), a la derecha un villano de abrigo oscuro con energía carmesí;
  pose de duelo, chispas, fondo oscuro neutro. (Personajes originales, no reales.)`

- **news3 — e-Sports / "Gran final en Tokio"**
  `[BASE] Gran torneo de esports: escenario enorme con pantallas y luces, multitud, ambiente de gran
  final, al fondo un skyline nocturno tipo Tokio con neón. Tonos oscuros con destellos dorados.`

Guárdalas `news1.png / news2.png / news3.png`. Yo las paso a `arcana/news{1,2,3}.webp` (sin alfa) y
sustituyen al arte de personajes que ahora usan como fallback.
