/**
 * ¿ESTE TURNO NECESITA VER LA IMAGEN, O LE BASTA LA URL?
 *
 * El Chat clásico está CIEGO a los adjuntos: recibe la URL y ni un píxel. Desde
 * `879946b2` al menos lo sabe y lo dice en vez de inventarse lo que hay en la
 * foto. Pero decirlo no es hacerlo, y hay peticiones que sin ojos no se pueden
 * cumplir: «usa los colores de esta foto», «recorta a la persona», «que la
 * página vaya con este estilo», «¿qué se ve aquí?».
 *
 * DECISIÓN de Jesús (2026-08-25): mandar los píxeles SÓLO cuando el mensaje
 * habla de la imagen. Ni siempre ni nunca.
 *
 * POR QUÉ NO SIEMPRE. Los píxeles mueven el turno al escritor con visión, y ahí
 * la salida cuesta 10x (memoria `gemini-solo-pixeles`). Medido sobre un turno
 * típico de 8k entrada / 1k salida: ~$0.0014 con el razonador contra ~$0.007
 * con visión. La acción MÁS común del adjunto —«pon esta imagen aquí»— no
 * necesita ojos para nada: colocar una imagen se hace con su URL.
 *
 * POR QUÉ NO UN PUÑADO DE PALABRAS CLAVE. OpenLen habla 10 idiomas. Una lista
 * de «colores/estilo/recorta» acierta en español y se cae en portugués, en
 * turco y en japonés, y el fallo es silencioso: el usuario pide algo que sí se
 * podía hacer y recibe un «no puedo verla».
 *
 * ASÍ QUE SE PREGUNTA, y sale prácticamente gratis: ~120 tokens de entrada y
 * uno de salida contra el razonador barato son **$0.000017** — una 333ª parte
 * de lo que ahorra evitar UN turno de visión que no hacía falta. El modelo lee
 * el mensaje en el idioma que sea, que es justo lo que una lista de palabras no
 * puede.
 *
 * FALLA HACIA EL LADO BARATO, SIEMPRE. Cualquier cosa rara —un fallo de red, un
 * plazo agotado, una respuesta que no es exactamente `SI` o `NO`— devuelve
 * `false`, y `false` es EXACTAMENTE el comportamiento de hoy: el turno sigue
 * ciego y honesto. Este módulo sólo puede mejorar el resultado o dejarlo igual;
 * no puede romperlo ni encarecerlo por accidente.
 */

/** El plazo. Un detector que tarda más que el turno que optimiza no sirve, y
 *  el suelo (seguir ciego) es aceptable, así que rendirse es barato. */
export const OJOS_TIMEOUT_MS = 2_500;

/** Los casos salen del propio bloque de prompt del Chat, no de mi cabeza: son
 *  la taxonomía que el producto ya le enseña al modelo cuando le explica qué NO
 *  puede hacer a ciegas. Preguntar con las mismas palabras con las que se
 *  enseña es lo que evita que las dos mitades se separen. */
export const OJOS_PROMPT = `You decide ONE thing: does answering the user's message require LOOKING AT the attached image's contents?

Answer SI or NO. Nothing else. No punctuation, no explanation.

SI — the request depends on what the image LOOKS like:
  colours taken from the photo · cropping around something in it · matching its
  style or mood · identifying or describing what is in it · judging whether it
  fits · writing alt text FROM the image rather than from the user's words.

NO — the request only needs the image's URL:
  placing it · positioning it (hero, background, right side, above the text) ·
  sizing or resizing it · replacing an existing image or placeholder with it ·
  removing it · uploading or storing it.

The message may be in ANY language. When it is not clear, answer NO.`;

/** Lo que dice el usuario, tal cual, más el alt si lo mandó. Se recorta porque
 *  el mensaje puede traer una página pegada dentro y esto se paga por token —
 *  y la intención, cuando existe, vive en las primeras palabras. */
export function ojosPreguntaPara(mensaje: string, alt?: string | null): string {
  const m = mensaje.trim().slice(0, 600);
  const a = alt?.trim() ? `\nAlt text the user gave: ${alt.trim().slice(0, 200)}` : "";
  return `User message: ${m}${a}`;
}

/** SÓLO un `SI` limpio cuenta. Ni «Sí, porque…», ni «yes», ni un JSON con la
 *  respuesta dentro: si el modelo se pone a conversar, la respuesta no es
 *  fiable y el suelo —seguir ciego— es perfectamente bueno. */
export function ojosDeLaRespuesta(crudo: string): boolean {
  return crudo.trim().toUpperCase().replace(/[.\s]+$/, "") === "SI";
}

export type ClasificarOjos = (args: {
  system: string;
  user: string;
  signal: AbortSignal;
}) => Promise<string>;

/**
 * `true` sólo cuando el mensaje habla de la imagen. Nunca lanza.
 *
 * El clasificador se inyecta para que la decisión se pueda probar entera sin
 * tocar la red ni gastar un céntimo — y para que el plazo viva AQUÍ, en un solo
 * sitio, en vez de repetirse en cada llamador.
 */
export async function necesitaOjos(
  mensaje: string,
  alt: string | null | undefined,
  clasificar: ClasificarOjos,
  timeoutMs = OJOS_TIMEOUT_MS,
): Promise<boolean> {
  if (!mensaje.trim()) return false;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const crudo = await clasificar({
      system: OJOS_PROMPT,
      user: ojosPreguntaPara(mensaje, alt),
      signal: abort.signal,
    });
    return ojosDeLaRespuesta(crudo);
  } catch {
    // A propósito mudo en el valor de retorno: el suelo es el comportamiento de
    // hoy. Quien llama registra el porqué si le importa.
    return false;
  } finally {
    clearTimeout(timer);
  }
}
