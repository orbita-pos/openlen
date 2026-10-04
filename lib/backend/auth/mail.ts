// Los correos de /auth/v1 de verdad: sus textos (mail-texts.ts, 10 idiomas)
// por el envío de siempre (Resend).
// En desarrollo, sin clave de Resend, el correo se apunta en la consola con su
// enlace (lib/email.ts).

import "server-only";

import { sendPageAuthEmail } from "@/lib/email";
import { authEmailContent } from "./mail-texts";
import type { AuthMail } from "./config";

/** `siteHost`: el host de la página del proyecto, que es lo que reconoce quien
 *  recibe el correo. */
export async function sendAuthEmail(mail: AuthMail, siteHost: string): Promise<void> {
  const kind = mail.kind === "signup" ? "confirm" : mail.kind === "invite" ? "invite" : "recovery";
  const { subject, html, text } = authEmailContent({ kind, link: mail.link, host: siteHost, lang: mail.lang ?? null });
  await sendPageAuthEmail({ to: mail.to, subject, html, text });
}
