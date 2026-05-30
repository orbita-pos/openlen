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
  return { title: locale === "es" ? "Aviso de privacidad" : "Privacy Policy" };
}

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const es = locale === "es";

  return (
    <LegalPage
      title={es ? "Aviso de privacidad" : "Privacy Policy"}
      updated={es ? "Última actualización: 30 de mayo de 2026" : "Last updated: May 30, 2026"}
    >
      {es ? (
        <>
          <p>
            OpenLen («OpenLen», «nosotros») opera el creador de landing pages con
            IA en openlen.com. Este aviso explica qué datos personales tratamos,
            para qué, con quién los compartimos y cómo puedes ejercer tus derechos.
            Funciona como nuestro <strong>Aviso de Privacidad</strong> conforme a
            la Ley Federal de Protección de Datos Personales en Posesión de los
            Particulares de México (LFPDPPP) y, para visitantes de la Unión
            Europea, conforme al Reglamento General de Protección de Datos (RGPD).
          </p>
          <p>
            Lo importante primero: no vendemos tus datos, no los compartimos con
            anunciantes y nuestra analítica es respetuosa y sin cookies.
          </p>

          <h2>Responsable del tratamiento</h2>
          <p>
            El responsable de tus datos personales es <strong>OpenLen</strong>,
            operado desde México. Para cualquier asunto de privacidad, incluido el
            ejercicio de tus derechos, escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. No publicamos
            domicilio postal; el contacto es por correo electrónico.
          </p>

          <h2>Qué datos recopilamos</h2>
          <ul>
            <li>
              <strong>Datos de cuenta</strong> — tu correo, nombre opcional, URL
              de imagen de perfil opcional, contraseña cifrada (bcrypt), plan,
              rol y saldo de créditos de IA. Puedes iniciar sesión con Google o
              GitHub mediante Auth.js.
            </li>
            <li>
              <strong>Tu contenido</strong> — los proyectos que creas (título,
              brief y HTML), las versiones guardadas y las transcripciones de
              edición por chat (incluidas las URL de imágenes que adjuntes en el
              chat). Este contenido se elimina en cascada al borrar tu cuenta.
            </li>
            <li>
              <strong>Cuentas conectadas</strong> — cuando conectas Vercel o
              GitHub para exportar, guardamos un token de acceso{" "}
              <strong>cifrado</strong> (AES-256-GCM). Al desconectar la cuenta, el
              token se elimina.
            </li>
            <li>
              <strong>Dominios personalizados</strong> — un token de verificación
              aleatorio para comprobar la propiedad del dominio mediante un
              registro DNS TXT.
            </li>
            <li>
              <strong>Tokens de restablecimiento de contraseña</strong> — solo
              guardamos un hash del token, con una vigencia de 1 hora.
            </li>
            <li>
              <strong>Envíos de formularios en páginas publicadas</strong> —
              cuando un visitante envía un formulario en la página publicada de un
              usuario, guardamos los valores de los campos más metadatos (IP
              truncada, User-Agent truncado, referente y país, dispositivo y
              navegador derivados). Ver el apartado «Datos de formularios».
            </li>
            <li>
              <strong>Analítica de páginas publicadas</strong> — analítica
              respetuosa, <strong>sin cookies</strong>, mediante un beacon del
              mismo origen. Ver el apartado «Analítica».
            </li>
          </ul>

          <h2>Para qué usamos tus datos (finalidades)</h2>
          <ul>
            <li>Autenticarte y mantener tu sesión.</li>
            <li>Guardar, editar, generar y publicar tus páginas por ti.</li>
            <li>Medir y aplicar tu saldo de créditos de IA y tu plan.</li>
            <li>Enviar correos transaccionales (verificación, restablecimiento de contraseña, avisos de clientes potenciales de tus formularios).</li>
            <li>Exportar tus páginas a Vercel o GitHub cuando tú lo solicitas.</li>
            <li>Mantener la seguridad del servicio y prevenir abuso o fraude.</li>
          </ul>

          <h2>Analítica</h2>
          <p>
            En las páginas publicadas usamos analítica respetuosa y{" "}
            <strong>sin cookies</strong>, con un beacon del mismo origen. Solo
            guardamos: tipo de evento (vista o clic), el href y la etiqueta del
            enlace, el referente, el país (código de 2 letras a partir de
            Cloudflare), el dispositivo, el navegador y un{" "}
            <strong>hash salado e irreversible</strong> del User-Agent (uaHash).
            <strong> Nunca</strong> guardamos IPs completas, cookies ni el
            User-Agent en bruto. Los registros de analítica en bruto se eliminan a
            los <strong>90 días</strong>; el resumen diario conserva únicamente
            conteos agregados.
          </p>

          <h2>Datos de formularios en páginas publicadas (responsable y encargado)</h2>
          <p>
            Cuando un visitante envía un formulario en la página publicada de un
            usuario, el <strong>dueño de la página es el responsable</strong> de
            esos datos personales y <strong>OpenLen actúa como encargado</strong>,
            tratándolos por cuenta del dueño. Los dueños de páginas deben contar
            con su propia base legal y su propio aviso de privacidad, y atender los
            derechos de sus visitantes. Si eres visitante y deseas ejercer
            derechos sobre datos que enviaste en un formulario, contacta al dueño
            de esa página.
          </p>

          <h2>Cookies</h2>
          <p>
            Solo usamos cookies estrictamente necesarias: la cookie de sesión de
            Auth.js (httpOnly) en las rutas con sesión iniciada, y una cookie CSRF
            de corta duración <strong>ol_oauth_state</strong> (httpOnly, ~10
            minutos) durante la conexión con Vercel o GitHub. No usamos cookie de
            idioma ni cookies de analítica, marketing o de terceros, por lo que no
            mostramos banner de consentimiento. Ten en cuenta que las páginas
            creadas por usuarios pueden incrustar código de terceros que sí
            establezca cookies; eso es responsabilidad del dueño de la página. Más
            detalles en nuestra{" "}
            <Link href="/cookie-policy">política de cookies</Link>.
          </p>

          <h2>Tus derechos</h2>
          <p>
            <strong>Derechos ARCO (México).</strong> Tienes derecho de Acceso,
            Rectificación, Cancelación y Oposición sobre tus datos personales.
            Para ejercerlos, escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>
          <p>
            <strong>Derechos RGPD (Unión Europea).</strong> Si te encuentras en la
            UE, tienes derecho de acceso, rectificación, supresión, portabilidad y
            oposición, así como a la limitación del tratamiento. Para ejercerlos,
            escríbenos al mismo correo.
          </p>
          <p>
            <strong>Bases de licitud (RGPD).</strong> Tratamos tus datos de cuenta
            y contenido para ejecutar el contrato de servicio; enviamos correos
            transaccionales por la misma base; mantenemos la seguridad y la
            analítica respetuosa por interés legítimo; y procesamos pagos para
            cumplir obligaciones contractuales y legales.
          </p>

          <h2>Supresión de la cuenta</h2>
          <p>
            Aún no existe un botón de autoservicio para eliminar la cuenta. Para
            solicitar la supresión de tu cuenta y de tus datos, escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a> y procesaremos
            tu solicitud.
          </p>

          <h2>Encargados y terceros</h2>
          <p>
            Compartimos datos con los proveedores que nos ayudan a operar el
            servicio. Consulta la lista completa en nuestra página de{" "}
            <Link href="/subprocessors">subencargados</Link>.
          </p>

          <h2>Transferencias internacionales</h2>
          <p>
            Algunos de nuestros proveedores tratan datos fuera de tu país. El
            servidor de aplicación está en <strong>Alemania</strong> (Hetzner). La
            generación de páginas con IA usa Google Gemini y los correos usan
            Resend, ambos en <strong>Estados Unidos</strong>. Al usar OpenLen,
            estas transferencias se realizan para prestarte el servicio.
          </p>

          <h2>Lo que no hacemos</h2>
          <p>No vendemos tus datos ni los compartimos con anunciantes.</p>

          <h2>Cambios</h2>
          <p>
            Podemos actualizar este aviso; publicaremos la fecha de la última
            actualización al inicio de esta página.
          </p>

          <h2>Contacto</h2>
          <p>
            ¿Dudas o solicitudes de privacidad? Escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>
        </>
      ) : (
        <>
          <p>
            OpenLen (&quot;OpenLen&quot;, &quot;we&quot;) operates the AI
            landing-page builder at openlen.com. This notice explains what
            personal data we process, why, who we share it with, and how you can
            exercise your rights. It serves as our{" "}
            <strong>Aviso de Privacidad</strong> under Mexico&apos;s Federal Law
            on the Protection of Personal Data Held by Private Parties (LFPDPPP)
            and, for visitors in the European Union, under the General Data
            Protection Regulation (GDPR).
          </p>
          <p>
            The headline first: we don&apos;t sell your data, we don&apos;t share
            it with advertisers, and our analytics are privacy-first and
            cookieless.
          </p>

          <h2>Data controller</h2>
          <p>
            The controller (responsable) of your personal data is{" "}
            <strong>OpenLen</strong>, operated from Mexico. For any privacy
            matter, including exercising your rights, email{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. We do not
            publish a postal address; contact is by email.
          </p>

          <h2>What we collect</h2>
          <ul>
            <li>
              <strong>Account data</strong> — your email, optional name, optional
              profile-image URL, hashed password (bcrypt), plan, role, and AI
              credit balance. You can sign in with Google or GitHub via Auth.js.
            </li>
            <li>
              <strong>Your content</strong> — the projects you create (title,
              brief, and HTML), saved version snapshots, and chat-edit transcripts
              (including the URLs of images you attach in chat). This content is
              cascade-deleted with your account.
            </li>
            <li>
              <strong>Connected accounts</strong> — when you connect Vercel or
              GitHub to export, we store an <strong>encrypted</strong>{" "}
              (AES-256-GCM) access token. Disconnecting the account deletes the
              token.
            </li>
            <li>
              <strong>Custom domains</strong> — a random verification token to
              prove domain ownership via a DNS TXT record.
            </li>
            <li>
              <strong>Password-reset tokens</strong> — we store only a hash of the
              token, with a 1-hour expiry.
            </li>
            <li>
              <strong>Published-page form submissions</strong> — when a visitor
              submits a form on a user&apos;s published page, we store the field
              values plus metadata (truncated IP, truncated User-Agent, referrer,
              and derived country, device, and browser). See the
              &quot;Published-page form data&quot; section.
            </li>
            <li>
              <strong>Published-page analytics</strong> — privacy-first,{" "}
              <strong>cookieless</strong> analytics via a same-origin beacon. See
              the &quot;Analytics&quot; section.
            </li>
          </ul>

          <h2>What we use your data for (purposes)</h2>
          <ul>
            <li>Authenticate you and keep your session.</li>
            <li>Store, edit, generate, and publish your pages for you.</li>
            <li>Measure and apply your AI credit balance and plan.</li>
            <li>Send transactional emails (verification, password reset, lead notifications from your forms).</li>
            <li>Export your pages to Vercel or GitHub when you ask us to.</li>
            <li>Keep the service secure and prevent abuse or fraud.</li>
          </ul>

          <h2>Analytics</h2>
          <p>
            On published pages we use privacy-first,{" "}
            <strong>cookieless</strong> analytics via a same-origin beacon. We
            store only: event type (view or click), the link href and label, the
            referrer, the country (2-letter code from Cloudflare), the device, the
            browser, and a <strong>salted, non-reversible hash</strong> of the
            User-Agent (uaHash). We <strong>never</strong> store full IP
            addresses, cookies, or the raw User-Agent. Raw analytics rows are
            deleted after <strong>90 days</strong>; a daily rollup keeps only
            aggregate counts.
          </p>

          <h2>Published-page form data (controller and processor)</h2>
          <p>
            When a visitor submits a form on a user&apos;s published page, the{" "}
            <strong>page owner is the data controller</strong> for that personal
            data and <strong>OpenLen acts as a processor</strong>, handling it on
            the owner&apos;s behalf. Page owners must have their own lawful basis
            and their own privacy notice, and must honor their visitors&apos;
            rights. If you&apos;re a visitor and want to exercise rights over data
            you submitted through a form, contact that page&apos;s owner.
          </p>

          <h2>Cookies</h2>
          <p>
            We use only strictly-necessary cookies: the Auth.js session cookie
            (httpOnly) on signed-in routes, and a short-lived{" "}
            <strong>ol_oauth_state</strong> CSRF cookie (httpOnly, ~10 minutes)
            during the Vercel or GitHub connect flow. We use no locale cookie and
            no analytics, marketing, or third-party cookies, so we show no consent
            banner. Note that pages built by users may embed third-party code that
            does set cookies; that is the page owner&apos;s responsibility. More
            detail in our <Link href="/cookie-policy">cookie policy</Link>.
          </p>

          <h2>Your rights</h2>
          <p>
            <strong>ARCO rights (Mexico).</strong> You have the rights of Access,
            Rectification, Cancellation (erasure), and Opposition over your
            personal data. To exercise them, email{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>
          <p>
            <strong>GDPR rights (European Union).</strong> If you&apos;re in the
            EU, you have the rights to access, rectify, erase, port, and object to
            the processing of your data, as well as to restrict processing. To
            exercise them, email the same address.
          </p>
          <p>
            <strong>Lawful bases (GDPR).</strong> We process your account data and
            content to perform the service contract; we send transactional emails
            on the same basis; we maintain security and privacy-first analytics on
            the basis of legitimate interest; and we process payments to meet
            contractual and legal obligations.
          </p>

          <h2>Account deletion</h2>
          <p>
            There is no self-service delete button yet. To request erasure of your
            account and data, email{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a> and we&apos;ll
            process your request.
          </p>

          <h2>Processors and third parties</h2>
          <p>
            We share data with the providers that help us run the service. See the
            full list on our <Link href="/subprocessors">subprocessors</Link>{" "}
            page.
          </p>

          <h2>International transfers</h2>
          <p>
            Some of our providers process data outside your country. The
            application server is in <strong>Germany</strong> (Hetzner). AI page
            generation uses Google Gemini and email uses Resend, both in the{" "}
            <strong>United States</strong>. By using OpenLen, these transfers take
            place to deliver the service to you.
          </p>

          <h2>What we don&apos;t do</h2>
          <p>We don&apos;t sell your data or share it with advertisers.</p>

          <h2>Changes</h2>
          <p>
            We may update this notice; we&apos;ll post the last-updated date at the
            top of this page.
          </p>

          <h2>Contact</h2>
          <p>
            Questions or privacy requests? Email{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>
        </>
      )}
    </LegalPage>
  );
}
