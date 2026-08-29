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
    title: es ? "Términos del servicio" : "Terms of Service",
    description: es
      ? "Los términos que rigen tu uso de OpenLen: cuentas, contenido, resultados de IA, facturación y responsabilidad."
      : "The terms that govern your use of OpenLen: accounts, content, AI output, billing, and liability.",
    alternates: { canonical: `${SITE_URL}/${locale}/terms` },
  };
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
            entre tú y <strong>Jesús Bernal, que opera OpenLen</strong>, y
            regulan tu uso de OpenLen, un creador de landing pages con
            inteligencia artificial disponible en openlen.com (el
            &quot;Servicio&quot;). Al crear una cuenta o usar el Servicio aceptas
            estos Términos. Si no estás de acuerdo, no uses el Servicio.
          </p>

          <h2>Quiénes somos y ley aplicable</h2>
          <p>
            El Servicio lo opera <strong>Jesús Bernal, que opera OpenLen</strong>,
            con base en México. Toda comunicación legal, de soporte, de abuso o de
            retiro de contenido se realiza por correo a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. Estos Términos
            se rigen por las leyes de México, y cualquier controversia se someterá
            a los tribunales competentes de México.
          </p>
          <p>
            <strong>Excepción para consumidores.</strong> Si eres un consumidor,
            conservas los derechos imperativos de protección al consumidor del país
            en el que resides y podrás demandar ante los tribunales de tu domicilio.
            Nada en estos Términos limita esos derechos imperativos. Si eres
            consumidor en México, también puedes acudir a la Procuraduría Federal
            del Consumidor (PROFECO). En materia de datos personales, la autoridad
            mexicana competente es la <strong>Secretaría Anticorrupción y Buena
            Administración</strong>, que asumió las funciones del antiguo INAI en
            marzo de 2025.
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
            Como titular de la cuenta de OpenLen, debes tener al menos 18 años, o
            la mayoría de edad en tu jurisdicción, para usar el Servicio. Puedes
            registrarte con correo y contraseña o
            mediante inicio de sesión de Google. Eres responsable de
            mantener la confidencialidad de tus credenciales y de toda la actividad
            que ocurra en tu cuenta. Avísanos de inmediato si detectas un uso no
            autorizado.
          </p>
          <p>
            Para eliminar tu cuenta y los datos asociados, escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>; consulta los
            detalles en nuestra <Link href="/privacy">Política de privacidad</Link>.
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
            En cumplimiento de la sección 13 de la AGPLv3, el código fuente
            correspondiente está disponible al público en{" "}
            <a href="https://github.com/orbita-pos/openlen">
              github.com/orbita-pos/openlen
            </a>
            . Esa licencia rige el código fuente, pero <strong>no</strong> rige tu
            uso de la instancia alojada en openlen.com: dicho uso se rige
            exclusivamente por estos Términos.
          </p>

          <h2>Tu contenido</h2>
          <p>
            Conservas la titularidad del contenido que tú creas, redactas o subes,
            incluidos los textos de tu brief, los activos que aportas, las páginas
            que editas y las versiones que guardas (tu &quot;Contenido&quot;). Nos
            otorgas una licencia limitada para alojar, procesar, mostrar y publicar
            tu Contenido con el único fin de prestarte el Servicio. Eres el único
            responsable de tu Contenido y de contar con todos los derechos
            necesarios sobre él. Esta titularidad cubre lo que tú aportas o autoras;
            no constituye una afirmación de titularidad sobre el resultado en bruto
            generado por la IA, que se rige por el apartado siguiente.
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
          <p>
            Con independencia del requisito de edad para tu propia cuenta, declaras
            y garantizas que no dirigirás las páginas que publiques a menores de 13
            años ni recopilarás a sabiendas datos personales de menores a través de
            ellas, y que dichas páginas cumplen la legislación aplicable en materia
            de publicidad, comercio electrónico y protección de datos.
          </p>
          <p>
            Podemos retirar o deshabilitar contenido cuando, de buena fe, estimemos
            que infringe estos Términos o la Política de uso aceptable, y no seremos
            responsables ante ti por hacerlo.
          </p>

          <h2>Resultados de la IA</h2>
          <p>
            El Servicio genera HTML mediante inteligencia artificial. El
            contenido generado por IA puede contener errores,
            inexactitudes u omisiones, y los resultados no están garantizados.
            Debes revisar todo el resultado antes de publicarlo. Eres responsable
            de cualquier página que decidas publicar.
          </p>
          <p>
            El HTML generado por IA puede incluir o asemejarse a material protegido
            por derechos de autor o marcas de terceros. OpenLen no garantiza que el
            resultado generado por IA sea original ni que no infrinja derechos de
            terceros, y no realiza ninguna manifestación de titularidad sobre el
            resultado en bruto de la IA. Antes de publicar, debes revisar y
            despejar todos los derechos necesarios sobre el material.
          </p>

          <h2>Páginas publicadas y alojamiento</h2>
          <p>
            Puedes publicar páginas en un subdominio{" "}
            <strong>&lt;nombre&gt;.openlen.com</strong> gratuito y conectar dominios
            propios. Nos reservamos el derecho de retirar contenido o suspender
            páginas que infrinjan estos Términos o nuestra Política de uso
            aceptable, sin aviso previo en casos graves.
          </p>

          <h2>Derechos de autor / DMCA</h2>
          <p>
            Respetamos los derechos de propiedad intelectual y respondemos a las
            notificaciones de presunta infracción conforme a la Digital Millennium
            Copyright Act (DMCA) de los Estados Unidos. Nuestro agente designado
            para recibir notificaciones de infracción de derechos de autor es
            accesible en{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>
          <p>
            <strong>Notificación de retiro.</strong> Para que una notificación sea
            efectiva conforme a la sección 512(c)(3), debe incluir sustancialmente
            lo siguiente:
          </p>
          <ul>
            <li>
              Identificación de la obra protegida por derechos de autor que se
              alega infringida.
            </li>
            <li>
              Identificación del material presuntamente infractor y la información
              razonablemente suficiente para localizarlo (por ejemplo, la URL o el
              identificador del material).
            </li>
            <li>
              Tus datos de contacto (nombre, dirección, teléfono y correo
              electrónico).
            </li>
            <li>
              Una declaración de que tienes la creencia de buena fe de que el uso
              del material no está autorizado por el titular, su agente o la ley.
            </li>
            <li>
              Una declaración de que la información de la notificación es exacta y,
              bajo pena de perjurio, de que estás autorizado para actuar en nombre
              del titular de los derechos.
            </li>
            <li>Tu firma física o electrónica.</li>
          </ul>
          <p>
            <strong>Contranotificación.</strong> Si se ha retirado o deshabilitado
            material tuyo y consideras que fue por error o identificación errónea,
            puedes enviar una contranotificación a nuestro agente designado
            conforme a la sección 512(g), que debe incluir sustancialmente: tu
            firma física o electrónica; la identificación del material retirado y la
            ubicación en la que aparecía antes de su retiro; una declaración bajo
            pena de perjurio de que crees de buena fe que el material se retiró o
            deshabilitó por error o identificación errónea; y tus datos de contacto,
            junto con tu consentimiento a la jurisdicción de los tribunales federales
            competentes. Salvo que el reclamante inicie una acción judicial, podremos
            restaurar el material retirado en un plazo aproximado de 10 a 14 días
            hábiles tras la recepción de la contranotificación.
          </p>
          <p>
            <strong>Infractores reincidentes.</strong> En las circunstancias
            apropiadas, cancelaremos las cuentas de los usuarios que sean
            infractores reincidentes.
          </p>

          <h2>Exportaciones a terceros</h2>
          <p>
            Si decides exportar o desplegar tu página en Vercel o GitHub, esos
            servicios se rigen por sus propios términos. Conectas tus propias
            cuentas y eres responsable del uso que hagas en ellas.
          </p>

          <h2>Facturación</h2>
          <p>
            El plan Pro cuesta US$3.99 al mes e incluye 150 créditos de IA al mes; el
            plan gratuito incluye 20 créditos al mes. Los créditos se reinician
            cada mes y no se acumulan. Los pagos son procesados por{" "}
            <strong>Polar</strong> (Polar Software Inc., Estados Unidos), que actúa
            como <strong>comerciante registrado (Merchant of Record)</strong>:
            Polar es el vendedor legal, procesa tus datos de pago y de facturación
            (datos financieros o patrimoniales), emite la factura o recibo y recauda
            y remite los impuestos aplicables. OpenLen solo conserva el estado de tu
            suscripción y tu plan; <strong>nunca</strong> almacena números de
            tarjeta. Consulta los detalles de cancelación y reembolso en nuestra{" "}
            <Link href="/refund">Política de reembolsos</Link>.
          </p>

          <h2>Supervisión de errores</h2>
          <p>
            Para detectar y corregir fallos del Servicio utilizamos InariWatch
            (@inariwatch/capture), una herramienta de captura de errores
            desarrollada por el mismo operador que OpenLen. Por ello se trata de
            captura de errores propia (de primera parte) y no de un tercero
            independiente.
          </p>

          <h2>Renuncia de garantías</h2>
          <p>
            El Servicio se proporciona &quot;tal cual&quot; y &quot;según
            disponibilidad&quot;, sin garantías de ningún tipo, ya sean expresas o
            implícitas, incluidas las garantías de comerciabilidad, idoneidad para
            un fin determinado y no infracción. No garantizamos que el Servicio sea
            ininterrumpido, esté libre de errores o cumpla tus expectativas. Si eres
            consumidor, esta renuncia se aplica únicamente en la medida permitida por
            la legislación de protección al consumidor aplicable (incluida la Ley
            Federal de Protección al Consumidor, LFPC).
          </p>

          <h2>Limitación de responsabilidad</h2>
          <p>
            En la máxima medida permitida por la ley, OpenLen no será responsable
            por daños indirectos, incidentales, especiales, consecuentes o
            punitivos, ni por pérdida de datos, ingresos o beneficios. Nuestra
            responsabilidad total agregada derivada del Servicio no excederá la
            mayor de las siguientes cantidades: las cantidades que nos hayas pagado
            en los doce meses anteriores al hecho que dé origen a la reclamación, o
            US$100. Si eres consumidor, estas limitaciones se aplican únicamente en
            la medida permitida por la legislación de protección al consumidor
            aplicable (incluida la LFPC).
          </p>
          <p>
            <strong>Excepción imperativa.</strong> Nada en estos Términos excluye ni
            limita nuestra responsabilidad cuando, conforme a la ley aplicable, dicha
            responsabilidad no pueda excluirse ni limitarse, ni los derechos
            imperativos que la legislación de protección al consumidor te reconozca.
          </p>

          <h2>Indemnización</h2>
          <p>
            Aceptas indemnizar y mantener indemne a OpenLen frente a cualquier
            reclamación, daño o gasto derivado de tu Contenido, tu uso del Servicio
            o tu incumplimiento de estos Términos, salvo en la medida en que la
            reclamación derive del contenido de las plantillas propias de OpenLen,
            del código del Servicio, o de la negligencia grave o conducta dolosa de
            OpenLen.
          </p>
          <p>
            Como condición de esta indemnización, te notificaremos por escrito y sin
            demora indebida toda reclamación cubierta; OpenLen podrá participar en la
            defensa con sus propios abogados a su costa; y no podrás celebrar ningún
            acuerdo que admita responsabilidad o culpa de OpenLen sin su
            consentimiento previo por escrito.
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

          <h2>Divisibilidad</h2>
          <p>
            Si alguna disposición de estos Términos se considera inválida, ilegal o
            inexigible, dicha disposición se limitará o eliminará en la mínima medida
            necesaria, y las demás disposiciones de estos Términos seguirán siendo
            plenamente válidas y exigibles.
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
            you and <strong>Jesús Bernal, operating OpenLen</strong>, and govern
            your use of OpenLen, an AI landing-page builder available at openlen.com
            (the &quot;Service&quot;). By creating an account or using the Service
            you agree to these Terms. If you don&apos;t agree, don&apos;t use the
            Service.
          </p>

          <h2>Who we are and governing law</h2>
          <p>
            The Service is operated by <strong>Jesús Bernal, operating
            OpenLen</strong>, based in Mexico. All legal, support, abuse, and
            content-takedown communication is handled by email at{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. These Terms are
            governed by the laws of Mexico, and any dispute will be submitted to
            the competent courts of Mexico.
          </p>
          <p>
            <strong>Consumer carve-out.</strong> If you are a consumer, you keep the
            mandatory consumer-protection rights of your country of residence and
            may bring proceedings in the courts of your domicile. Nothing in these
            Terms limits those mandatory rights. If you are a consumer in Mexico,
            you may also turn to the Federal Consumer Protection Agency (PROFECO).
            For personal-data matters, the competent Mexican authority is the{" "}
            <strong>Secretaría Anticorrupción y Buena Administración</strong>, which
            assumed the former INAI&apos;s functions in March 2025.
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
            As the OpenLen account holder, you must be at least 18 years old, or
            the age of majority in your jurisdiction, to use the Service. You can
            sign up with email and
            password or via Google or GitHub sign-in. You&apos;re responsible for
            keeping your credentials confidential and for all activity that occurs
            under your account. Tell us right away if you notice any unauthorized
            use.
          </p>
          <p>
            To delete your account and associated data, email{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>; see our{" "}
            <Link href="/privacy">Privacy Policy</Link> for details.
          </p>

          <h2>License to use the hosted service</h2>
          <p>
            Subject to these Terms, we grant you a limited, non-exclusive,
            non-transferable license to use the hosted Service to create, edit, and
            publish pages. This license is separate from the source-code license.
          </p>
          <p>
            <strong>Open source vs. hosted service.</strong> The OpenLen code is
            open source and distributed under the AGPLv3 license. In compliance with
            section 13 of the AGPLv3, the corresponding source code is publicly
            available at{" "}
            <a href="https://github.com/orbita-pos/openlen">
              github.com/orbita-pos/openlen
            </a>
            . That license governs the source code but does <strong>not</strong>{" "}
            govern your use of the hosted instance at openlen.com: your use of the
            hosted Service is governed solely by these Terms.
          </p>

          <h2>Your content</h2>
          <p>
            You retain ownership of the content you create, author, or upload,
            including your brief text, the assets you provide, the pages you edit,
            and the versions you save (your &quot;Content&quot;). You grant us a
            limited license to host, process, display, and publish your Content for
            the sole purpose of providing the Service to you. You are solely
            responsible for your Content and for having all rights necessary to it.
            This ownership covers what you contribute or author; it is not a claim
            of ownership over raw AI output, which is governed by the next section.
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
          <p>
            Separately from the age requirement for your own account, you represent
            and warrant that you will not target the pages you publish at children
            under 13 or knowingly collect children&apos;s personal data through
            them, and that those pages comply with applicable advertising,
            e-commerce, and data-protection law.
          </p>
          <p>
            We may remove or disable content on a good-faith belief that it violates
            these Terms or the Acceptable Use Policy, and we will not be liable to
            you for doing so.
          </p>

          <h2>AI output</h2>
          <p>
            The Service generates HTML using artificial intelligence.
            AI-generated content may contain errors, inaccuracies, or
            omissions, and results are not guaranteed. You must review all output
            before publishing it. You are responsible for any page you choose to
            publish.
          </p>
          <p>
            AI-generated HTML may include or resemble third-party copyrighted or
            trademarked material. OpenLen does not warrant that AI output is original
            or non-infringing, and makes no representation of ownership of the raw AI
            output. You must review and clear all necessary rights in the material
            before publishing.
          </p>

          <h2>Published pages and hosting</h2>
          <p>
            You can publish pages to a free{" "}
            <strong>&lt;name&gt;.openlen.com</strong> subdomain and connect your own
            custom domains. We reserve the right to take down content or suspend
            pages that violate these Terms or our Acceptable Use Policy, without
            prior notice in egregious cases.
          </p>

          <h2>Copyright / DMCA</h2>
          <p>
            We respect intellectual-property rights and respond to notices of
            claimed infringement under the U.S. Digital Millennium Copyright Act
            (DMCA). Our designated agent to receive notifications of claimed
            copyright infringement can be reached at{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>
          <p>
            <strong>Takedown notice.</strong> To be effective under section
            512(c)(3), a notice must include substantially the following:
          </p>
          <ul>
            <li>
              Identification of the copyrighted work claimed to have been infringed.
            </li>
            <li>
              Identification of the allegedly infringing material and information
              reasonably sufficient to locate it (for example, the material&apos;s
              URL or identifier).
            </li>
            <li>
              Your contact information (name, address, telephone number, and email
              address).
            </li>
            <li>
              A statement that you have a good-faith belief that use of the material
              is not authorized by the copyright owner, its agent, or the law.
            </li>
            <li>
              A statement that the information in the notice is accurate and, under
              penalty of perjury, that you are authorized to act on behalf of the
              copyright owner.
            </li>
            <li>Your physical or electronic signature.</li>
          </ul>
          <p>
            <strong>Counter-notification.</strong> If your material has been removed
            or disabled and you believe this was the result of mistake or
            misidentification, you may send a counter-notification to our designated
            agent under section 512(g), which must include substantially: your
            physical or electronic signature; identification of the removed material
            and the location at which it appeared before it was removed; a statement
            under penalty of perjury that you have a good-faith belief that the
            material was removed or disabled as a result of mistake or
            misidentification; and your contact information, together with your
            consent to the jurisdiction of the competent federal court. Unless the
            complainant files a court action, we may restore the removed material in
            approximately 10 to 14 business days after we receive the
            counter-notification.
          </p>
          <p>
            <strong>Repeat infringers.</strong> In appropriate circumstances, we
            will terminate the accounts of users who are repeat infringers.
          </p>

          <h2>Third-party exports</h2>
          <p>
            If you choose to export or deploy your page to Vercel or GitHub, those
            services are governed by their own terms. You connect your own accounts
            and are responsible for your usage there.
          </p>

          <h2>Billing</h2>
          <p>
            The Pro plan costs US$3.99 per month and includes 150 AI credits per
            month; the free tier includes 20 credits per month. Credits reset each
            month and do not roll over. Payments are processed by{" "}
            <strong>Polar</strong> (Polar Software Inc., United States), which acts
            as the <strong>Merchant of Record</strong>: Polar is the legal seller,
            processes your payment and billing (financial/patrimonial) data, issues
            the invoice or receipt, and collects and remits applicable taxes.
            OpenLen stores only your subscription status and plan; it{" "}
            <strong>never</strong> stores card numbers. See our{" "}
            <Link href="/refund">Refund &amp; Cancellation Policy</Link> for
            cancellation and refund details.
          </p>

          <h2>Error monitoring</h2>
          <p>
            To detect and fix Service faults we use InariWatch
            (@inariwatch/capture), an error-capture tool built by the same operator
            as OpenLen. For that reason it is first-party error capture, not an
            independent third party.
          </p>

          <h2>Disclaimer of warranties</h2>
          <p>
            The Service is provided &quot;as is&quot; and &quot;as
            available&quot;, without warranties of any kind, whether express or
            implied, including warranties of merchantability, fitness for a
            particular purpose, and non-infringement. We don&apos;t warrant that the
            Service will be uninterrupted, error-free, or meet your expectations. If
            you are a consumer, this disclaimer applies only to the extent permitted
            by applicable consumer-protection law (including Mexico&apos;s Federal
            Consumer Protection Law, LFPC).
          </p>

          <h2>Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, OpenLen will not be liable for
            indirect, incidental, special, consequential, or punitive damages, or
            for loss of data, revenue, or profits. Our total aggregate liability
            arising out of the Service will not exceed the greater of the amounts
            you paid us in the twelve months before the event giving rise to the
            claim or US$100. If you are a consumer, these limitations apply only to
            the extent permitted by applicable consumer-protection law (including
            the LFPC).
          </p>
          <p>
            <strong>Mandatory carve-out.</strong> Nothing in these Terms excludes or
            limits our liability where, under applicable law, such liability cannot
            be excluded or limited, nor the mandatory rights granted to you by
            consumer-protection law.
          </p>

          <h2>Indemnification</h2>
          <p>
            You agree to indemnify and hold OpenLen harmless from any claim,
            damage, or expense arising out of your Content, your use of the Service,
            or your breach of these Terms, except to the extent the claim arises
            from OpenLen&apos;s own template content, the Service code, or
            OpenLen&apos;s gross negligence or willful misconduct.
          </p>
          <p>
            As a condition of this indemnity, we will give you prompt written notice
            of any covered claim; OpenLen may participate in the defense with its own
            counsel at its own expense; and you may not enter into any settlement
            that admits liability or fault on OpenLen&apos;s part without its prior
            written consent.
          </p>

          <h2>Suspension and termination</h2>
          <p>
            You may stop using the Service at any time. We may suspend or terminate
            your access if you violate these Terms or our Acceptable Use Policy.
            Upon termination, your right to use the Service ends; provisions that by
            their nature should survive (Content ownership, disclaimers, limitation
            of liability, and indemnification) will remain in effect.
          </p>

          <h2>Severability</h2>
          <p>
            If any provision of these Terms is held to be invalid, illegal, or
            unenforceable, that provision will be limited or eliminated to the
            minimum extent necessary, and the remaining provisions of these Terms
            will remain in full force and effect.
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