// Los correos de /auth/v1 de verdad: los textos de las cuentas de la página
// (lib/page-accounts/mail.ts, 10 idiomas) por el envío de siempre (Resend).
// En desarrollo, sin clave de Resend, el correo se apunta en la consola con su
// enlace (lib/email.ts).

import "server-only";

import { sendPageAccountEmail } from "@/lib/email";
import { accountEmailContent } from "@/lib/page-accounts/mail";
import type { AuthMail } from "./config";

/** `siteHost`: el host de la página del proyecto, que es lo que reconoce quien
 *  recibe el correo. */
export async function sendAuthEmail(mail: AuthMail, siteHost: string): Promise<void> {
  const kind = mail.kind === "signup" ? "confirm" : mail.kind === "invite" ? "invite" : "recovery";
  const { subject, html, text } = accountEmailContent({ kind, link: mail.link, host: siteHost, lang: mail.lang ?? null });
  await sendPageAccountEmail({ to: mail.to, subject, html, text });
}
