/**
 * LOS BOTONES DEL BORRADOR (plans/len-resultados/diseno.md §5). Puro: arman el
 * enlace que abre el correo o WhatsApp del usuario con el texto puesto. Nada
 * sale de OpenLen: lo manda el usuario desde su propio correo o su WhatsApp.
 */
const ES_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function enlaceDeCorreo(correo: string, asunto: string, texto: string): string | null {
  const c = correo.trim();
  if (!ES_CORREO.test(c)) return null;
  return `mailto:${c}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(texto)}`;
}

/** wa.me exige el número internacional. Sólo si el visitante lo dio CON lada
 *  (+… o 00…): un número sin país no se completa, porque sería adivinar. */
export function numeroDeWhatsApp(telefono: string): string | null {
  const t = telefono.trim();
  const conLada = t.startsWith("+") || t.startsWith("00");
  const digitos = t.replace(/\D/g, "").replace(/^00/, "");
  if (!conLada || digitos.length < 8 || digitos.length > 15) return null;
  return digitos;
}

export function enlaceDeWhatsApp(numero: string, texto: string): string {
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}
