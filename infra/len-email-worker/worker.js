// LEN POR CORREO — el Worker de correo de Cloudflare (Email Routing → este
// Worker). Recibe el correo que llega a `len-…@<LEN_EMAIL_DOMAIN>`, lo lee y
// se lo manda a OpenLen (`/api/len-email/inbound`), que decide todo lo demás:
// de quién es, si es de verdad suyo y qué le pide a Len. Aquí no se decide nada.
import PostalMime from "postal-mime";

/** La PRIMERA cabecera con ese nombre: la que puso el último salto (Cloudflare).
 *  `message.headers.get` las junta todas con comas; por eso se leen de postal-mime. */
function first(headers, name) {
  return headers.find((h) => h.key === name)?.value ?? null;
}

export default {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    const mail = await PostalMime.parse(raw);
    const res = await fetch(env.OPENLEN_INBOUND_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.LEN_EMAIL_INBOUND_TOKEN}`,
      },
      body: JSON.stringify({
        to: message.to,
        from: message.headers.get("from") ?? message.from,
        subject: mail.subject ?? "",
        text: mail.text ?? "",
        messageId: mail.messageId ?? null,
        authenticationResults: first(mail.headers, "authentication-results"),
        arcAuthenticationResults: first(mail.headers, "arc-authentication-results"),
        autoSubmitted: first(mail.headers, "auto-submitted"),
        precedence: first(mail.headers, "precedence"),
        listId: first(mail.headers, "list-id"),
      }),
    });
    // Un fallo NUESTRO (5xx) se rechaza para que el remitente se entere; lo que
    // OpenLen ignora a propósito vuelve 200 y se traga sin rebote.
    if (res.status >= 500) message.setReject("OpenLen could not take this message right now. Try again later.");
  },
};
