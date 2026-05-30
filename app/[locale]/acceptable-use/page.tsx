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
  return {
    title: locale === "es" ? "Política de uso aceptable" : "Acceptable Use Policy",
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
      updated={es ? "Última actualización: 30 de mayo de 2026" : "Last updated: May 30, 2026"}
    >
      {es ? (
        <>
          <p>
            OpenLen es un creador de landing pages que te permite publicar HTML
            arbitrario en subdominios <strong>&lt;nombre&gt;.openlen.com</strong>,
            conectar tu propio dominio y exportar tu página a Vercel o GitHub.
            Esta Política de uso aceptable describe lo que no está permitido al
            usar OpenLen para crear, publicar, exportar o distribuir páginas.
            Forma parte de nuestros{" "}
            <Link href="/terms">Términos de servicio</Link> y debe leerse junto
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
              <strong>Odio, acoso y doxxing</strong> — discurso de odio,
              hostigamiento dirigido, amenazas o la divulgación de información
              privada de terceros sin su consentimiento.
            </li>
            <li>
              <strong>Difamación</strong> — afirmaciones falsas que dañen la
              reputación de una persona o entidad.
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
          </ul>

          <h2>Páginas que recopilan datos de visitantes</h2>
          <p>
            Si tu página publicada recopila datos de visitantes (por ejemplo,
            mediante formularios), tú actúas como responsable del tratamiento de
            esos datos y OpenLen actúa como encargado. Debes contar con una base
            legal para recopilarlos, publicar tu propio aviso de privacidad y
            atender los derechos de las personas usuarias. Las páginas que crees
            pueden incluir código de terceros que establezca cookies u otros
            mecanismos de seguimiento; gestionar ese código y su cumplimiento es
            tu responsabilidad.
          </p>

          <h2>Aplicación</h2>
          <p>
            Si una página o cuenta incumple esta política, podemos retirar el
            contenido afectado y suspender la cuenta. En casos especialmente
            graves —como CSAM, malware o phishing activo— podemos retirar el
            contenido sin aviso previo. La exportación a Vercel o GitHub no te
            exime de estas reglas mientras uses OpenLen.
          </p>

          <h2>Denuncias de abuso y propiedad intelectual</h2>
          <p>
            Para denunciar abusos o solicitar la retirada de contenido por
            infracción de propiedad intelectual (estilo DMCA), escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a> e incluye la
            URL afectada y una descripción del problema.
          </p>
        </>
      ) : (
        <>
          <p>
            OpenLen is a landing-page builder that lets you publish arbitrary
            HTML to <strong>&lt;name&gt;.openlen.com</strong> subdomains, attach
            your own custom domain, and export your page to Vercel or GitHub.
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
              <strong>Hate, harassment, and doxxing</strong> — hate speech,
              targeted harassment, threats, or publishing someone&apos;s private
              information without their consent.
            </li>
            <li>
              <strong>Defamation</strong> — false statements that damage the
              reputation of a person or entity.
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
          </ul>

          <h2>Pages that collect visitor data</h2>
          <p>
            If your published page collects visitor data (for example, through
            forms), you act as the data controller for that data and OpenLen
            acts as a processor. You must have a lawful basis to collect it,
            publish your own privacy notice, and honor visitor rights. Pages you
            build may include third-party code that sets cookies or other
            tracking; managing that code and its compliance is your
            responsibility.
          </p>

          <h2>Enforcement</h2>
          <p>
            If a page or account breaches this policy, we may take down the
            affected content and suspend the account. For egregious cases — such
            as CSAM, malware, or active phishing — we may remove content without
            prior notice. Exporting to Vercel or GitHub does not exempt you from
            these rules while you use OpenLen.
          </p>

          <h2>Reporting abuse and IP takedowns</h2>
          <p>
            To report abuse or request the removal of content for intellectual
            property infringement (DMCA-style), email us at{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a> with the
            affected URL and a description of the issue.
          </p>
        </>
      )}
    </LegalPage>
  );
}
