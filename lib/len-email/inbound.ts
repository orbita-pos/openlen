/**
 * LEN POR CORREO — lo que se decide de un correo que llega, sin red ni base:
 * quién lo manda, si es de verdad suyo, si lo escribió una persona y qué
 * escribió (sin lo citado). Lo usa `app/api/len-email/inbound/route.ts`.
 */

/** La dirección de un `From` («Ana <ana@x.com>» o «ana@x.com»), en minúsculas. */
export function mailboxAddress(from: string): string | null {
  const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(from);
  const raw = (angle?.[1] ?? from).trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(raw) ? raw : null;
}

/**
 * ¿Lo mandó una máquina? Respuestas automáticas («estoy de vacaciones»),
 * rebotes y listas: contestarles haría un bucle con Len (RFC 3834).
 */
export function isAutomatic(h: {
  readonly from: string;
  readonly autoSubmitted?: string | null;
  readonly precedence?: string | null;
  readonly listId?: string | null;
}): boolean {
  const auto = h.autoSubmitted?.trim().toLowerCase();
  if (auto && auto !== "no") return true;
  if (/^(bulk|list|junk|auto_reply)$/i.test(h.precedence?.trim() ?? "")) return true;
  if (h.listId?.trim()) return true;
  return /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i.test(mailboxAddress(h.from) ?? "");
}

/**
 * ¿El correo es de verdad de su `From`? El `From` se falsifica; la firma no.
 * Se lee SÓLO la primera cabecera `Authentication-Results` —la que puso el
 * último salto, nuestro receptor— y sólo si la firmó él (`authservId`): las de
 * más abajo las pudo escribir el remitente. Vale `dmarc=pass`, o un
 * `dkim=pass` alineado con el dominio del `From`. SPF solo no basta: no dice
 * nada del `From`.
 */
export function isAuthentic(authResults: string | null | undefined, fromAddress: string, authservId: string): boolean {
  if (!authResults) return false;
  // La de ARC (`ARC-Authentication-Results`) es igual con `i=N;` delante.
  const [server, ...results] = authResults.replace(/^\s*i\s*=\s*\d+\s*;/i, "").split(";").map((p) => p.trim());
  if (!server || server.split(/\s+/)[0]!.toLowerCase() !== authservId.toLowerCase()) return false;
  const fromDomain = fromAddress.slice(fromAddress.lastIndexOf("@") + 1).toLowerCase();
  const aligned = (d: string | undefined) => !!d && (fromDomain === d || fromDomain.endsWith(`.${d}`) || d.endsWith(`.${fromDomain}`));
  for (const r of results) {
    const method = /^(dmarc|dkim)\s*=\s*(\w+)/i.exec(r);
    if (!method || method[2]!.toLowerCase() !== "pass") continue;
    const kind = method[1]!.toLowerCase();
    const prop = kind === "dmarc" ? /header\.from\s*=\s*([^\s;]+)/i.exec(r) : /header\.d\s*=\s*([^\s;]+)/i.exec(r);
    if (aligned(prop?.[1]?.toLowerCase())) return true;
  }
  return false;
}

// «El jue, 9 oct 2026 a las 10:00, Len <…> escribió:» y sus primos: donde
// empieza lo citado. Gmail lo parte a veces en dos líneas.
const QUOTE_HEADER = /^(On|El|Em|Le|Am|Il giorno|Op)\s.+(wrote|escribió|escreveu|a écrit|schrieb|ha scritto|schreef)\s*:\s*$/i;
const SEPARATOR = /^(-{2,}\s*(Original Message|Mensaje original|Mensagem original|Message d'origine|Ursprüngliche Nachricht|Forwarded message|Mensaje reenviado)|_{8,}\s*$)/i;
const OUTLOOK_FROM = /^\*?(From|De|Von|Da|Van):\*?\s/i;
const OUTLOOK_NEXT = /^\*?(Sent|Enviado|Date|Fecha|Gesendet|Envoyé|Inviato|Verzonden|To|Para|An|À|A|Aan):\*?\s/i;

/** Lo que la persona escribió, sin lo citado ni la firma. */
export function newReplyText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    const joined = `${t} ${(lines[i + 1] ?? "").trim()}`;
    if (QUOTE_HEADER.test(t) || (/^(On|El|Em|Le|Am|Il giorno|Op)\s/i.test(t) && QUOTE_HEADER.test(joined))) break;
    if (SEPARATOR.test(t)) break;
    if (OUTLOOK_FROM.test(t) && lines.slice(i + 1, i + 4).some((l) => OUTLOOK_NEXT.test(l.trim()))) break;
    if (/^--\s?$/.test(line)) break;
    if (t.startsWith(">")) continue;
    kept.push(line.trimEnd());
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// El idioma de lo escrito vive en `lib/language/detect.ts` (también lo usa el chat).
export { detectLanguage } from "@/lib/language/detect";

/** Lo que lee el MODELO delante del pedido. */
export function contextForModel(subject: string): string {
  const s = subject.trim().replace(/\s+/g, " ").slice(0, 200);
  return `[Sent by email${s ? ` (subject: "${s}")` : ""}. Nobody is watching the editor: your final reply is emailed back to them, so it must stand on its own — say what you changed, or ask what you need.]`;
}
