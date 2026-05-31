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
  return { title: locale === "es" ? "Política de cookies" : "Cookie Policy" };
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const es = locale === "es";

  return (
    <LegalPage
      title={es ? "Política de cookies" : "Cookie Policy"}
      updated={es ? "Última actualización: 30 de mayo de 2026" : "Last updated: May 30, 2026"}
    >
      {es ? (
        <>
          <p>
            Jesús Bernal, que opera OpenLen, con domicilio en México, es un
            creador de landing pages con inteligencia artificial en openlen.com.
            Esta política explica las cookies que usamos y por qué. La versión
            corta: en nuestra propia aplicación solo usamos cookies estrictamente
            necesarias para que el servicio funcione, y no usamos cookies de
            analítica, publicidad ni seguimiento entre sitios.
          </p>

          <h2>Qué es una cookie</h2>
          <p>
            Una cookie es un pequeño archivo de texto que un sitio web guarda en
            tu navegador. Las cookies «estrictamente necesarias» son las que el
            servicio no puede funcionar sin ellas, como mantener tu sesión
            iniciada. No requieren consentimiento previo.
          </p>

          <h2>Cookies que usamos</h2>
          <p>
            Solo usamos cookies estrictamente necesarias, y únicamente en las
            áreas con sesión iniciada de la aplicación:
          </p>
          <ul>
            <li>
              <strong>Cookie de sesión (Auth.js)</strong> — se establece cuando
              inicias sesión. Es <strong>httpOnly</strong> (inaccesible desde
              JavaScript) y va firmada. Sirve para mantenerte autenticado entre
              páginas y para que podamos guardar y editar tus proyectos. Tiene
              una duración aproximada de <strong>30 días</strong> o hasta que
              cierras sesión, lo que ocurra primero. Sin ella no podrías
              permanecer con la sesión iniciada.
            </li>
            <li>
              <strong>Cookies del inicio de sesión con OAuth</strong> — cuando
              inicias sesión con Google o GitHub, el redireccionamiento de ese
              proveedor puede establecer cookies estrictamente necesarias de
              corta duración (por ejemplo, de protección CSRF y PKCE) durante el
              propio flujo de autenticación. Solo existen mientras dura el inicio
              de sesión y se eliminan al completarse.
            </li>
            <li>
              <strong>ol_oauth_state</strong> — una cookie de corta duración
              (httpOnly, ~10 minutos) que se crea solo durante el momento en que
              conectas tu cuenta de Vercel o GitHub para exportar una página.
              Protege ese intercambio OAuth frente a ataques CSRF y se elimina en
              cuanto el flujo termina.
            </li>
          </ul>

          <h2>Lo que no usamos</h2>
          <ul>
            <li>
              <strong>No</strong> usamos cookies de analítica, publicidad ni
              marketing.
            </li>
            <li>
              <strong>No</strong> usamos cookies de terceros para seguimiento
              entre sitios.
            </li>
            <li>
              <strong>No</strong> usamos una cookie de idioma: el idioma se
              resuelve por la ruta de la URL, no por una cookie.
            </li>
            <li>
              La analítica de las páginas publicadas es{" "}
              <strong>sin cookies</strong>: un beacon del mismo origen que solo
              registra datos agregados (nunca IPs completas ni identificadores
              persistentes) y que <strong>no guarda nada</strong> en el
              dispositivo del visitante (ni cookie, ni localStorage).
            </li>
          </ul>

          <h2>Monitoreo de errores (InariWatch)</h2>
          <p>
            Usamos <strong>InariWatch</strong> (@inariwatch/capture) para detectar
            errores técnicos en la aplicación. InariWatch es un producto hermano
            del <strong>mismo operador</strong>, por lo que lo tratamos como
            captura de errores propia (de primera parte) y no como un tercero
            independiente. No establece cookies de seguimiento ni se usa para
            publicidad.
          </p>

          <h2>Por qué no mostramos un banner de consentimiento</h2>
          <p>
            En nuestra propia aplicación solo usamos cookies estrictamente
            necesarias para prestar el servicio que has solicitado, y ninguna
            cookie de analítica, publicidad ni de terceros. Por eso no se requiere
            tu consentimiento previo y no verás un banner de cookies. (Esto aplica
            únicamente a las cookies de OpenLen; las páginas publicadas por
            usuarios pueden incluir cookies de terceros, como se explica más
            abajo.)
          </p>

          <h2>Cómo borrar o gestionar las cookies</h2>
          <p>
            Puedes borrar o bloquear las cookies desde la configuración de tu
            navegador. La ruta suele ser la sección de privacidad o de
            cookies/datos de sitios (por ejemplo, en Chrome: Configuración →
            Privacidad y seguridad → Cookies y otros datos de sitios). Si borras
            la cookie de sesión, simplemente se cerrará tu sesión y tendrás que
            volver a iniciarla.
          </p>

          <h2>Páginas creadas por usuarios</h2>
          <p>
            Las páginas que los usuarios crean y publican con OpenLen pueden
            incluir código de terceros (por ejemplo, vídeos incrustados, widgets
            o píxeles) que establezca sus propias cookies. Esas cookies escapan a
            nuestro control y son responsabilidad del propietario de la página,
            que debe cumplir con la normativa aplicable. Consulta nuestra{" "}
            <Link href="/acceptable-use">Política de uso aceptable</Link>.
          </p>

          <h2>Contacto</h2>
          <p>
            ¿Dudas sobre esta política? Escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>
        </>
      ) : (
        <>
          <p>
            Jesús Bernal, operating OpenLen, based in Mexico, is an AI
            landing-page builder at openlen.com. This policy explains the cookies
            we use and why. The short version: in our own app we use only
            strictly-necessary cookies to make the service work, and no
            analytics, advertising, or cross-site tracking cookies.
          </p>

          <h2>What a cookie is</h2>
          <p>
            A cookie is a small text file that a website stores in your browser.
            &quot;Strictly necessary&quot; cookies are the ones the service
            cannot function without, such as keeping you signed in. They do not
            require prior consent.
          </p>

          <h2>Cookies we use</h2>
          <p>
            We use only strictly-necessary cookies, and only on the signed-in
            areas of the app:
          </p>
          <ul>
            <li>
              <strong>Session cookie (Auth.js)</strong> — set when you sign in.
              It is <strong>httpOnly</strong> (not accessible from JavaScript)
              and signed. It keeps you authenticated across pages so we can save
              and edit your projects. It lasts roughly <strong>30 days</strong>{" "}
              or until you log out, whichever comes first. Without it you
              couldn&apos;t stay signed in.
            </li>
            <li>
              <strong>OAuth sign-in cookies</strong> — when you sign in with
              Google or GitHub, that provider&apos;s redirect may set short-lived
              strictly-necessary cookies (for example, CSRF and PKCE protection)
              during the sign-in flow itself. They exist only for the duration of
              sign-in and are cleared once it completes.
            </li>
            <li>
              <strong>ol_oauth_state</strong> — a short-lived cookie (httpOnly,
              ~10 minutes) set only while you connect your Vercel or GitHub
              account to export a page. It protects that OAuth exchange against
              CSRF attacks and is cleared as soon as the flow completes.
            </li>
          </ul>

          <h2>What we don&apos;t use</h2>
          <ul>
            <li>
              <strong>No</strong> analytics, advertising, or marketing cookies.
            </li>
            <li>
              <strong>No</strong> third-party cookies for cross-site tracking.
            </li>
            <li>
              <strong>No</strong> locale cookie: language is resolved from the
              URL path, not from a cookie.
            </li>
            <li>
              Analytics on published pages is <strong>cookieless</strong>: a
              same-origin beacon that records only aggregate data (never full IP
              addresses or persistent identifiers) and that{" "}
              <strong>stores nothing</strong> on the visitor&apos;s device (no
              cookie, no localStorage).
            </li>
          </ul>

          <h2>Error monitoring (InariWatch)</h2>
          <p>
            We use <strong>InariWatch</strong> (@inariwatch/capture) to detect
            technical errors in the app. InariWatch is a sister product from the{" "}
            <strong>same operator</strong>, so we treat it as our own first-party
            error capture rather than an independent third party. It sets no
            tracking cookies and is not used for advertising.
          </p>

          <h2>Why we don&apos;t show a consent banner</h2>
          <p>
            In our own app we use only strictly-necessary cookies to deliver the
            service you requested, and no analytics, advertising, or third-party
            cookies. That is why no prior consent is required and you won&apos;t
            see a cookie banner. (This applies only to OpenLen&apos;s own cookies;
            pages published by users may include third-party cookies, as
            explained below.)
          </p>

          <h2>How to clear or manage cookies</h2>
          <p>
            You can delete or block cookies from your browser settings. The path
            is usually under the privacy or cookies/site-data section (for
            example, in Chrome: Settings → Privacy and security → Cookies and
            other site data). If you clear the session cookie, you&apos;ll simply
            be signed out and will need to sign in again.
          </p>

          <h2>Pages built by users</h2>
          <p>
            Pages that users build and publish with OpenLen may include
            third-party code (for example, embedded videos, widgets, or pixels)
            that sets its own cookies. Those cookies are outside our control and
            are the page owner&apos;s responsibility to disclose and comply with.
            See our <Link href="/acceptable-use">Acceptable Use Policy</Link>.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about this policy? Email{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>
        </>
      )}
    </LegalPage>
  );
}
