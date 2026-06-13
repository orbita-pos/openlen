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
  return {
    title: locale === "es" ? "Aviso de privacidad" : "Privacy Policy",
    description:
      locale === "es"
        ? "Qué datos personales trata OpenLen, para qué, con quién los comparte y cómo ejercer tus derechos (LFPDPPP y RGPD)."
        : "What personal data OpenLen processes, why, who it shares it with, and how to exercise your rights (LFPDPPP and GDPR).",
    alternates: { canonical: `${SITE_URL}/${locale}/privacy` },
  };
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
      updated={es ? "Última actualización: 12 de junio de 2026" : "Last updated: June 12, 2026"}
    >
      {es ? (
        <>
          <p>
            <strong>Jesús Bernal</strong>, que opera OpenLen, es el responsable
            del tratamiento de los datos personales que recabamos a través del
            creador de landing pages con IA en openlen.com. Este aviso explica qué
            datos personales tratamos, para qué, con quién los compartimos y cómo
            puedes ejercer tus derechos. Funciona como nuestro{" "}
            <strong>Aviso de Privacidad</strong> conforme a la Ley Federal de
            Protección de Datos Personales en Posesión de los Particulares de
            México (LFPDPPP) y, para visitantes de la Unión Europea, conforme al
            Reglamento General de Protección de Datos (RGPD).
          </p>
          <p>
            Lo importante primero: no vendemos tus datos, no los compartimos con
            anunciantes, no recabamos datos sensibles y nuestra analítica es
            respetuosa y sin cookies.
          </p>

          <h2>Responsable del tratamiento</h2>
          <p>
            El responsable de tus datos personales es{" "}
            <strong>Jesús Bernal</strong>, que opera OpenLen, con sede en México.
            Para cualquier asunto de privacidad, incluido el ejercicio de tus
            derechos, escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>

          <h2>Qué datos recopilamos</h2>
          <ul>
            <li>
              <strong>Datos de cuenta</strong> — tu correo, nombre opcional, URL
              de imagen de perfil opcional, contraseña protegida mediante hash
              (bcrypt), plan, rol y saldo de créditos de IA. Puedes iniciar sesión
              con Google mediante Auth.js.
            </li>
            <li>
              <strong>Tu contenido</strong> — los proyectos que creas (título,
              brief y HTML), las versiones guardadas y las transcripciones de
              edición por chat (incluidas las URL de imágenes que adjuntes en el
              chat). Este contenido se elimina en cascada al borrar tu cuenta.
            </li>
            <li>
              <strong>Datos de facturación y pago</strong> — tu suscripción de
              pago se gestiona a través de <strong>Polar</strong> (Polar Software
              Inc., Estados Unidos), que actúa como nuestro comerciante registrado
              (Merchant of Record). Polar trata los datos de pago y los datos
              financieros o patrimoniales (datos de tarjeta, dirección de
              facturación e impuestos), emite la factura y cobra los impuestos
              aplicables. OpenLen solo conserva el estado de tu suscripción y tu
              plan; <strong>nunca</strong> almacenamos números de tarjeta.
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
              usuario, guardamos los valores de los campos más metadatos (la
              dirección IP y el User-Agent del visitante, conservados brevemente
              para protección frente a spam y abuso, además del referente y el
              país, dispositivo y navegador derivados). Ver el apartado «Datos de
              formularios».
            </li>
            <li>
              <strong>Módulos interactivos en páginas publicadas</strong> — si un
              usuario activa los módulos de Miembros, Comentarios o Reservas,
              guardamos los datos que el visitante proporciona a ese módulo (por
              ejemplo, su correo para el acceso por enlace mágico; su nombre,
              comentario o, en una reserva, su nombre, correo, nota y la fecha y
              hora elegidas), junto con la dirección IP conservada brevemente para
              limitar el abuso. Se aplica la misma relación responsable/encargado
              del apartado «Datos de formularios»: el usuario que publica la página
              es el responsable de esos datos.
            </li>
            <li>
              <strong>Analítica de páginas publicadas</strong> — analítica
              respetuosa, <strong>sin cookies</strong>, mediante un beacon del
              mismo origen. Ver el apartado «Analítica».
            </li>
          </ul>
          <p>
            <strong>Consentimiento expreso para datos financieros.</strong> Los
            datos financieros o patrimoniales asociados a tu plan de pago se tratan
            con tu <strong>consentimiento expreso</strong>, otorgado al contratar
            el plan de pago, conforme al artículo 8 de la LFPDPPP.
          </p>
          <p>
            <strong>No recabamos datos sensibles.</strong> OpenLen no solicita ni
            trata datos personales sensibles (por ejemplo, origen racial o étnico,
            estado de salud, creencias religiosas, opiniones políticas, preferencia
            sexual o datos biométricos).
          </p>

          <h2>Para qué usamos tus datos (finalidades)</h2>
          <p>
            <strong>Finalidades primarias (necesarias para el servicio).</strong>{" "}
            Estas finalidades son indispensables para prestarte el servicio:
          </p>
          <ul>
            <li>Autenticarte y mantener tu sesión.</li>
            <li>Guardar, editar, generar y publicar tus páginas por ti.</li>
            <li>Medir y aplicar tu saldo de créditos de IA y tu plan.</li>
            <li>
              Enviar correos transaccionales (verificación, restablecimiento de
              contraseña, avisos de clientes potenciales de tus formularios).
            </li>
            <li>
              Procesar el pago de tu suscripción a través de Polar y conservar el
              estado de tu suscripción y plan.
            </li>
            <li>Mantener la seguridad del servicio y prevenir abuso o fraude.</li>
          </ul>
          <p>
            <strong>Finalidades secundarias.</strong> No tratamos tus datos para
            finalidades secundarias: no hacemos publicidad, prospección comercial
            ni elaboración de perfiles con fines de marketing. Si en el futuro
            introdujéramos alguna finalidad secundaria, te ofreceríamos un
            mecanismo de oposición por correo a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a> que no
            condicionaría la prestación del servicio.
          </p>
          <p>
            <strong>Generación con IA.</strong> Para generar tus páginas, enviamos
            el texto de tu brief y el HTML de la página a Google Gemini, que los
            utiliza únicamente para producir el resultado solicitado conforme a los
            términos de la API de Google. No tomamos ninguna decisión automatizada
            con efectos jurídicos sobre ti.
          </p>

          <h2>Analítica</h2>
          <p>
            En las páginas publicadas usamos analítica respetuosa y{" "}
            <strong>sin cookies</strong>, con un beacon del mismo origen. Solo
            guardamos: tipo de evento (vista o clic), el href y la etiqueta del
            enlace, el referente, el país (código de 2 letras a partir de
            Cloudflare), el dispositivo, el navegador y un{" "}
            <strong>hash salado e irreversible</strong> del User-Agent (uaHash).{" "}
            <strong>Cloudflare</strong> (CDN) deriva el código de país de 2 letras
            en el edge; la analítica <strong>no almacena ninguna IP</strong> ni
            ningún dato derivado de la IP. Nuestra analítica respetuosa{" "}
            <strong>nunca</strong> guarda IPs completas, cookies ni el User-Agent
            en bruto. Los registros de analítica en bruto se eliminan a
            los <strong>90 días</strong>; el resumen diario conserva únicamente
            conteos agregados.
          </p>

          <h2>Datos de formularios en páginas publicadas (responsable y encargado)</h2>
          <p>
            Cuando un visitante envía un formulario en la página publicada de un
            usuario, el <strong>dueño de la página es el responsable</strong> de
            esos datos personales y <strong>OpenLen actúa como encargado</strong>,
            tratándolos por cuenta del dueño. Esta relación se rige por un acuerdo
            de tratamiento de datos (encargado conforme a la LFPDPPP / art. 28 del
            RGPD) disponible a solicitud en{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. Los dueños de
            páginas deben contar con su propia base legal y su propio aviso de
            privacidad, y atender los derechos de sus visitantes. Si eres visitante
            y deseas ejercer derechos sobre datos que enviaste en un formulario,
            contacta al dueño de esa página.
          </p>

          <h2>Membresías y correos a miembros (Broadcast)</h2>
          <p>
            Si el dueño de una página activa <strong>Miembros</strong>, los
            visitantes pueden registrarse con su correo (acceso sin contraseña
            por enlace mágico). Si además activa <strong>Broadcast</strong>, el
            dueño puede enviar correos a sus miembros; OpenLen los entrega{" "}
            <strong>por cuenta del dueño</strong> (encargado) usando nuestra
            infraestructura de envío, y aparece como remitente del dominio
            compartido. Cada correo incluye, por ley, la identidad del
            remitente, una dirección postal y un{" "}
            <strong>enlace de baja</strong> de un clic; las bajas se respetan de
            inmediato y no vuelven a recibir campañas. OpenLen{" "}
            <strong>no</strong> usa los correos de los miembros para sus propios
            fines de marketing ni los comparte con terceros distintos de
            nuestro proveedor de envío.
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
            Rectificación, Cancelación y Oposición sobre tus datos personales. Para
            ejercerlos, escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. Tu solicitud
            debe incluir tu nombre y datos de contacto, un documento que acredite
            tu identidad (o, en su caso, la representación legal), y una descripción
            clara de los datos personales y del derecho que deseas ejercer.
            Responderemos a tu solicitud en un plazo máximo de{" "}
            <strong>20 días</strong> y, de resultar procedente, la haremos efectiva
            dentro de los <strong>15 días</strong> siguientes. El ejercicio de
            estos derechos es <strong>gratuito</strong>. Si consideras que tu
            derecho a la protección de datos no fue debidamente atendido, puedes
            acudir ante la{" "}
            <strong>Secretaría Anticorrupción y Buena Administración</strong>, que
            asumió las funciones de protección de datos del extinto INAI en marzo
            de 2025.
          </p>
          <p>
            <strong>Revocación del consentimiento.</strong> Puedes revocar en
            cualquier momento el consentimiento que nos hayas otorgado para el
            tratamiento de tus datos, escribiendo a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. La revocación
            puede implicar que dejemos de prestarte el servicio. Atenderemos tu
            solicitud en un plazo máximo de <strong>20 días</strong>.
          </p>
          <p>
            <strong>Derechos RGPD (Unión Europea).</strong> Si te encuentras en la
            UE, tienes derecho de acceso, rectificación, supresión, portabilidad y
            oposición, así como a la limitación del tratamiento. Tienes derecho a{" "}
            <strong>oponerte</strong> (art. 21 del RGPD) a los tratamientos que
            realizamos sobre la base del interés legítimo (seguridad y analítica
            respetuosa). También puedes presentar una{" "}
            <strong>reclamación ante una autoridad de control</strong> de la
            UE/EEE. Para ejercer cualquiera de estos derechos, escríbenos al mismo
            correo.
          </p>
          <p>
            <strong>Bases de licitud (RGPD).</strong> Tratamos tus datos de cuenta
            y tu contenido para <strong>ejecutar el contrato</strong> de servicio,
            incluida la generación de páginas con IA; enviamos correos
            transaccionales y procesamos el pago de tu suscripción por la misma
            base de ejecución del contrato (y, en su caso, para cumplir
            obligaciones legales fiscales); y mantenemos la seguridad y la
            analítica respetuosa sobre la base del{" "}
            <strong>interés legítimo</strong>.
          </p>
          <p>
            <strong>Representante en la UE (art. 27 del RGPD).</strong> Antes de
            ofrecer planes de pago a consumidores de la UE, designaremos un
            representante en la Unión Europea conforme al artículo 27 del RGPD y
            publicaremos sus datos de contacto.
          </p>

          <h2>Conservación de datos</h2>
          <ul>
            <li>
              <strong>Cuenta y contenido</strong> — se conservan mientras tu cuenta
              esté activa y se eliminan al atender tu solicitud de supresión por
              correo.
            </li>
            <li>
              <strong>Tokens de cuentas conectadas (OAuth)</strong> — se conservan
              hasta que desconectas la cuenta.
            </li>
            <li>
              <strong>Tokens de restablecimiento de contraseña</strong> — 1 hora.
            </li>
            <li>
              <strong>Analítica en bruto</strong> — 90 días; después solo se
              conservan conteos agregados.
            </li>
            <li>
              <strong>Estado de suscripción y plan</strong> — mientras tu cuenta
              esté activa; los datos de pago los conserva Polar conforme a sus
              propias políticas y obligaciones legales.
            </li>
            <li>
              <strong>Envíos de formularios</strong> — se conservan según las
              instrucciones del dueño de la página (responsable de esos datos).
            </li>
          </ul>

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
            servicio. Distinguimos dos categorías:
          </p>
          <ul>
            <li>
              <strong>Encargados</strong> (tratan datos por cuenta de OpenLen, sin
              que se requiera tu consentimiento adicional): Neon (base de datos),
              Cloudflare (CDN), Hetzner (alojamiento del servidor de aplicación),
              Google Gemini (generación con IA), Resend (correo transaccional) e{" "}
              <strong>InariWatch</strong> (<code>@inariwatch/capture</code>,
              monitoreo de errores). InariWatch es un producto hermano del mismo
              operador, por lo que la captura de errores es de primera parte y no
              de un tercero independiente.
            </li>
            <li>
              <strong>Terceros responsables</strong> (tratan datos bajo su propia
              responsabilidad): <strong>Polar</strong> para los datos de pago;{" "}
              <strong>Google</strong> cuando eliges
              iniciar sesión con OAuth; y <strong>Vercel</strong> o{" "}
              <strong>GitHub</strong> cuando tú inicias una exportación de tus
              páginas.
            </li>
          </ul>
          <p>
            La finalidad de compartir estos datos es exclusivamente prestar y
            operar el servicio que solicitas. Consulta la lista completa y
            actualizada de todos los subencargados en nuestra página de{" "}
            <Link href="/subprocessors">subencargados</Link>.
          </p>
          <p>
            <strong>Cláusula de negativa.</strong> Cuando una transferencia
            requiera tu consentimiento, puedes negarte escribiéndonos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>; ten en cuenta
            que negarte a las transferencias necesarias para el servicio puede
            impedir su prestación.
          </p>

          <h2>Transferencias internacionales</h2>
          <p>
            Algunos de nuestros proveedores tratan datos fuera de tu país. El
            servidor de aplicación está en <strong>Alemania</strong> (Hetzner). La
            generación de páginas con IA usa Google Gemini, los correos usan Resend
            y el cobro de suscripciones usa Polar, todos en{" "}
            <strong>Estados Unidos</strong>. Para los destinatarios en Estados
            Unidos, estas transferencias se amparan en las{" "}
            <strong>Cláusulas Contractuales Tipo</strong> de la Comisión Europea
            y/o en el <strong>Marco de Privacidad de Datos UE-EE. UU.</strong>{" "}
            (EU-US Data Privacy Framework); puedes solicitar copia de estas
            garantías al correo de contacto. Al usar OpenLen, estas transferencias
            se realizan para prestarte el servicio.
          </p>

          <h2>Lo que no hacemos</h2>
          <p>
            No vendemos tus datos, no los compartimos con anunciantes y no
            recabamos datos sensibles.
          </p>

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
            <strong>Jesús Bernal</strong>, operating OpenLen, is the controller
            (responsable) of the personal data we collect through the AI
            landing-page builder at openlen.com. This notice explains what personal
            data we process, why, who we share it with, and how you can exercise
            your rights. It serves as our <strong>Aviso de Privacidad</strong>{" "}
            under Mexico&apos;s Federal Law on the Protection of Personal Data Held
            by Private Parties (LFPDPPP) and, for visitors in the European Union,
            under the General Data Protection Regulation (GDPR).
          </p>
          <p>
            The headline first: we don&apos;t sell your data, we don&apos;t share
            it with advertisers, we don&apos;t collect sensitive data, and our
            analytics are privacy-first and cookieless.
          </p>

          <h2>Data controller</h2>
          <p>
            The controller (responsable) of your personal data is{" "}
            <strong>Jesús Bernal</strong>, operating OpenLen, based in Mexico. For
            any privacy matter, including exercising your rights, email{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>

          <h2>What we collect</h2>
          <ul>
            <li>
              <strong>Account data</strong> — your email, optional name, optional
              profile-image URL, hashed password (bcrypt), plan, role, and AI
              credit balance. You can sign in with Google via Auth.js.
            </li>
            <li>
              <strong>Your content</strong> — the projects you create (title,
              brief, and HTML), saved version snapshots, and chat-edit transcripts
              (including the URLs of images you attach in chat). This content is
              cascade-deleted with your account.
            </li>
            <li>
              <strong>Billing and payment data</strong> — your paid subscription is
              managed through <strong>Polar</strong> (Polar Software Inc., United
              States), which acts as our Merchant of Record. Polar processes
              payment and financial/patrimonial data (card details, billing
              address, and tax), issues the invoice, and collects applicable taxes.
              OpenLen stores only your subscription status and plan; we{" "}
              <strong>never</strong> store card numbers.
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
              values plus metadata (the visitor&apos;s IP address and User-Agent,
              retained briefly for spam and abuse protection, plus the referrer and
              derived country, device, and browser). See the
              &quot;Published-page form data&quot; section.
            </li>
            <li>
              <strong>Published-page interactive modules</strong> — if a user
              turns on the Members, Comments, or Bookings module, we store the data
              a visitor gives that module (for example, their email for magic-link
              sign-in; their name and comment; or, for a booking, their name,
              email, note, and chosen date and time), along with the IP address
              retained briefly to limit abuse. The same controller/processor
              relationship as the &quot;Published-page form data&quot; section
              applies: the user who publishes the page is the controller of that
              data.
            </li>
            <li>
              <strong>Published-page analytics</strong> — privacy-first,{" "}
              <strong>cookieless</strong> analytics via a same-origin beacon. See
              the &quot;Analytics&quot; section.
            </li>
          </ul>
          <p>
            <strong>Express consent for financial data.</strong> The
            financial/patrimonial data associated with your paid plan are processed
            with your <strong>express consent</strong>, given when you contract the
            paid plan, in accordance with article 8 of the LFPDPPP.
          </p>
          <p>
            <strong>We do not collect sensitive data.</strong> OpenLen does not
            request or process sensitive personal data (for example, racial or
            ethnic origin, health status, religious beliefs, political opinions,
            sexual preference, or biometric data).
          </p>

          <h2>What we use your data for (purposes)</h2>
          <p>
            <strong>Primary purposes (necessary for the service).</strong> These
            purposes are indispensable to provide the service to you:
          </p>
          <ul>
            <li>Authenticate you and keep your session.</li>
            <li>Store, edit, generate, and publish your pages for you.</li>
            <li>Measure and apply your AI credit balance and plan.</li>
            <li>
              Send transactional emails (verification, password reset, lead
              notifications from your forms).
            </li>
            <li>
              Process your subscription payment through Polar and keep your
              subscription status and plan.
            </li>
            <li>Keep the service secure and prevent abuse or fraud.</li>
          </ul>
          <p>
            <strong>Secondary purposes.</strong> We do not process your data for
            secondary purposes: we run no advertising, no commercial prospecting,
            and no profiling for marketing. If we ever introduced a secondary
            purpose, we would offer you an opt-out by email at{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a> that would not
            condition the provision of the service.
          </p>
          <p>
            <strong>AI generation.</strong> To generate your pages, we send your
            brief text and the page HTML to Google Gemini, which uses them solely
            to produce the requested output under Google&apos;s API terms. We make
            no automated decision producing legal effects concerning you.
          </p>

          <h2>Analytics</h2>
          <p>
            On published pages we use privacy-first, <strong>cookieless</strong>{" "}
            analytics via a same-origin beacon. We store only: event type (view or
            click), the link href and label, the referrer, the country (2-letter
            code from Cloudflare), the device, the browser, and a{" "}
            <strong>salted, non-reversible hash</strong> of the User-Agent
            (uaHash). <strong>Cloudflare</strong> (CDN) derives the 2-letter
            country code at the edge; the analytics{" "}
            <strong>store no IP</strong> and nothing IP-derived is persisted. Our
            privacy-first analytics <strong>never</strong> store full IP
            addresses, cookies, or the raw User-Agent. Raw analytics rows are
            deleted after <strong>90 days</strong>; a daily rollup keeps only
            aggregate counts.
          </p>

          <h2>Published-page form data (controller and processor)</h2>
          <p>
            When a visitor submits a form on a user&apos;s published page, the{" "}
            <strong>page owner is the data controller</strong> for that personal
            data and <strong>OpenLen acts as a processor</strong>, handling it on
            the owner&apos;s behalf. This relationship is governed by a
            data-processing agreement (processor / encargado under Art. 28 GDPR /
            LFPDPPP) available on request at{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. Page owners
            must have their own lawful basis and their own privacy notice, and must
            honor their visitors&apos; rights. If you&apos;re a visitor and want to
            exercise rights over data you submitted through a form, contact that
            page&apos;s owner.
          </p>

          <h2>Memberships and member emails (Broadcast)</h2>
          <p>
            If a page owner enables <strong>Members</strong>, visitors can sign
            up with their email (passwordless magic-link login). If they also
            enable <strong>Broadcast</strong>, the owner can email their
            members; OpenLen delivers those emails{" "}
            <strong>on the owner&apos;s behalf</strong> (as a processor) using
            our sending infrastructure, appearing as the sender on the shared
            domain. Every email carries, as required by law, the sender&apos;s
            identity, a postal address, and a one-click{" "}
            <strong>unsubscribe</strong> link; unsubscribes take effect
            immediately and those recipients receive no further campaigns.
            OpenLen does <strong>not</strong> use members&apos; emails for its
            own marketing or share them with anyone other than our sending
            provider.
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
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. Your request
            must include your name and contact details, a document proving your
            identity (or legal representation, where applicable), and a clear
            description of the personal data and of the right you wish to exercise.
            We will respond within a maximum of <strong>20 days</strong> and, if
            the request is well-founded, make it effective within the following{" "}
            <strong>15 days</strong>. Exercising these rights is{" "}
            <strong>free of charge</strong>. If you believe your right to data
            protection was not properly addressed, you may turn to the{" "}
            <strong>Secretaría Anticorrupción y Buena Administración</strong>, which
            assumed the data-protection functions of the former INAI in March 2025.
          </p>
          <p>
            <strong>Revocation of consent.</strong> You may revoke at any time the
            consent you have given us to process your data by emailing{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. Revocation may
            mean we can no longer provide the service to you. We will respond to
            your request within a maximum of <strong>20 days</strong>.
          </p>
          <p>
            <strong>GDPR rights (European Union).</strong> If you&apos;re in the EU,
            you have the rights to access, rectify, erase, port, and object to the
            processing of your data, as well as to restrict processing. You have
            the right to <strong>object</strong> (Art. 21 GDPR) to the processing
            we carry out on the basis of legitimate interest (security and
            privacy-first analytics). You may also lodge a{" "}
            <strong>complaint with an EU/EEA supervisory authority</strong>. To
            exercise any of these rights, email the same address.
          </p>
          <p>
            <strong>Lawful bases (GDPR).</strong> We process your account data and
            content to <strong>perform the service contract</strong>, including AI
            page generation; we send transactional emails and process your
            subscription payment on the same contract-performance basis (and, where
            applicable, to comply with legal tax obligations); and we maintain
            security and privacy-first analytics on the basis of{" "}
            <strong>legitimate interest</strong>.
          </p>
          <p>
            <strong>EU representative (Art. 27 GDPR).</strong> Before offering paid
            plans to EU consumers, we will designate a representative in the
            European Union under Article 27 GDPR and publish their contact details.
          </p>

          <h2>Data retention</h2>
          <ul>
            <li>
              <strong>Account and content</strong> — kept while your account is
              active and deleted when we process your erasure request by email.
            </li>
            <li>
              <strong>Connected-account (OAuth) tokens</strong> — kept until you
              disconnect the account.
            </li>
            <li>
              <strong>Password-reset tokens</strong> — 1 hour.
            </li>
            <li>
              <strong>Raw analytics</strong> — 90 days; after that, only aggregate
              counts are kept.
            </li>
            <li>
              <strong>Subscription status and plan</strong> — while your account is
              active; payment data is kept by Polar under its own policies and
              legal obligations.
            </li>
            <li>
              <strong>Form submissions</strong> — kept per the page owner&apos;s
              instruction (the owner is the controller for that data).
            </li>
          </ul>

          <h2>Account deletion</h2>
          <p>
            There is no self-service delete button yet. To request erasure of your
            account and data, email{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a> and we&apos;ll
            process your request.
          </p>

          <h2>Processors and third parties</h2>
          <p>
            We share data with the providers that help us run the service. We
            distinguish two categories:
          </p>
          <ul>
            <li>
              <strong>Processors</strong> (process data on OpenLen&apos;s behalf, no
              additional consent required): Neon (database), Cloudflare (CDN),
              Hetzner (application-server hosting), Google Gemini (AI generation),
              Resend (transactional email), and <strong>InariWatch</strong> (
              <code>@inariwatch/capture</code>, error monitoring). InariWatch is a
              sister product of the same operator, so error capture is first-party,
              not an independent third party.
            </li>
            <li>
              <strong>Third-party controllers</strong> (process data under their
              own responsibility): <strong>Polar</strong> for payment data;{" "}
              <strong>Google</strong> when you choose to
              sign in via OAuth; and <strong>Vercel</strong> or{" "}
              <strong>GitHub</strong> when you initiate an export of your pages.
            </li>
          </ul>
          <p>
            The purpose of sharing this data is solely to provide and operate the
            service you request. See the full, up-to-date list of all subprocessors
            on our <Link href="/subprocessors">subprocessors</Link> page.
          </p>
          <p>
            <strong>Right to refuse.</strong> Where a transfer requires your
            consent, you may refuse by emailing{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>; note that
            refusing transfers necessary for the service may prevent us from
            providing it.
          </p>

          <h2>International transfers</h2>
          <p>
            Some of our providers process data outside your country. The
            application server is in <strong>Germany</strong> (Hetzner). AI page
            generation uses Google Gemini, email uses Resend, and subscription
            billing uses Polar, all in the <strong>United States</strong>. For
            recipients in the United States, these transfers are covered by the
            European Commission&apos;s <strong>Standard Contractual Clauses</strong>{" "}
            and/or the <strong>EU-US Data Privacy Framework</strong>; you can
            request a copy of these safeguards at the contact email. By using
            OpenLen, these transfers take place to deliver the service to you.
          </p>

          <h2>What we don&apos;t do</h2>
          <p>
            We don&apos;t sell your data, share it with advertisers, or collect
            sensitive data.
          </p>

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
