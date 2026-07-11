import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal-page";
import { Link } from "@/i18n/navigation";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://openlen.com";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const es = locale === "es";
  return {
    title: es ? "Documentación" : "Documentation",
    description: es
      ? "Guía paso a paso para crear, editar, publicar y exportar tu landing page con OpenLen, sin escribir código."
      : "Step-by-step guide to create, edit, publish, and export your landing page with OpenLen, no coding required.",
    alternates: { canonical: `${SITE_URL}/${locale}/docs` },
  };
}

export default async function DocsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const es = locale === "es";

  return (
    <LegalPage
      title={es ? "Documentación" : "Documentation"}
      updated={
        es
          ? "Última actualización: 10 de julio de 2026"
          : "Last updated: July 10, 2026"
      }
    >
      {es ? (
        <>
          <p>
            OpenLen es un creador de landing pages con IA. Describes tu página,
            la editas hasta dejarla a tu gusto y la publicas en internet — sin
            escribir código. Esta guía te lleva paso a paso, pensada para
            creadores sin perfil técnico.
          </p>

          <h2>1. Crea una página</h2>
          <p>Hay tres formas de empezar. Elige la que más te convenga:</p>
          <ul>
            <li>
              <strong>Descríbela a la IA</strong> — escribe en lenguaje natural
              qué página quieres (por ejemplo, &quot;una landing para mi
              cafetería con menú y horarios&quot;) y la IA genera un documento
              HTML completo listo para editar.
            </li>
            <li>
              <strong>Elige una plantilla</strong> — abre la galería de
              plantillas, previsualiza la que te guste y úsala como punto de
              partida.
            </li>
            <li>
              <strong>Pega tu propio HTML</strong> — si ya tienes una página
              hecha, pega el HTML y OpenLen la importa como un proyecto editable.
            </li>
          </ul>
          <p>
            En todos los casos terminas con un proyecto que puedes seguir
            editando y publicar cuando quieras.
          </p>

          <h2>2. Edita tu página</h2>
          <p>
            Dentro del espacio de trabajo tienes tres maneras de modificar la
            página, que puedes combinar:
          </p>
          <ul>
            <li>
              <strong>Edición de contenido en la página</strong> — haz clic
              sobre el texto para reescribirlo directamente, reordena secciones
              y reemplaza imágenes sin salir de la vista previa.
            </li>
            <li>
              <strong>Chat con IA</strong> — pídele a la IA que rediseñe o
              ajuste la página con instrucciones en lenguaje natural (por
              ejemplo, &quot;hazla más minimalista&quot; o &quot;cambia el tono a
              algo más formal&quot;). La IA reescribe la parte que indiques.
            </li>
            <li>
              <strong>Inspector</strong> — abre el panel de propiedades para
              afinar detalles por elemento (enlaces, texto alternativo, SEO) y
              controles globales de tema como radio de bordes, tipografía y color
              de acento.
            </li>
            <li>
              <strong>Editor de imágenes</strong> — recorta, ajusta y quita el
              fondo de tus fotos sin salir de OpenLen.
            </li>
          </ul>

          <h2>3. Publica en un subdominio gratuito</h2>
          <p>
            Cuando tu página esté lista, pulsa Publicar. Elige un nombre y
            quedará en vivo en tu subdominio gratuito
            &lt;nombre&gt;.openlen.com. Cada vez que vuelvas a publicar se
            actualiza esa misma dirección con tu versión más reciente.
          </p>

          <h2>4. Conecta un dominio propio</h2>
          <p>
            ¿Prefieres tu propia dirección? Conecta un dominio personalizado
            desde el proyecto. OpenLen te da un registro DNS de verificación
            (TXT) que añades en tu proveedor de dominios para probar que es tuyo;
            una vez verificado, tu página se sirve desde tu dominio.
          </p>

          <h2>5. Exporta a Vercel o GitHub</h2>
          <p>
            Si quieres alojar la página en tu propia infraestructura, ábrela,
            pulsa Publicar y elige Vercel o GitHub. Conecta tu cuenta una sola
            vez, escribe un nombre y despliega. Volver a desplegar actualiza el
            mismo destino. OpenLen guarda un token de acceso cifrado para esa
            conexión; puedes desconectarla cuando quieras y el token se elimina.
          </p>

          <h2>6. Activa módulos: reservas, pedidos y más</h2>
          <p>
            Tu página puede hacer más que informar. Desde el espacio de trabajo
            activa módulos y cada uno se convierte en una sección o página a
            juego con tu marca:
          </p>
          <ul>
            <li>
              <strong>Reservas</strong> — agenda de citas en tu página, con
              recordatorios por correo.
            </li>
            <li>
              <strong>Pedidos por WhatsApp</strong> — catálogo con carrito; el
              pedido te llega directo a WhatsApp, sin pasarela de pago.
            </li>
            <li>
              <strong>Miembros y cuentas</strong> — área privada para tu
              comunidad, con inicio de sesión para tus visitantes.
            </li>
            <li>
              <strong>Comentarios y chat</strong> — comentarios en tu página y
              mensajería privada con tus visitantes.
            </li>
          </ul>

          <h2>7. Haz crecer tu página</h2>
          <ul>
            <li>
              <strong>Analíticas y leads</strong> — cada página publicada
              incluye analíticas respetuosas con la privacidad y formularios
              cuyos envíos se guardan y te llegan por correo al instante.
            </li>
            <li>
              <strong>Page Coach</strong> — lee tu embudo (visitas → clics →
              leads) y te sugiere qué mejorar para convertir más.
            </li>
            <li>
              <strong>Marketing Kit</strong> — publicaciones listas para redes
              sociales, a juego con tu página: misma paleta, misma tipografía.
            </li>
            <li>
              <strong>Publica en varios idiomas</strong> — traduce tu página con
              un clic; cada idioma se publica con su propia URL y las etiquetas
              correctas para los buscadores.
            </li>
            <li>
              <strong>Varias páginas</strong> — añade páginas internas (menú,
              catálogo, contacto) bajo el mismo sitio.
            </li>
          </ul>

          <h2>8. Créditos de IA y el plan Pro</h2>
          <p>
            Las funciones de IA (generar y rediseñar páginas) se miden en
            créditos:
          </p>
          <ul>
            <li>
              <strong>Plan gratis</strong> — 20 créditos al mes.
            </li>
            <li>
              <strong>Plan Pro</strong> — US$7 al mes con 150 créditos al mes.
            </li>
          </ul>
          <p>
            Los créditos se reinician cada mes y no se acumulan. Si cancelas el
            plan Pro, conservas el acceso hasta el final del periodo pagado y
            luego vuelves al plan gratis; los créditos no usados se pierden al
            bajar de plan o cancelar. Los pagos los gestiona Polar como
            comerciante registrado (Merchant of Record): Polar emite la factura y
            los reembolsos se solicitan a través de Polar según sus términos de
            compra. Si necesitas ayuda, escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>

          <h2>Preguntas frecuentes</h2>
          <p>
            <strong>¿Necesito saber programar?</strong> No. Puedes crear, editar
            y publicar todo sin escribir código; la IA hace el trabajo pesado.
          </p>
          <p>
            <strong>¿Puedo confiar en lo que genera la IA?</strong> Revisa
            siempre el resultado antes de publicar. El HTML generado por IA puede
            contener errores o imprecisiones y no se garantizan los resultados.
          </p>
          <p>
            <strong>¿La página es mía?</strong> Sí. Puedes editarla, publicarla
            en tu subdominio, conectar tu propio dominio o exportarla a tu cuenta
            de Vercel o GitHub.
          </p>
          <p>
            <strong>¿Qué datos se recopilan?</strong> Consulta la{" "}
            <Link href="/privacy">política de privacidad</Link> y los{" "}
            <Link href="/terms">términos del servicio</Link>.
          </p>

          <h2>Contacto</h2>
          <p>
            ¿Tienes dudas o necesitas ayuda? Escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>
        </>
      ) : (
        <>
          <p>
            OpenLen is an AI landing-page builder. You describe a page, edit it
            until it feels right, and publish it to the web — no coding required.
            This guide walks you through it step by step, written for
            non-technical creators.
          </p>

          <h2>1. Create a page</h2>
          <p>There are three ways to start. Pick whichever suits you:</p>
          <ul>
            <li>
              <strong>Describe it to the AI</strong> — write in plain language
              what you want (for example, &quot;a landing page for my coffee shop
              with a menu and hours&quot;) and the AI generates a complete HTML
              document ready to edit.
            </li>
            <li>
              <strong>Pick a template</strong> — open the template gallery,
              preview one you like, and use it as a starting point.
            </li>
            <li>
              <strong>Paste your own HTML</strong> — already have a page? Paste
              the HTML and OpenLen imports it as an editable project.
            </li>
          </ul>
          <p>
            In every case you end up with a project you can keep editing and
            publish whenever you like.
          </p>

          <h2>2. Edit your page</h2>
          <p>
            Inside the workspace you have three ways to change the page, and you
            can mix them freely:
          </p>
          <ul>
            <li>
              <strong>In-place content editing</strong> — click on text to
              rewrite it directly, reorder sections, and swap images without
              leaving the preview.
            </li>
            <li>
              <strong>AI Chat</strong> — ask the AI to redesign or adjust the
              page with plain-language instructions (for example, &quot;make it
              more minimal&quot; or &quot;change the tone to something more
              formal&quot;). The AI rewrites the part you point it at.
            </li>
            <li>
              <strong>Inspector</strong> — open the properties panel to fine-tune
              per-element details (links, alt text, SEO) and global theme
              controls like border radius, typography, and accent color.
            </li>
            <li>
              <strong>Image editor</strong> — crop, adjust, and remove the
              background from your photos without leaving OpenLen.
            </li>
          </ul>

          <h2>3. Publish to a free subdomain</h2>
          <p>
            When your page is ready, click Publish. Choose a name and it goes
            live on your free &lt;name&gt;.openlen.com subdomain. Each time you
            publish again, that same address updates with your latest version.
          </p>

          <h2>4. Connect a custom domain</h2>
          <p>
            Prefer your own address? Connect a custom domain from the project.
            OpenLen gives you a DNS verification record (TXT) that you add at your
            domain provider to prove ownership; once verified, your page is served
            from your domain.
          </p>

          <h2>5. Export to Vercel or GitHub</h2>
          <p>
            If you want to host the page on your own infrastructure, open it,
            click Publish, and choose Vercel or GitHub. Connect your account once,
            pick a name, and deploy. Re-deploying updates the same target. OpenLen
            stores an encrypted access token for that connection; you can
            disconnect it any time and the token is deleted.
          </p>

          <h2>6. Turn on modules: bookings, orders, and more</h2>
          <p>
            Your page can do more than inform. From the workspace, switch on
            modules and each becomes a section or page matched to your brand:
          </p>
          <ul>
            <li>
              <strong>Bookings</strong> — appointment scheduling on your page,
              with email reminders.
            </li>
            <li>
              <strong>WhatsApp orders</strong> — a catalog with a cart; orders
              land directly in your WhatsApp, no payment gateway needed.
            </li>
            <li>
              <strong>Members and accounts</strong> — a private area for your
              community, with visitor sign-in.
            </li>
            <li>
              <strong>Comments and chat</strong> — comments on your page and
              private messaging with your visitors.
            </li>
          </ul>

          <h2>7. Grow your page</h2>
          <ul>
            <li>
              <strong>Analytics and leads</strong> — every published page
              includes privacy-first analytics and lead forms whose submissions
              are stored and emailed to you instantly.
            </li>
            <li>
              <strong>Page Coach</strong> — reads your funnel (visits → clicks
              → leads) and suggests what to improve to convert more.
            </li>
            <li>
              <strong>Marketing Kit</strong> — ready-to-post social graphics
              matched to your page: same palette, same typography.
            </li>
            <li>
              <strong>Publish in multiple languages</strong> — translate your
              page in one click; each language gets its own URL with the right
              tags for search engines.
            </li>
            <li>
              <strong>Multiple pages</strong> — add inner pages (menu, catalog,
              contact) under the same site.
            </li>
          </ul>

          <h2>8. AI credits and the Pro plan</h2>
          <p>
            AI features (generating and redesigning pages) are metered in
            credits:
          </p>
          <ul>
            <li>
              <strong>Free plan</strong> — 20 credits per month.
            </li>
            <li>
              <strong>Pro plan</strong> — US$7 per month with 150 credits per
              month.
            </li>
          </ul>
          <p>
            Credits reset every month and do not roll over. If you cancel Pro,
            you keep access until the end of the paid period and then revert to
            the free plan; unused credits are forfeited on downgrade or cancel.
            Payments are handled by Polar as the Merchant of Record: Polar issues
            the invoice and refunds are requested through Polar per its buyer
            terms. If you need help, reach us at{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>

          <h2>Frequently asked questions</h2>
          <p>
            <strong>Do I need to know how to code?</strong> No. You can create,
            edit, and publish everything without writing code; the AI does the
            heavy lifting.
          </p>
          <p>
            <strong>Can I trust what the AI generates?</strong> Always review the
            output before publishing. AI-generated HTML may contain errors or
            inaccuracies, and results are not guaranteed.
          </p>
          <p>
            <strong>Is the page mine?</strong> Yes. You can edit it, publish it
            to your subdomain, connect your own domain, or export it to your
            Vercel or GitHub account.
          </p>
          <p>
            <strong>What data is collected?</strong> See the{" "}
            <Link href="/privacy">privacy policy</Link> and the{" "}
            <Link href="/terms">terms of service</Link>.
          </p>

          <h2>Contact</h2>
          <p>
            Questions or need help? Reach us at{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>
        </>
      )}
    </LegalPage>
  );
}
