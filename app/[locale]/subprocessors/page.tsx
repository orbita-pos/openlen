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
    title: es ? "Subprocesadores" : "Subprocessors",
    description: es
      ? "Los terceros (subprocesadores) que pueden tratar datos de usuarios o visitantes al prestar OpenLen."
      : "The third parties (subprocessors) that may process user or visitor data when providing OpenLen.",
    alternates: { canonical: `${SITE_URL}/${locale}/subprocessors` },
  };
}

export default async function SubprocessorsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const es = locale === "es";

  return (
    <LegalPage
      title={es ? "Subprocesadores" : "Subprocessors"}
      updated={es ? "Última actualización: 30 de mayo de 2026" : "Last updated: May 30, 2026"}
    >
      {es ? (
        <>
          <p>
            Esta página acompaña nuestra{" "}
            <Link href="/privacy">Política de privacidad</Link> y enumera a los
            terceros (subprocesadores) que pueden tratar datos de usuarios o de
            visitantes al prestar OpenLen, el creador de landing pages en
            openlen.com. El responsable que opera OpenLen es{" "}
            <strong>Jesús Bernal</strong>, con sede en
            México; para cualquier asunto relacionado con esta lista, escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. Para cada
            proveedor indicamos su finalidad, las categorías de datos que recibe y
            su región.
          </p>
          <p>
            El almacenamiento de objetos puede estar en Cloudflare R2 (cuando está
            habilitado) o en el sistema de archivos local del servidor
            autohospedado. Las exportaciones a Vercel y a GitHub solo ocurren
            cuando el propio usuario las inicia (al conectar la cuenta y elegir
            publicar); no enviamos datos a esos servicios de forma automática.
          </p>

          <h2>Infraestructura</h2>
          <ul>

            <li>
              <strong>Cloudflare R2</strong> — almacenamiento de objetos para
              activos y HTML de páginas, cuando está habilitado (de lo contrario,
              se usa el sistema de archivos local del servidor autohospedado).
              Datos: HTML de páginas, imágenes y otros archivos del usuario.
              Región: Estados Unidos / global.
            </li>
            <li>
              <strong>Cloudflare</strong> — DNS, CDN, geolocalización mediante la
              cabecera CF-IPCountry y purga de caché. Datos: metadatos de la
              solicitud (incluido el país de dos letras del visitante). Región:
              global (sede en Estados Unidos).
            </li>
            <li>
              <strong>Hetzner</strong> — servidor de la aplicación donde se
              ejecuta OpenLen y donde vive su base de datos Postgres. Datos:
              cuenta, contenido de proyectos, registros de envíos de formularios,
              analítica, y todos los datos en tránsito y en procesamiento del
              servicio. Región: Alemania.
            </li>
          </ul>

          <h2>Pagos</h2>
          <ul>
            <li>
              <strong>Polar</strong> (Polar Software Inc.) — comerciante
              registrado (Merchant of Record) que procesa la facturación y el pago.
              Polar trata los datos financieros y patrimoniales del pago, emite la
              factura y recauda los impuestos aplicables; OpenLen solo conserva el
              estado de la suscripción y el plan, y <strong>nunca</strong> guarda
              números de tarjeta. Datos: correo, datos de facturación y de pago,
              datos de residencia fiscal y estado de la suscripción. Región:
              Estados Unidos.
            </li>
          </ul>

          <h2>IA</h2>
          <ul>
            <li>
              <strong>Fireworks AI</strong> (api.fireworks.ai) — generación y
              edición de páginas con IA, y revisión por visión. Datos: el texto
              del brief del usuario, el HTML de la página, y capturas e imágenes
              de referencia. Región: Estados Unidos.
            </li>
            <li>
              <strong>OpenAI</strong> (api.openai.com) — edición de imágenes con
              IA. Datos: la imagen que el usuario edita y su instrucción de
              texto. Región: Estados Unidos.
            </li>
          </ul>

          <h2>Correo</h2>
          <ul>
            <li>
              <strong>Resend</strong> — envío de correo transaccional y de avisos
              de leads. Datos: direcciones de correo de destinatarios y el
              contenido de los avisos (por ejemplo, envíos de formularios).
              Región: Estados Unidos.
            </li>
          </ul>

          <h2>Imágenes</h2>
          <ul>
            <li>
              <strong>Unsplash</strong> — búsqueda de fotografías de stock. Datos:
              los términos de búsqueda y los identificadores de las fotos
              seleccionadas. Región: Estados Unidos.
            </li>
          </ul>

          <h2>Exportación iniciada por el usuario</h2>
          <ul>
            <li>
              <strong>Vercel</strong> — solo cuando el usuario decide exportar.
              Datos: el HTML de la página a desplegar. Región: Estados Unidos.
            </li>
            <li>
              <strong>GitHub</strong> — solo cuando el usuario decide exportar.
              Datos: el HTML de la página a publicar. Región: Estados Unidos.
            </li>
          </ul>

          <h2>Monitoreo de errores</h2>
          <ul>
            <li>
              <strong>InariWatch</strong> (<code>@inariwatch/capture</code>) —
              captura de errores en el servidor. InariWatch es un producto
              hermano del <strong>mismo operador</strong> que opera OpenLen, por lo
              que se trata de captura de errores de primera parte y{" "}
              <strong>no</strong> de un tercero independiente. Datos: trazas de
              error técnicas y metadatos de la solicitud asociada. Región: Estados
              Unidos.
            </li>
          </ul>

          <h2>Inicio de sesión (OAuth)</h2>
          <ul>
            <li>
              <strong>Google</strong> — proveedor de inicio de sesión OAuth.
              Datos: tu correo, nombre y URL de imagen de perfil (según los
              permisos que apruebes). Región: Estados Unidos.
            </li>
          </ul>

          <h2>Contacto</h2>
          <p>
            ¿Dudas sobre esta lista? Escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. Consulta
            también nuestra <Link href="/privacy">Política de privacidad</Link>.
          </p>
        </>
      ) : (
        <>
          <p>
            This page supports our <Link href="/privacy">Privacy Policy</Link> and
            lists the third parties (subprocessors) that may process user or
            visitor data when we provide OpenLen, the landing-page builder at
            openlen.com. The party operating OpenLen is{" "}
            <strong>Jesús Bernal</strong>, based in Mexico;
            for any matter related to this list, email{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. For each
            provider we state its purpose, the categories of data it receives, and
            its region.
          </p>
          <p>
            Object storage may be Cloudflare R2 (when enabled) or the local
            filesystem on the self-hosted server. Exports to Vercel and GitHub
            happen only when the user initiates them (by connecting the account and
            choosing to publish); we do not send data to those services
            automatically.
          </p>

          <h2>Infrastructure</h2>
          <ul>

            <li>
              <strong>Cloudflare R2</strong> — object storage for assets and page
              HTML, when enabled (otherwise the local filesystem on the
              self-hosted server is used). Data: page HTML, images, and other user
              files. Region: United States / global.
            </li>
            <li>
              <strong>Cloudflare</strong> — DNS, CDN, CF-IPCountry geolocation
              header, and cache purge. Data: request metadata (including the
              visitor&apos;s two-letter country). Region: global (HQ in the United
              States).
            </li>
            <li>
              <strong>Hetzner</strong> — the application server that runs OpenLen
              and hosts its Postgres database. Data: account data, project
              content, form-submission records, analytics, and all service data in
              transit and in processing. Region: Germany.
            </li>
          </ul>

          <h2>Payments</h2>
          <ul>
            <li>
              <strong>Polar</strong> (Polar Software Inc.) — Merchant of Record
              that processes billing and payment. Polar processes the financial
              and patrimonial payment data, issues the invoice, and collects any
              applicable tax; OpenLen retains only the subscription status and
              plan, and <strong>never</strong> stores card numbers. Data: email,
              billing and payment data, tax-residence data, and subscription
              status. Region: United States.
            </li>
          </ul>

          <h2>AI</h2>
          <ul>
            <li>
              <strong>Fireworks AI</strong> (api.fireworks.ai) — AI page
              generation and editing, and vision review. Data: the user&apos;s
              brief text, page HTML, and reference screenshots and images.
              Region: United States.
            </li>
            <li>
              <strong>OpenAI</strong> (api.openai.com) — AI image editing. Data:
              the image the user is editing and their text instruction. Region:
              United States.
            </li>
          </ul>

          <h2>Email</h2>
          <ul>
            <li>
              <strong>Resend</strong> — transactional and lead-notification email.
              Data: recipient email addresses and notification content (for
              example, form submissions). Region: United States.
            </li>
          </ul>

          <h2>Images</h2>
          <ul>
            <li>
              <strong>Unsplash</strong> — stock-photo search. Data: search queries
              and the IDs of selected photos. Region: United States.
            </li>
          </ul>

          <h2>User-initiated export</h2>
          <ul>
            <li>
              <strong>Vercel</strong> — only when a user chooses to export. Data:
              the page HTML to deploy. Region: United States.
            </li>
            <li>
              <strong>GitHub</strong> — only when a user chooses to export. Data:
              the page HTML to publish. Region: United States.
            </li>
          </ul>

          <h2>Error monitoring</h2>
          <ul>
            <li>
              <strong>InariWatch</strong> (<code>@inariwatch/capture</code>) —
              server-side error capture. InariWatch is a sister product of the{" "}
              <strong>same operator</strong> that runs OpenLen, so this is
              first-party error capture and <strong>not</strong> an independent
              third party. Data: technical error traces and associated request
              metadata. Region: United States.
            </li>
          </ul>

          <h2>Sign-in (OAuth)</h2>
          <ul>
            <li>
              <strong>Google</strong> — OAuth sign-in provider. Data: your email,
              name, and profile image URL (based on the permissions you approve).
              Region: United States.
            </li>
          </ul>

          <h2>Contact</h2>
          <p>
            Questions about this list? Email{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. See also our{" "}
            <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </>
      )}
    </LegalPage>
  );
}
