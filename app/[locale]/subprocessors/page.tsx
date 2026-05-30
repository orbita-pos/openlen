import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal-page";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { title: locale === "es" ? "Subprocesadores" : "Subprocessors" };
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
            openlen.com. Para cada uno indicamos su finalidad, las categorías de
            datos que recibe y su región. Cuando una región se desconoce,
            escribimos «—».
          </p>
          <p>
            Las exportaciones a Vercel y a GitHub solo ocurren cuando el propio
            usuario las inicia (al conectar la cuenta y elegir publicar); no
            enviamos datos a esos servicios de forma automática.
          </p>

          <h2>Infraestructura</h2>
          <ul>
            <li>
              <strong>Neon</strong> — alojamiento de la base de datos Postgres.
              Datos: cuenta, contenido de proyectos, registros de envíos de
              formularios y analítica. Región: —.
            </li>
            <li>
              <strong>Cloudflare R2</strong> — almacenamiento de objetos para
              activos y HTML de páginas. Datos: HTML de páginas, imágenes y otros
              archivos del usuario. Región: —.
            </li>
            <li>
              <strong>Cloudflare</strong> — DNS, CDN, geolocalización mediante la
              cabecera CF-IPCountry y purga de caché. Datos: metadatos de la
              solicitud (incluido el país de dos letras del visitante). Región: —.
            </li>
            <li>
              <strong>Hetzner</strong> — servidor de la aplicación donde se
              ejecuta OpenLen. Datos: todos los datos en tránsito y en
              procesamiento del servicio. Región: Alemania.
            </li>
          </ul>

          <h2>IA</h2>
          <ul>
            <li>
              <strong>Google Gemini</strong> (generativelanguage.googleapis.com)
              — generación de páginas con IA y revisión por visión. Datos: el
              texto del brief del usuario, el HTML de la página y capturas de
              referencia. Región: Estados Unidos.
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
              seleccionadas. Región: —.
            </li>
          </ul>

          <h2>Exportación iniciada por el usuario</h2>
          <ul>
            <li>
              <strong>Vercel</strong> — solo cuando el usuario decide exportar.
              Datos: el HTML de la página a desplegar. Región: —.
            </li>
            <li>
              <strong>GitHub</strong> — solo cuando el usuario decide exportar.
              Datos: el HTML de la página a publicar. Región: —.
            </li>
          </ul>

          <h2>Monitoreo de errores</h2>
          <ul>
            <li>
              <strong>Servicio de monitoreo de errores</strong> — captura de
              errores en el servidor. Datos: trazas de error técnicas y metadatos
              de la solicitud asociada. Región: —.
            </li>
          </ul>

          <h2>Inicio de sesión (OAuth)</h2>
          <ul>
            <li>
              <strong>Google</strong> — proveedor de inicio de sesión OAuth.
              Datos: tu correo, nombre y URL de imagen de perfil (según los
              permisos que apruebes). Región: Estados Unidos.
            </li>
            <li>
              <strong>GitHub</strong> — proveedor de inicio de sesión OAuth.
              Datos: tu correo y datos básicos de perfil. Región: Estados Unidos.
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
            openlen.com. For each one we state its purpose, the categories of data
            it receives, and its region. Where a region is unknown, we write
            &quot;—&quot;.
          </p>
          <p>
            Exports to Vercel and GitHub happen only when the user initiates them
            (by connecting the account and choosing to publish); we do not send
            data to those services automatically.
          </p>

          <h2>Infrastructure</h2>
          <ul>
            <li>
              <strong>Neon</strong> — Postgres database hosting. Data: account
              data, project content, form-submission records, and analytics.
              Region: —.
            </li>
            <li>
              <strong>Cloudflare R2</strong> — object storage for assets and page
              HTML. Data: page HTML, images, and other user files. Region: —.
            </li>
            <li>
              <strong>Cloudflare</strong> — DNS, CDN, CF-IPCountry geolocation
              header, and cache purge. Data: request metadata (including the
              visitor&apos;s two-letter country). Region: —.
            </li>
            <li>
              <strong>Hetzner</strong> — the application server that runs OpenLen.
              Data: all service data in transit and in processing. Region:
              Germany.
            </li>
          </ul>

          <h2>AI</h2>
          <ul>
            <li>
              <strong>Google Gemini</strong> (generativelanguage.googleapis.com) —
              AI page generation and vision review. Data: the user&apos;s brief
              text, page HTML, and reference screenshots. Region: United States.
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
              and the IDs of selected photos. Region: —.
            </li>
          </ul>

          <h2>User-initiated export</h2>
          <ul>
            <li>
              <strong>Vercel</strong> — only when a user chooses to export. Data:
              the page HTML to deploy. Region: —.
            </li>
            <li>
              <strong>GitHub</strong> — only when a user chooses to export. Data:
              the page HTML to publish. Region: —.
            </li>
          </ul>

          <h2>Error monitoring</h2>
          <ul>
            <li>
              <strong>Error-monitoring service</strong> — server-side error
              capture. Data: technical error traces and associated request
              metadata. Region: —.
            </li>
          </ul>

          <h2>Sign-in (OAuth)</h2>
          <ul>
            <li>
              <strong>Google</strong> — OAuth sign-in provider. Data: your email,
              name, and profile image URL (based on the permissions you approve).
              Region: United States.
            </li>
            <li>
              <strong>GitHub</strong> — OAuth sign-in provider. Data: your email
              and basic profile data. Region: United States.
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
