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
    title: es ? "Política de uso aceptable" : "Acceptable Use Policy",
    description: es
      ? "Qué no está permitido al crear, publicar, exportar o distribuir páginas con OpenLen, y cómo aplicamos estas reglas."
      : "What is not allowed when creating, publishing, exporting, or distributing pages with OpenLen, and how we enforce these rules.",
    alternates: { canonical: `${SITE_URL}/${locale}/acceptable-use` },
  };
}

export default async function AcceptableUsePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const es = locale === "es";

  return (
    <LegalPage
      title={es ? "Política de uso aceptable" : "Acceptable Use Policy"}
      updated={es ? "Última actualización: 12 de junio de 2026" : "Last updated: June 12, 2026"}
    >
      {es ? (
        <>
          <p>
            OpenLen es un creador de landing pages que te permite publicar HTML
            arbitrario en subdominios <strong>&lt;nombre&gt;.openlen.com</strong>,
            conectar tu propio dominio y exportar tu página a Vercel o GitHub. El
            Servicio lo opera <strong>Jesús Bernal, que opera OpenLen</strong>,
            con sede en México. Esta Política de uso aceptable describe lo que no
            está permitido al usar OpenLen para crear, publicar, exportar o
            distribuir páginas. Forma parte de nuestros{" "}
            <Link href="/terms">Términos del servicio</Link> y debe leerse junto
            con nuestra <Link href="/privacy">Política de privacidad</Link>.
          </p>

          <h2>Contenido y conducta prohibidos</h2>
          <p>
            No puedes usar OpenLen —ni el contenido que crees, publiques o
            exportes con él— para lo siguiente:
          </p>
          <ul>
            <li>
              <strong>Contenido ilegal</strong> — cualquier material o actividad
              que infrinja la ley aplicable.
            </li>
            <li>
              <strong>Phishing, fraude y estafas</strong> — páginas diseñadas
              para engañar a las personas y obtener credenciales, datos de pago
              o dinero de forma fraudulenta.
            </li>
            <li>
              <strong>Estafas financieras y de criptomonedas</strong> — esquemas
              de inversión fraudulentos, falsos sorteos o &quot;giveaways&quot;,
              airdrops engañosos y cualquier página creada para apropiarse de
              fondos o activos digitales de las personas.
            </li>
            <li>
              <strong>Malware</strong> — distribución de virus, troyanos,
              scripts maliciosos o cualquier código destinado a dañar
              dispositivos o sistemas, o a comprometer su seguridad.
            </li>
            <li>
              <strong>Material de abuso sexual infantil (CSAM)</strong> —
              tolerancia cero; este contenido se elimina de inmediato y se
              denuncia a las autoridades competentes.
            </li>
            <li>
              <strong>Imágenes íntimas no consentidas (NCII)</strong> — contenido
              sexual o íntimo que represente a personas reales sin su
              consentimiento, incluida la difusión de imágenes privadas y los
              montajes sexuales no consentidos de personas reales.
            </li>
            <li>
              <strong>Contenido sexual explícito o para adultos</strong> —
              pornografía, material sexual explícito y servicios para adultos
              (incluidos los basados en suscripción a creadores de contenido
              para adultos), ya sea su publicación o su venta a través del
              Servicio. Esta restricción refleja las políticas de nuestros
              proveedores de pago e infraestructura, que no permiten este tipo
              de contenido.
            </li>
            <li>
              <strong>Contenido terrorista o extremista violento</strong> —
              material que promueva, glorifique o facilite el terrorismo, el
              extremismo violento o actos de violencia contra personas o grupos.
            </li>
            <li>
              <strong>Odio, acoso y doxxing</strong> — discurso de odio,
              hostigamiento dirigido, amenazas o la divulgación de información
              privada de terceros sin su consentimiento.
            </li>
            <li>
              <strong>Difamación</strong> — afirmaciones falsas que dañen la
              reputación de una persona o entidad.
            </li>
            <li>
              <strong>Venta de bienes regulados o falsificados</strong> — oferta
              o venta de drogas, sustancias controladas, armas, productos
              falsificados u otros bienes y servicios cuya venta esté restringida
              o prohibida por la ley aplicable.
            </li>
            <li>
              <strong>Infracción de propiedad intelectual o marcas</strong> —
              publicar contenido, logotipos o marcas sobre los que no tengas
              derechos o licencia.
            </li>
            <li>
              <strong>Spam</strong> — envío masivo o no solicitado de mensajes,
              o páginas creadas principalmente para difundirlos.
            </li>
            <li>
              <strong>Scraping no autorizado</strong> — extracción automatizada
              de datos de terceros sin permiso o en contra de sus condiciones.
            </li>
            <li>
              <strong>Suplantación engañosa</strong> — hacerte pasar por otra
              persona, marca u organización con intención de engañar.
            </li>
            <li>
              <strong>Encubrimiento engañoso (cloaking)</strong> — mostrar a
              OpenLen un contenido distinto del que reciben las personas que
              visitan tu página, con el fin de eludir la moderación o nuestras
              reglas.
            </li>
          </ul>

          <h2>Páginas que recopilan datos de visitantes</h2>
          <p>
            Si tu página publicada recopila datos de visitantes (por ejemplo,
            mediante formularios), tú actúas como responsable del tratamiento de
            esos datos y OpenLen actúa como encargado, conforme a la Ley Federal
            de Protección de Datos Personales en Posesión de los Particulares
            (LFPDPPP). Debes contar con una base legal para recopilarlos,
            publicar tu propio aviso de privacidad y atender los derechos de las
            personas usuarias. En México, la autoridad de protección de datos es
            la <strong>Secretaría Anticorrupción y Buena Administración</strong>,
            que asumió las funciones del extinto INAI en marzo de 2025. Las
            páginas que crees pueden incluir código de terceros que establezca
            cookies u otros mecanismos de seguimiento; gestionar ese código y su
            cumplimiento es tu responsabilidad.
          </p>

          <h2>Pagos y servicios que usamos</h2>
          <p>
            Los pagos de los planes de pago se procesan a través de{" "}
            <strong>Polar</strong> (Polar Software Inc., Estados Unidos), que
            actúa como comerciante registrado (Merchant of Record): Polar trata
            los datos financieros y patrimoniales del cobro, emite la factura y
            recauda los impuestos. OpenLen solo conserva el estado de tu
            suscripción y tu plan; nunca almacenamos los números de tarjeta. Para
            la captura de errores usamos <strong>InariWatch</strong>{" "}
            (<code>@inariwatch/capture</code>), un producto hermano del mismo
            operador, por lo que esta captura de errores es de primera parte y no
            un tercero independiente.
          </p>

          <h2>Aplicación</h2>
          <p>
            Si una página o cuenta incumple esta política, podemos retirar el
            contenido afectado y suspender o cancelar la cuenta. En casos
            especialmente graves —como CSAM, NCII, contenido terrorista, malware
            o phishing activo— podemos retirar el contenido sin aviso previo. La
            exportación a Vercel o GitHub no te exime de estas reglas mientras
            uses OpenLen.
          </p>
          <p>
            Cuando sea razonablemente posible, te avisaremos antes de retirar
            contenido o suspender tu cuenta y te indicaremos el motivo. Puedes
            apelar cualquier medida escribiéndonos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. Salvo en casos
            especialmente graves, tendrás la oportunidad de exportar tu contenido
            antes de que se elimine. Constituyen motivos de suspensión o
            cancelación, entre otros, el incumplimiento de esta política o de los{" "}
            <Link href="/terms">Términos del servicio</Link>, el uso fraudulento o
            abusivo del Servicio, y la falta de pago de un plan de pago.
          </p>

          <h2>Denuncias de abuso y propiedad intelectual</h2>
          <p>
            Para denunciar abusos, usa nuestro{" "}
            <Link href="/report-abuse">formulario de reporte</Link> o
            escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a> e incluye la
            URL afectada y una descripción del problema. Para solicitar la
            retirada de contenido por infracción de propiedad intelectual (estilo
            DMCA), consulta la sección de propiedad intelectual y derechos de
            autor en nuestros{" "}
            <Link href="/terms">Términos del servicio</Link>; dirige el aviso a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>, que actúa como
            agente designado para tales avisos.
          </p>
        </>
      ) : (
        <>
          <p>
            OpenLen is a landing-page builder that lets you publish arbitrary
            HTML to <strong>&lt;name&gt;.openlen.com</strong> subdomains, attach
            your own custom domain, and export your page to Vercel or GitHub. The
            Service is operated by{" "}
            <strong>Jesús Bernal, operating OpenLen</strong>, based in Mexico.
            This Acceptable Use Policy describes what is not allowed when you use
            OpenLen to create, publish, export, or distribute pages. It forms
            part of our <Link href="/terms">Terms of Service</Link> and should be
            read alongside our <Link href="/privacy">Privacy Policy</Link>.
          </p>

          <h2>Prohibited content and conduct</h2>
          <p>
            You may not use OpenLen — or the content you create, publish, or
            export with it — for any of the following:
          </p>
          <ul>
            <li>
              <strong>Illegal content</strong> — any material or activity that
              violates applicable law.
            </li>
            <li>
              <strong>Phishing, fraud, and scams</strong> — pages designed to
              deceive people into handing over credentials, payment details, or
              money.
            </li>
            <li>
              <strong>Financial and crypto scams</strong> — fraudulent investment
              schemes, fake giveaways, deceptive airdrops, and any page created to
              part people from their funds or digital assets.
            </li>
            <li>
              <strong>Malware</strong> — distributing viruses, trojans,
              malicious scripts, or any code intended to harm devices or systems
              or compromise their security.
            </li>
            <li>
              <strong>Child sexual abuse material (CSAM)</strong> — zero
              tolerance; such content is removed immediately and reported to the
              relevant authorities.
            </li>
            <li>
              <strong>Non-consensual intimate imagery (NCII)</strong> — sexual or
              intimate content depicting real people without their consent,
              including the distribution of private images and non-consensual
              sexual deepfakes of real people.
            </li>
            <li>
              <strong>Sexually explicit or adult content</strong> — pornography,
              sexually explicit material, and adult services (including
              subscription-based adult creator content), whether published or
              sold through the Service. This restriction mirrors the policies of
              our payment and infrastructure providers, which do not permit such
              content.
            </li>
            <li>
              <strong>Terrorist or violent-extremist content</strong> — material
              that promotes, glorifies, or facilitates terrorism, violent
              extremism, or acts of violence against people or groups.
            </li>
            <li>
              <strong>Hate, harassment, and doxxing</strong> — hate speech,
              targeted harassment, threats, or publishing someone&apos;s private
              information without their consent.
            </li>
            <li>
              <strong>Defamation</strong> — false statements that damage the
              reputation of a person or entity.
            </li>
            <li>
              <strong>Sale of regulated or counterfeit goods</strong> — offering
              or selling drugs, controlled substances, weapons, counterfeit
              products, or other goods and services whose sale is restricted or
              prohibited under applicable law.
            </li>
            <li>
              <strong>IP and trademark infringement</strong> — publishing
              content, logos, or marks you don&apos;t have the rights or license
              to use.
            </li>
            <li>
              <strong>Spam</strong> — bulk or unsolicited messaging, or pages
              created primarily to spread it.
            </li>
            <li>
              <strong>Unauthorized scraping</strong> — automated extraction of
              third-party data without permission or against their terms.
            </li>
            <li>
              <strong>Deceptive impersonation</strong> — pretending to be
              another person, brand, or organization with intent to mislead.
            </li>
            <li>
              <strong>Deceptive cloaking</strong> — showing OpenLen different
              content from what you serve to visitors, in order to evade
              moderation or our rules.
            </li>
          </ul>

          <h2>Pages that collect visitor data</h2>
          <p>
            If your published page collects visitor data (for example, through
            forms), you act as the data controller for that data and OpenLen
            acts as a processor, under Mexico&apos;s Federal Law on the
            Protection of Personal Data Held by Private Parties (LFPDPPP). You
            must have a lawful basis to collect it, publish your own privacy
            notice, and honor visitor rights. In Mexico, the data-protection
            authority is the{" "}
            <strong>Secretaría Anticorrupción y Buena Administración</strong>,
            which assumed the functions of the former INAI in March 2025. Pages
            you build may include third-party code that sets cookies or other
            tracking; managing that code and its compliance is your
            responsibility.
          </p>

          <h2>Payments and services we use</h2>
          <p>
            Payments for paid plans are processed through <strong>Polar</strong>{" "}
            (Polar Software Inc., United States), which acts as the Merchant of
            Record: Polar processes the billing&apos;s financial and patrimonial
            data, issues the invoice, and collects tax. OpenLen retains only your
            subscription status and plan; we never store card numbers. For error
            monitoring we use <strong>InariWatch</strong>{" "}
            (<code>@inariwatch/capture</code>), a sister product from the same
            operator, so this error capture is first-party rather than an
            independent third party.
          </p>

          <h2>Enforcement</h2>
          <p>
            If a page or account breaches this policy, we may take down the
            affected content and suspend or terminate the account. For egregious
            cases — such as CSAM, NCII, terrorist content, malware, or active
            phishing — we may remove content without prior notice. Exporting to
            Vercel or GitHub does not exempt you from these rules while you use
            OpenLen.
          </p>
          <p>
            Where practicable, we will give you notice before we remove content
            or suspend your account and tell you why. You may appeal any action
            by emailing us at{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. Absent
            egregious cause, you will have the opportunity to export your content
            before it is deleted. Grounds for suspension or termination include,
            among others, breach of this policy or of the{" "}
            <Link href="/terms">Terms of Service</Link>, fraudulent or abusive use
            of the Service, and non-payment of a paid plan.
          </p>

          <h2>Reporting abuse and IP takedowns</h2>
          <p>
            To report abuse, use our{" "}
            <Link href="/report-abuse">report form</Link> or email us at{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a> with the
            affected URL and a description of the issue. To request the removal of
            content for intellectual-property infringement (DMCA-style), see the
            copyright and intellectual-property section of our{" "}
            <Link href="/terms">Terms of Service</Link>; direct your notice to{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>, which acts as
            the designated agent for such notices.
          </p>
        </>
      )}
    </LegalPage>
  );
}
