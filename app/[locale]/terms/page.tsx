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
  return { title: locale === "es" ? "Términos del servicio" : "Terms of Service" };
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
      title={es ? "Términos del servicio" : "Terms of Service"}
      updated={es ? "Última actualización: 30 de mayo de 2026" : "Last updated: May 30, 2026"}
    >
      {es ? (
        <>
          <p>
            Estos Términos del servicio (los &quot;Términos&quot;) son un acuerdo
            entre tú y OpenLen y regulan tu uso de OpenLen, un creador de landing
            pages con inteligencia artificial disponible en openlen.com (el
            &quot;Servicio&quot;). Al crear una cuenta o usar el Servicio aceptas
            estos Términos. Si no estás de acuerdo, no uses el Servicio.
          </p>

          <h2>Quiénes somos y ley aplicable</h2>
          <p>
            El Servicio lo opera OpenLen desde México. Toda comunicación legal,
            de soporte, de abuso o de retiro de contenido se realiza por correo a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. Estos Términos
            se rigen por las leyes de México, y cualquier controversia se someterá
            a los tribunales competentes de México.
          </p>

          <h2>Aceptación de los Términos</h2>
          <p>
            Al acceder o utilizar el Servicio confirmas que has leído y aceptado
            estos Términos, así como nuestra{" "}
            <Link href="/privacy">Política de privacidad</Link> y nuestra{" "}
            <Link href="/acceptable-use">Política de uso aceptable</Link>, que se
            incorporan por referencia.
          </p>

          <h2>Elegibilidad y cuentas</h2>
          <p>
            Debes tener al menos 18 años, o la mayoría de edad en tu jurisdicción,
            para usar el Servicio. Puedes registrarte con correo y contraseña o
            mediante inicio de sesión de Google o GitHub. Eres responsable de
            mantener la confidencialidad de tus credenciales y de toda la actividad
            que ocurra en tu cuenta. Avísanos de inmediato si detectas un uso no
            autorizado.
          </p>

          <h2>Licencia para usar el Servicio alojado</h2>
          <p>
            Sujeto a estos Términos, te otorgamos una licencia limitada, no
            exclusiva e intransferible para usar el Servicio alojado para crear,
            editar y publicar páginas. Esta licencia es independiente de la
            licencia del código fuente.
          </p>
          <p>
            <strong>Código abierto frente a servicio alojado.</strong> El código de
            OpenLen es de código abierto y se distribuye bajo la licencia AGPLv3.
            Esa licencia rige el código fuente, pero <strong>no</strong> rige tu
            uso de la instancia alojada en openlen.com: dicho uso se rige
            exclusivamente por estos Términos.
          </p>

          <h2>Tu contenido</h2>
          <p>
            Conservas la titularidad de todo el contenido que creas o subes,
            incluidos los textos de tu brief, el HTML, las páginas, las versiones
            guardadas y los activos (tu &quot;Contenido&quot;). Nos otorgas una
            licencia limitada para alojar, procesar, mostrar y publicar tu
            Contenido con el único fin de prestarte el Servicio. Eres el único
            responsable de tu Contenido y de contar con todos los derechos
            necesarios sobre él.
          </p>

          <h2>Uso aceptable</h2>
          <p>
            Tu uso del Servicio debe cumplir nuestra{" "}
            <Link href="/acceptable-use">Política de uso aceptable</Link>. Entre
            otras cosas, queda prohibido publicar contenido ilegal, phishing,
            fraude, malware, material de abuso infantil, discurso de odio, acoso,
            difamación, infracción de derechos de terceros o spam. Si recopilas
            datos de tus visitantes mediante formularios, debes tener tu propia
            base de licitud y aviso de privacidad.
          </p>

          <h2>Resultados de la IA</h2>
          <p>
            El Servicio genera HTML mediante inteligencia artificial (Google
            Gemini). El contenido generado por IA puede contener errores,
            inexactitudes u omisiones, y los resultados no están garantizados.
            Debes revisar todo el resultado antes de publicarlo. Eres responsable
            de cualquier página que decidas publicar.
          </p>

          <h2>Páginas publicadas y alojamiento</h2>
          <p>
            Puedes publicar páginas en un subdominio{" "}
            <strong>&lt;nombre&gt;.openlen.com</strong> gratuito y conectar dominios
            propios. Nos reservamos el derecho de retirar contenido o suspender
            páginas que infrinjan estos Términos o nuestra Política de uso
            aceptable, sin aviso previo en casos graves. Para denuncias de abuso o
            retiros por propiedad intelectual (estilo DMCA), escribe a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>

          <h2>Exportaciones a terceros</h2>
          <p>
            Si decides exportar o desplegar tu página en Vercel o GitHub, esos
            servicios se rigen por sus propios términos. Conectas tus propias
            cuentas y eres responsable del uso que hagas en ellas.
          </p>

          <h2>Facturación</h2>
          <p>
            El plan Pro cuesta US$7 al mes e incluye 150 créditos de IA al mes; el
            plan gratuito incluye 20 créditos al mes. Los créditos se reinician
            cada mes y no se acumulan. Los pagos son procesados por{" "}
            <strong>Polar</strong>, que actúa como <strong>comerciante de
            registro (Merchant of Record)</strong>: Polar es el vendedor legal,
            emite la factura o recibo y recauda y remite los impuestos aplicables.
            Consulta los detalles de cancelación y reembolso en nuestra{" "}
            <Link href="/refund">Política de reembolsos</Link>.
          </p>

          <h2>Renuncia de garantías</h2>
          <p>
            El Servicio se proporciona &quot;tal cual&quot; y &quot;según
            disponibilidad&quot;, sin garantías de ningún tipo, ya sean expresas o
            implícitas, incluidas las garantías de comerciabilidad, idoneidad para
            un fin determinado y no infracción. No garantizamos que el Servicio sea
            ininterrumpido, esté libre de errores o cumpla tus expectativas.
          </p>

          <h2>Limitación de responsabilidad</h2>
          <p>
            En la máxima medida permitida por la ley, OpenLen no será responsable
            por daños indirectos, incidentales, especiales, consecuentes o
            punitivos, ni por pérdida de datos, ingresos o beneficios. Nuestra
            responsabilidad total agregada derivada del Servicio no excederá las
            cantidades que nos hayas pagado en los doce meses anteriores al hecho
            que dé origen a la reclamación.
          </p>

          <h2>Indemnización</h2>
          <p>
            Aceptas indemnizar y mantener indemne a OpenLen frente a cualquier
            reclamación, daño o gasto derivado de tu Contenido, tu uso del
            Servicio o tu incumplimiento de estos Términos.
          </p>

          <h2>Suspensión y terminación</h2>
          <p>
            Puedes dejar de usar el Servicio en cualquier momento. Podemos
            suspender o cancelar tu acceso si infringes estos Términos o nuestra
            Política de uso aceptable. Tras la terminación, tu derecho a usar el
            Servicio cesa; las disposiciones que por su naturaleza deban subsistir
            (titularidad del Contenido, renuncias, limitación de responsabilidad e
            indemnización) seguirán vigentes.
          </p>

          <h2>Cambios en los Términos</h2>
          <p>
            Podemos actualizar estos Términos de vez en cuando. Si los cambios son
            sustanciales, lo indicaremos actualizando la fecha de esta página. El
            uso continuado del Servicio tras la actualización implica que aceptas
            los nuevos Términos.
          </p>

          <h2>Contacto</h2>
          <p>
            ¿Preguntas sobre estos Términos? Escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. Consulta también
            nuestra <Link href="/privacy">Política de privacidad</Link>, la{" "}
            <Link href="/acceptable-use">Política de uso aceptable</Link>, la{" "}
            <Link href="/refund">Política de reembolsos</Link> y la lista de{" "}
            <Link href="/subprocessors">subencargados</Link>.
          </p>
        </>
      ) : (
        <>
          <p>
            These Terms of Service (the &quot;Terms&quot;) are an agreement between
            you and OpenLen and govern your use of OpenLen, an AI landing-page
            builder available at openlen.com (the &quot;Service&quot;). By creating
            an account or using the Service you agree to these Terms. If you
            don&apos;t agree, don&apos;t use the Service.
          </p>

          <h2>Who we are and governing law</h2>
          <p>
            The Service is operated by OpenLen from Mexico. All legal, support,
            abuse, and content-takedown communication is handled by email at{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. These Terms are
            governed by the laws of Mexico, and any dispute will be submitted to
            the competent courts of Mexico.
          </p>

          <h2>Acceptance of the Terms</h2>
          <p>
            By accessing or using the Service you confirm that you have read and
            agree to these Terms, as well as our{" "}
            <Link href="/privacy">Privacy Policy</Link> and our{" "}
            <Link href="/acceptable-use">Acceptable Use Policy</Link>, which are
            incorporated by reference.
          </p>

          <h2>Eligibility and accounts</h2>
          <p>
            You must be at least 18 years old, or the age of majority in your
            jurisdiction, to use the Service. You can sign up with email and
            password or via Google or GitHub sign-in. You&apos;re responsible for
            keeping your credentials confidential and for all activity that occurs
            under your account. Tell us right away if you notice any unauthorized
            use.
          </p>

          <h2>License to use the hosted service</h2>
          <p>
            Subject to these Terms, we grant you a limited, non-exclusive,
            non-transferable license to use the hosted Service to create, edit, and
            publish pages. This license is separate from the source-code license.
          </p>
          <p>
            <strong>Open source vs. hosted service.</strong> The OpenLen code is
            open source and distributed under the AGPLv3 license. That license
            governs the source code but does <strong>not</strong> govern your use
            of the hosted instance at openlen.com: your use of the hosted Service is
            governed solely by these Terms.
          </p>

          <h2>Your content</h2>
          <p>
            You retain ownership of all content you create or upload, including your
            brief text, HTML, pages, saved versions, and assets (your
            &quot;Content&quot;). You grant us a limited license to host, process,
            display, and publish your Content for the sole purpose of providing the
            Service to you. You are solely responsible for your Content and for
            having all rights necessary to it.
          </p>

          <h2>Acceptable use</h2>
          <p>
            Your use of the Service must comply with our{" "}
            <Link href="/acceptable-use">Acceptable Use Policy</Link>. Among other
            things, you may not publish illegal content, phishing, fraud, malware,
            child sexual abuse material, hate speech, harassment, defamation,
            infringement of others&apos; rights, or spam. If you collect visitor
            data through forms, you must have your own lawful basis and privacy
            notice.
          </p>

          <h2>AI output</h2>
          <p>
            The Service generates HTML using artificial intelligence (Google
            Gemini). AI-generated content may contain errors, inaccuracies, or
            omissions, and results are not guaranteed. You must review all output
            before publishing it. You are responsible for any page you choose to
            publish.
          </p>

          <h2>Published pages and hosting</h2>
          <p>
            You can publish pages to a free{" "}
            <strong>&lt;name&gt;.openlen.com</strong> subdomain and connect your own
            custom domains. We reserve the right to take down content or suspend
            pages that violate these Terms or our Acceptable Use Policy, without
            prior notice in egregious cases. For abuse reports or
            intellectual-property takedowns (DMCA-style), email{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>

          <h2>Third-party exports</h2>
          <p>
            If you choose to export or deploy your page to Vercel or GitHub, those
            services are governed by their own terms. You connect your own accounts
            and are responsible for your usage there.
          </p>

          <h2>Billing</h2>
          <p>
            The Pro plan costs US$7 per month and includes 150 AI credits per
            month; the free tier includes 20 credits per month. Credits reset each
            month and do not roll over. Payments are processed by{" "}
            <strong>Polar</strong>, which acts as the{" "}
            <strong>Merchant of Record</strong>: Polar is the legal seller, issues
            the invoice or receipt, and collects and remits applicable taxes. See
            our <Link href="/refund">Refund &amp; Cancellation Policy</Link> for
            cancellation and refund details.
          </p>

          <h2>Disclaimer of warranties</h2>
          <p>
            The Service is provided &quot;as is&quot; and &quot;as
            available&quot;, without warranties of any kind, whether express or
            implied, including warranties of merchantability, fitness for a
            particular purpose, and non-infringement. We don&apos;t warrant that the
            Service will be uninterrupted, error-free, or meet your expectations.
          </p>

          <h2>Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, OpenLen will not be liable for
            indirect, incidental, special, consequential, or punitive damages, or
            for loss of data, revenue, or profits. Our total aggregate liability
            arising out of the Service will not exceed the amounts you paid us in
            the twelve months before the event giving rise to the claim.
          </p>

          <h2>Indemnification</h2>
          <p>
            You agree to indemnify and hold OpenLen harmless from any claim,
            damage, or expense arising out of your Content, your use of the Service,
            or your breach of these Terms.
          </p>

          <h2>Suspension and termination</h2>
          <p>
            You may stop using the Service at any time. We may suspend or terminate
            your access if you violate these Terms or our Acceptable Use Policy.
            Upon termination, your right to use the Service ends; provisions that by
            their nature should survive (Content ownership, disclaimers, limitation
            of liability, and indemnification) will remain in effect.
          </p>

          <h2>Changes to the Terms</h2>
          <p>
            We may update these Terms from time to time. If changes are material, we
            will indicate this by updating the date on this page. Continued use of
            the Service after an update means you accept the new Terms.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about these Terms? Email{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. See also our{" "}
            <Link href="/privacy">Privacy Policy</Link>, the{" "}
            <Link href="/acceptable-use">Acceptable Use Policy</Link>, the{" "}
            <Link href="/refund">Refund &amp; Cancellation Policy</Link>, and our
            list of <Link href="/subprocessors">subprocessors</Link>.
          </p>
        </>
      )}
    </LegalPage>
  );
}
