/**
 * LEN POR CORREO — lo que se decide de un correo que llega, sin red ni base:
 * quién lo manda, si es de verdad suyo, si lo escribió una persona y qué
 * escribió (sin lo citado). Lo usa `app/api/len-email/inbound/route.ts`.
 */
import type { IdiomaDelCorreo } from "@/lib/projects/correos-del-proyecto";

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

const STOPWORDS: Readonly<Record<Exclude<IdiomaDelCorreo, "ja" | "ko" | "zh">, readonly string[]>> = {
  es: ["que", "el", "la", "los", "las", "por", "para", "con", "una", "del", "pon", "cambia", "quita", "también", "página", "precio", "gracias"],
  pt: ["que", "não", "uma", "com", "para", "você", "mais", "também", "página", "obrigado", "coloca", "muda", "do", "da"],
  en: ["the", "and", "please", "with", "change", "add", "remove", "page", "price", "can", "you", "thanks", "make", "to"],
  fr: ["le", "les", "des", "une", "avec", "pour", "est", "pas", "merci", "change", "ajoute", "dans", "sur"],
  de: ["der", "die", "das", "und", "bitte", "mit", "nicht", "ist", "ein", "eine", "auf", "danke", "ändere"],
  it: ["il", "che", "per", "con", "una", "non", "della", "grazie", "cambia", "aggiungi", "anche", "sono"],
  nl: ["de", "het", "een", "en", "van", "niet", "met", "voor", "bedankt", "graag", "verander", "ook"],
};

/** El idioma de lo escrito, para lo que dice el servidor (Len contesta en el
 *  que le hablen). Sin señal clara, inglés, como `idiomaDelCorreo`. */
export function detectLanguage(text: string): IdiomaDelCorreo {
  if (/[぀-ヿ]/.test(text)) return "ja";
  if (/[가-힯]/.test(text)) return "ko";
  if (/[一-鿿]/.test(text)) return "zh";
  if (/[¿¡ñ]/i.test(text)) return "es";
  const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  let best: IdiomaDelCorreo = "en";
  let bestScore = 0;
  for (const [lang, list] of Object.entries(STOPWORDS) as [IdiomaDelCorreo, readonly string[]][]) {
    const set = new Set(list);
    const score = words.filter((w) => set.has(w)).length;
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return best;
}

/** Lo que lee el MODELO delante del pedido. */
export function contextForModel(subject: string): string {
  const s = subject.trim().replace(/\s+/g, " ").slice(0, 200);
  return `[Sent by email${s ? ` (subject: "${s}")` : ""}. Nobody is watching the editor: your final reply is emailed back to them, so it must stand on its own — say what you changed, or ask what you need.]`;
}
