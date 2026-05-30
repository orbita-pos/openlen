import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal-page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { title: locale === "es" ? "Términos de servicio" : "Terms of Service" };
}

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const es = locale === "es";

  return (
    <LegalPage
      title={es ? "Términos de servicio" : "Terms of Service"}
      updated={es ? "Última actualización: 29 de mayo de 2026" : "Last updated: May 29, 2026"}
    >
      {es ? (
        <>
          <p>
            Al usar OpenLen aceptas estos términos. OpenLen es un creador de
            landing pages de código abierto.
          </p>
          <h2>Tu contenido</h2>
          <p>
            Eres dueño de las páginas y el contenido que creas. Eres responsable
            de tener los derechos sobre lo que subas y de no publicar contenido
            ilegal, dañino o abusivo.
          </p>
          <h2>Uso aceptable</h2>
          <p>
            No uses OpenLen para infringir la ley, vulnerar derechos de terceros
            ni distribuir malware. Podemos suspender cuentas que lo hagan.
          </p>
          <h2>Despliegues a terceros</h2>
          <p>
            Desplegar en Vercel o GitHub se rige por los términos de esos
            proveedores. Conectas tus propias cuentas y eres responsable del uso
            que hagas allí.
          </p>
          <h2>Sin garantía</h2>
          <p>
            OpenLen se ofrece «tal cual», sin garantías de ningún tipo. El
            software es de código abierto bajo AGPLv3.
          </p>
          <h2>Cambios</h2>
          <p>
            Podemos actualizar estos términos; el uso continuado implica que
            aceptas los cambios.
          </p>
        </>
      ) : (
        <>
          <p>
            By using OpenLen you agree to these terms. OpenLen is an open-source
            landing-page builder.
          </p>
          <h2>Your content</h2>
          <p>
            You own the pages and content you create. You&apos;re responsible for
            having the rights to anything you upload, and for not publishing
            illegal, harmful, or abusive content.
          </p>
          <h2>Acceptable use</h2>
          <p>
            Don&apos;t use OpenLen to break the law, infringe others&apos;
            rights, or distribute malware. We may suspend accounts that do.
          </p>
          <h2>Third-party deploys</h2>
          <p>
            Deploying to Vercel or GitHub is governed by those providers&apos;
            own terms. You connect your own accounts and are responsible for your
            usage there.
          </p>
          <h2>No warranty</h2>
          <p>
            OpenLen is provided &quot;as is&quot;, without warranties of any kind.
            The software is open source under AGPLv3.
          </p>
          <h2>Changes</h2>
          <p>
            We may update these terms; continued use means you accept the
            changes.
          </p>
        </>
      )}
    </LegalPage>
  );
}
