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
            OpenLen («nosotros») es un creador de landing pages con inteligencia
            artificial en openlen.com. Esta política explica las cookies que
            usamos y por qué. La versión corta: solo usamos cookies estrictamente
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
              páginas y para que podamos guardar y editar tus proyectos. Sin ella
              no podrías permanecer con la sesión iniciada.
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
              <strong>sin cookies</strong> (un beacon del mismo origen que solo
              registra datos agregados, nunca IPs completas ni identificadores
              persistentes).
            </li>
          </ul>

          <h2>Por qué no mostramos un banner de consentimiento</h2>
          <p>
            Como solo usamos cookies estrictamente necesarias para prestar el
            servicio que has solicitado, y ninguna cookie de analítica,
            publicidad ni de terceros, no se requiere tu consentimiento previo y
            por eso no verás un banner de cookies.
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
            OpenLen (&quot;we&quot;) is an AI landing-page builder at openlen.com.
            This policy explains the cookies we use and why. The short version:
            we use only strictly-necessary cookies to make the service work, and
            no analytics, advertising, or cross-site tracking cookies.
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
              and edit your projects. Without it you couldn&apos;t stay signed
              in.
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
              Analytics on published pages is <strong>cookieless</strong> (a
              same-origin beacon that records only aggregate data, never full IP
              addresses or persistent identifiers).
            </li>
          </ul>

          <h2>Why we don&apos;t show a consent banner</h2>
          <p>
            Because we use only strictly-necessary cookies to deliver the service
            you requested, and no analytics, advertising, or third-party cookies,
            no prior consent is required and so you won&apos;t see a cookie
            banner.
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
