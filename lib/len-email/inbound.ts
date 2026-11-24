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
 *
 * 🔴 Se parte como dice el RFC 8601 (`resultClauses`), no en cada `;`: una
 * cláusula puede llevar un valor entre comillas y comentarios entre paréntesis,
 * y los dos admiten `;`. El remitente escribe la parte local de su propio MAIL
 * FROM, así que `"x;dkim=pass header.d=gmail.com y"@malo.com` salía como una
 * cláusula más y pasaba por un DKIM alineado. Es el arreglo de Hermes Agent
 * (GHSA-rxqh-5572-8m77): cada veredicto se lee de la cabeza de SU cláusula, y
 * su dominio sólo de ella, sin los comentarios.
 */
export function isAuthentic(authResults: string | null | undefined, fromAddress: string, authservId: string): boolean {
  if (!authResults) return false;
  // La de ARC (`ARC-Authentication-Results`) es igual con `i=N;` delante.
  const clauses = resultClauses(authResults.replace(/^\s*i\s*=\s*\d+\s*;/i, ""));
  // Una comilla o un paréntesis sin cerrar: no se sabe dónde acaba nada, y no se lee.
  if (!clauses) return false;
  const [server, ...results] = clauses;
  if (!server || server.split(/\s+/)[0]!.toLowerCase() !== authservId.toLowerCase()) return false;
  const fromDomain = fromAddress.slice(fromAddress.lastIndexOf("@") + 1).toLowerCase();
  const aligned = (d: string | undefined) => !!d && (fromDomain === d || fromDomain.endsWith(`.${d}`) || d.endsWith(`.${fromDomain}`));
  for (const r of results) {
    const method = /^(dmarc|dkim)\s*=\s*(\w+)/i.exec(r);
    if (!method || method[2]!.toLowerCase() !== "pass") continue;
    const kind = method[1]!.toLowerCase();
    const prop = kind === "dmarc" ? /header\.from\s*=\s*("[^"]*"|[^\s;]+)/i.exec(r) : /header\.d\s*=\s*("[^"]*"|[^\s;]+)/i.exec(r);
    if (aligned(prop?.[1]?.replace(/^"|"$/g, "").toLowerCase())) return true;
  }
  return false;
}

/** An `Authentication-Results` value cut into its clauses on the `;` that are not inside a quoted-string or a
 *  (nested) comment, trimmed. Comments are dropped — they are free text, never a verdict nor a property —, and
 *  quoted-strings are kept. `null` when a quote or a comment is not closed. */
export function resultClauses(value: string): string[] | null {
  const clauses: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === "\\" && (quoted || depth > 0)) {
      // An escaped character never opens or closes anything; inside a comment it goes with the comment.
      if (quoted) current += value.slice(i, i + 2);
      i++;
    } else if (quoted) {
      current += c;
      if (c === '"') quoted = false;
    } else if (depth > 0) {
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) current += " ";
    } else if (c === "(") {
      depth = 1;
    } else if (c === ")") {
      return null;
    } else if (c === '"') {
      quoted = true;
      current += c;
    } else if (c === ";") {
      clauses.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  if (quoted || depth > 0) return null;
  clauses.push(current.trim());
  return clauses;
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

/** A file the email came with, as the Worker describes it (infra/len-email-worker): its bytes never travel. */
export interface InboundAttachment {
  readonly filename?: string | null;
  readonly mimeType?: string | null;
  readonly size: number;
  /** Placed in the body (a pasted picture, a signature's logo) rather than attached. */
  readonly inline?: boolean;
}

/** How many attachments the context names; the rest are counted. */
const NAMED_ATTACHMENTS = 10;

/** Lo que lee el MODELO delante del pedido. Si el correo traía ficheros, los
 *  nombra: no le llegan por correo, y sin decírselo Len contestaba como si no
 *  hubiera nada («usa este logo» sin el logo). */
export function contextForModel(subject: string, attachments: readonly InboundAttachment[] = []): string {
  const s = subject.trim().replace(/\s+/g, " ").slice(0, 200);
  const files = attachments.length > 0 ? ` ${attachmentsLine(attachments)}` : "";
  return `[Sent by email${s ? ` (subject: "${s}")` : ""}. Nobody is watching the editor: your final reply is emailed back to them, so it must stand on its own — say what you changed, or ask what you need.${files}]`;
}

function attachmentsLine(attachments: readonly InboundAttachment[]): string {
  // A name is the sender's text: it can't close the bracket or start a line of its own.
  const clean = (v: string | null | undefined, max: number) => (v ?? "").replace(/[\p{Cc}"[\]<>]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
  const size = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const named = attachments.slice(0, NAMED_ATTACHMENTS).map((a) => {
    const type = clean(a.mimeType, 100);
    return `${clean(a.filename, 120) || "(no name)"} (${type ? `${type}, ` : ""}${size(a.size)}${a.inline ? ", in the body" : ""})`;
  });
  const more = attachments.length - named.length;
  return `It came with files that don't reach you by email: ${named.join(", ")}${more > 0 ? ` and ${more} more` : ""}. If you need one, ask them to add it in the project's chat in OpenLen.`;
}
