# Len por correo — cómo se enciende

Un correo a `len-<proyecto>-<firma>@reply.openlen.com` es un mensaje a Len en ese
proyecto. La dirección sale en el diálogo «Compartir» de cada proyecto
(`lib/len-email/address.ts`), y cada respuesta de Len sale con ella como
`Reply-To`, así que basta con contestar.

```
remitente ──► Cloudflare Email Routing (reply.openlen.com, MX)
                └─► este Worker (postal-mime lee el MIME)
                      └─► POST https://openlen.com/api/len-email/inbound  (Bearer)
                            ├─ ¿automático? ¿firma de la dirección? ¿DKIM/DMARC?
                            ├─ ¿el remitente es el dueño o un editor?
                            └─► turno de Len en el servidor ──► respuesta por Resend
```

Sin `LEN_EMAIL_DOMAIN` la función está apagada: no hay dirección en «Compartir».
Sin `LEN_EMAIL_INBOUND_TOKEN`, la ruta contesta 503.

## 1 · El servidor (Hetzner, el `.env` de la app)

```
LEN_EMAIL_DOMAIN=reply.openlen.com
LEN_EMAIL_INBOUND_TOKEN=<openssl rand -hex 32>
# Opcional: quién firma la primera Authentication-Results (por defecto mx.cloudflare.net)
# LEN_EMAIL_AUTHSERV_ID=mx.cloudflare.net
```

## 2 · Cloudflare (zona `openlen.com`)

1. **Email → Email Routing → habilitar para el subdominio `reply.openlen.com`.**
   Cloudflare pone el MX y un TXT de SPF **en `reply.`**, no en el ápice: el SPF
   de Resend del ápice no se toca (ver la memoria `correo-saliente-estado-dns`,
   trampa 2). `reply` está en `RESERVED_SUBDOMAINS` y no sirve ninguna página,
   así que perder el comodín en ese nombre (trampa 3) no tumba nada.
2. **Desplegar el Worker** (desde esta carpeta):
   ```
   npm install
   npx wrangler secret put LEN_EMAIL_INBOUND_TOKEN   # el mismo valor que en el servidor
   npx wrangler deploy
   ```
3. **Email Routing → Routing rules → Catch-all de `reply.openlen.com` → Send to a
   Worker → `openlen-len-email`.**

## 3 · Comprobarlo antes de darlo por bueno

- **La cabecera de autenticación.** El servidor sólo cree la PRIMERA
  `Authentication-Results` (o `ARC-Authentication-Results`) y sólo si la firma
  `mx.cloudflare.net`. Manda un correo de prueba desde Gmail y mira en el log
  `[len-email]`: si dice `ignorado: sin DKIM/DMARC de su dominio` con un correo
  legítimo, el receptor firma con otro nombre → ajustar `LEN_EMAIL_AUTHSERV_ID`.
- **Un remitente falso.** Manda un correo con `From:` falsificado del dueño (por
  ejemplo con `swaks` desde un servidor que no es el suyo): tiene que acabar en
  `ignorado`, nunca en un turno.
- **Un turno de punta a punta.** Contestar a la dirección desde el correo del
  dueño → Len hace el cambio → llega la respuesta en el mismo hilo del correo,
  con el enlace al proyecto.

## Límites de esta primera versión

- Sólo texto: las fotos adjuntas no llegan a Len todavía.
- La cola de turnos vive en memoria: si el servidor se reinicia a mitad de un
  turno pedido por correo, ese pedido se pierde sin respuesta (los hilos sí se
  retoman).
- 20 correos por proyecto y hora; lo que pase de ahí se ignora.
