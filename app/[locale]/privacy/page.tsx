import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal-page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { title: locale === "es" ? "Política de privacidad" : "Privacy Policy" };
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
      title={es ? "Política de privacidad" : "Privacy Policy"}
      updated={es ? "Última actualización: 29 de mayo de 2026" : "Last updated: May 29, 2026"}
    >
      {es ? (
        <>
          <p>
            OpenLen («nosotros») opera el creador de landing pages en
            openlen.com. Esta política explica qué datos tratamos y por qué.
          </p>
          <h2>Qué recopilamos</h2>
          <ul>
            <li>
              <strong>Datos de cuenta</strong> — tu correo e inicio de sesión,
              para autenticarte y guardar tus proyectos.
            </li>
            <li>
              <strong>Tu contenido</strong> — las páginas que creas, para poder
              guardarlas, editarlas y publicarlas por ti.
            </li>
            <li>
              <strong>Analítica respetuosa</strong> — en las páginas publicadas
              registramos visitas agregadas (país, dispositivo, referente) sin
              cookies ni seguimiento entre sitios. Nunca guardamos IPs completas.
            </li>
          </ul>
          <h2>Cuentas conectadas</h2>
          <p>
            Cuando conectas Vercel o GitHub para publicar una página, guardamos
            un token de acceso cifrado para desplegar en tu nombre. Puedes
            desconectarla cuando quieras desde el menú Publicar, lo que elimina
            el token.
          </p>
          <h2>Lo que no hacemos</h2>
          <p>No vendemos tus datos ni los compartimos con anunciantes.</p>
          <h2>Contacto</h2>
          <p>
            ¿Dudas? Escríbenos a <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>
        </>
      ) : (
        <>
          <p>
            OpenLen (&quot;we&quot;) operates the landing-page builder at
            openlen.com. This policy explains what we collect and why.
          </p>
          <h2>What we collect</h2>
          <ul>
            <li>
              <strong>Account data</strong> — your email and login, to sign you
              in and save your projects.
            </li>
            <li>
              <strong>Your content</strong> — the pages you create, so we can
              store, edit, and publish them for you.
            </li>
            <li>
              <strong>Privacy-first analytics</strong> — on published pages we
              record aggregate visits (country, device, referrer) with no
              cookies and no cross-site tracking. We never store full IP
              addresses.
            </li>
          </ul>
          <h2>Connected accounts</h2>
          <p>
            When you connect Vercel or GitHub to publish a page, we store an
            encrypted access token so we can deploy on your behalf. You can
            disconnect at any time from the Deploy menu, which deletes the token.
          </p>
          <h2>What we don&apos;t do</h2>
          <p>We don&apos;t sell your data or share it with advertisers.</p>
          <h2>Contact</h2>
          <p>
            Questions? Email <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>
        </>
      )}
    </LegalPage>
  );
}
