// El contrato MÍNIMO: sólo lo que la publicación impone de verdad.
//
// POR QUÉ EXISTE. `PUBLISH_CONTRACT` (18.563 caracteres, el 85% del prompt de
// creación) se le presenta al modelo diciendo "nothing below tells you what a
// page should look like". Medido, no es cierto: el 45,5% del prompt entero son
// las nueve recetas de conductas, con 28 etiquetas de HTML de ejemplo, y el
// vocabulario dice `nav` 7 veces, `carrusel` 3, `menú` 3, `portafolio` 3,
// `landing` 2 y `hero` 2. Un documento que enseña veintiocho trozos de markup
// no es neutral respecto a la forma de la página.
//
// La sospecha —que el prompt es la jaula, y por eso todas las páginas salen con
// la misma forma— nunca se ha probado: el factorial de ayer comparó el 96,4%
// del prompt contra el 100%, no contra esto.
//
// QUÉ SE CONSERVÓ. Sólo lo que rompe la página si falta:
//   - el sanitizador BORRA todo `<script>` y todo `on*` → hay que decirlo
//   - el sanitizador BORRA todo `<iframe>`
//   - `publishToDir` RECHAZA `data-slot-path=`
//   - el horneado de fotos necesita `data-ol-photo`
//   - un href sin esquema es relativo, y una ruta desconocida sirve la HOME
//     con un 200 — el enlace se rompe EN SILENCIO ([[caddy-broken-links-serve-home]])
//   - `npm run contract:lint` exige el vocabulario de tokens, y de él dependen
//     los controles de tema del editor
//
// QUÉ SE QUITÓ, y por qué no es contrato:
//   - las 9 recetas de conductas y el carrusel (9.946 car.): la CAPACIDAD es
//     real, pero enseñarla entera en cada página es enseñar markup. Si este
//     contrato gana, van inyectadas SÓLO cuando el brief pide ese
//     comportamiento.
//   - "landing pages" / "public marketing pages": encuadra el género y activa
//     el prior de conversión incluso para un ensayo o una carta.
//   - "lift-on-hover 50-150ms", "una modalidad por página": gusto nuestro.
//   - los ejemplos (taquería, tacos al pastor, portafolio): ceban el contenido.
//
// Sin las palabras `landing`, `marketing`, `nav`, `hero`, `card`, `CTA` ni
// `footer`, y sin un solo ejemplo de HTML.

export const PUBLISH_CONTRACT_MIN = `LO QUE LA PUBLICACIÓN IMPONE

Nada de esto habla de cómo debe verse la página. Son las condiciones para que el documento sobreviva al publicarse.

• UN documento \`<!doctype html>\` completo y autocontenido. Nada de JSX ni de marcado de ningún framework. El primer carácter de tu respuesta es \`<\` y el último es el cierre de \`</html>\`: sin preámbulo, sin notas, sin vallas de markdown.
• Tailwind por CDN: \`<script src="https://cdn.tailwindcss.com"></script>\` en el \`<head>\`.
• Google Fonts por \`<link rel="stylesheet" href="https://fonts.googleapis.com/…">\` en el \`<head>\`. Cualquier familia del catálogo vale; carga todas las que uses.
• Tu CSS propio va en un \`<style>\` dentro del \`<head>\`.
• NINGÚN JavaScript sobrevive. Todo \`<script>\` —salvo el de Tailwind— y todo atributo \`on*\` se BORRAN antes de guardar el documento. Lo que deba moverse o responder se resuelve sin código: \`<details>\`/\`<summary>\`, un checkbox oculto con \`peer-checked:\`, \`:target\`, \`@keyframes\`, \`transition\`. Un control que sólo funcionaría con un script llega muerto.
• NINGÚN \`<iframe>\` sobrevive: también se borra. Hay DOS excepciones y ninguna necesita iframe, sólo un \`<a href>\` normal que se transforma al publicar:
  – VÍDEO: un enlace a YouTube o Vimeo se convierte en reproductor dentro de la página.
  – MAPA: un enlace a \`https://maps.google.com/?q=<dirección>\` se convierte en un mapa que se abre al pulsar. Si el negocio tiene dirección física, ponla así donde des el contacto — un negocio local sin mapa está a medias.
  Para cualquier otra cosa (Spotify, Calendly, reservas de terceros), no finjas un embebido.
• Ningún atributo \`data-slot-path=\` en ninguna parte.
• Ninguna interfaz de acceso, registro o cuenta: estas páginas no tienen aplicación detrás, así que un enlace de entrada no lleva a ningún sitio.

IMÁGENES
• Ilustraciones, marcas e iconos: SVG en línea.
• Para una FOTOGRAFÍA, un \`<div>\` con degradado y el atributo \`data-ol-photo="<sujeto en 2-4 palabras>"\` diciendo qué muestra. Después de generar se sustituye por una foto real, así que sé concreto. Marca sólo cajas que son puramente imagen, sin texto ni botones dentro.
• Ninguna URL de imagen externa.

ENLACES
• Cualquier dirección que traiga el brief es un dato real: cópiala literal, carácter por carácter. Absoluta y con esquema — \`instagram.com/x\` se escribe \`https://instagram.com/x\`, un correo va con \`mailto:\`.
• Un \`href\` sin esquema es una ruta relativa, y una ruta desconocida devuelve la portada con un 200 en vez de un error: el enlace se rompe sin que nadie lo note.
• Si el brief no da destino, \`href="#"\`. No inventes cuentas, direcciones, correos ni teléfonos.

COLOR, FORMA Y TIPOGRAFÍA — vocabulario obligatorio
Todo color, radio y familia sale de una propiedad personalizada de CSS, declarada en \`:root\` y usada con \`var()\`. Nunca repitas un color literal por la página.
  Fondo  : --bg · --surface · --surface-2
  Texto  : --fg · --fg-muted · --fg-faint
  Línea  : --border · --border-strong
  Acento : --accent · --accent-r (su tripleta R,G,B) · --accent-ink (lo que va ENCIMA del acento)
  Forma  : --radius
  Letra  : --font-display · --font-body · --font-mono
Nada de literales \`#rrggbb\` fuera de los bloques \`:root\`. Emite también \`:root.dark { … }\` redefiniendo esos tokens con valores oscuros pensados a mano, no una inversión mecánica.

TAMAÑO
• Legible y usable desde 360 px de ancho.

OFICIO
Nada de esto dice qué secciones lleva la página ni en qué orden. Es el nivel de acabado que se espera de cualquier cosa que publiques.
• Profundidad: las superficies elevadas se separan del fondo con sombra suave, nunca con un borde brillante. Los separadores son de un pelo, a la alfa baja de \`--border\`.
• UN solo acento, usado poco. Un acento que aparece en todas partes deja de ser un acento.
• Tipografía con carácter: empareja una familia de titulares con otra de lectura, y que la de titulares lleve la personalidad de este encargo — un taller mecánico, una librería de viejo y un panel financiero no se letran igual. Sin fuentes por defecto.
• Ritmo: espacio vertical generoso entre bloques, y texto de lectura que no pase de unos 65 caracteres por línea.
• UNA modalidad por página — oscura, clara o crema — elegida por lo que el encargo sugiere. Emite igualmente el bloque oscuro para que el editor pueda conmutar, pero NO pongas un botón visible de cambio de tema: nadie que entre a la página de un negocio espera encontrarlo.`;
