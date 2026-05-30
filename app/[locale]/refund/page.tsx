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
    title: locale === "es" ? "Reembolsos y cancelación" : "Refund & Cancellation",
  };
}

export default async function RefundPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const es = locale === "es";

  return (
    <LegalPage
      title={es ? "Reembolsos y cancelación" : "Refund & Cancellation"}
      updated={es ? "Última actualización: 30 de mayo de 2026" : "Last updated: May 30, 2026"}
    >
      {es ? (
        <>
          <p>
            Esta página explica cómo funcionan los planes y los créditos de
            OpenLen, cómo se renueva tu suscripción, cómo cancelarla y cómo
            solicitar un reembolso. Buscamos ser claros y honestos sobre el
            modelo actual.
          </p>

          <h2>Quiénes operamos OpenLen</h2>
          <p>
            OpenLen es operado por <strong>[NOMBRE LEGAL]</strong>, que opera
            OpenLen, con sede en México (el &quot;responsable&quot;). Para
            cualquier consulta sobre facturación, cancelaciones o reembolsos,
            escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. Estos términos
            se rigen por las leyes de México.
          </p>

          <h2>Planes y modelo de créditos</h2>
          <p>
            La IA de OpenLen se mide por créditos. Cada generación o edición con
            IA consume créditos según su costo. Como referencia, 1 crédito
            equivale aproximadamente a US$0.01 de costo de IA.
          </p>
          <ul>
            <li>
              <strong>Plan gratuito:</strong> 20 créditos al mes, sin costo.
            </li>
            <li>
              <strong>Plan Pro:</strong> US$7 al mes por 150 créditos al mes.
            </li>
          </ul>
          <p>
            Los créditos se reinician cada mes y <strong>no se acumulan</strong>:
            los créditos no utilizados se pierden al inicio de cada nuevo periodo
            y no se transfieren al mes siguiente.
          </p>

          <h2>Quién te cobra: Polar como comerciante registrado</h2>
          <p>
            Los pagos se procesan a través de <strong>Polar</strong> (Polar
            Software Inc., Estados Unidos), que actúa como{" "}
            <strong>comerciante registrado (Merchant of Record)</strong>. Esto
            significa que Polar es el vendedor legal de la suscripción: Polar
            procesa los datos de pago y de facturación (datos financieros o
            patrimoniales), emite la factura o el recibo al cliente y recauda y
            remite los impuestos aplicables. El cargo aparecerá a nombre de Polar
            en tu estado de cuenta, no de OpenLen. OpenLen únicamente conserva el
            estado de tu suscripción y tu plan; <strong>nunca</strong> almacenamos
            números de tarjeta. Puedes consultar más detalles en nuestros{" "}
            <Link href="/terms">Términos del servicio</Link> y en nuestra{" "}
            <Link href="/privacy">Política de privacidad</Link>.
          </p>

          <h2>Renovación automática</h2>
          <p>
            El plan Pro se renueva <strong>automáticamente cada mes</strong> al
            precio de US$7 hasta que lo canceles. El cargo se realiza en la fecha
            de renovación, con una frecuencia mensual y por el importe de US$7. De
            conformidad con la Ley Federal de Protección al Consumidor (LFPC, en
            vigor desde diciembre de 2025), te enviaremos un{" "}
            <strong>recordatorio al menos 5 días hábiles antes de cada
            renovación</strong>, de modo que puedas cancelar con anticipación sin
            costo alguno antes de que se genere el cargo.
          </p>

          <h2>Cómo cancelar</h2>
          <p>
            Cancelar es sencillo: puedes hacerlo en línea en unos pocos clics
            desde la configuración de tu cuenta o a través de Polar, en cualquier
            momento. <strong>No hay penalización, cargo por cancelación ni proceso
            de retención.</strong> Al cancelar:
          </p>
          <ul>
            <li>
              La cancelación surte efecto al final del periodo ya pagado;
              conservas el acceso a las funciones Pro hasta entonces.
            </li>
            <li>
              Al terminar ese periodo, tu cuenta vuelve automáticamente al plan
              gratuito.
            </li>
            <li>
              Los créditos no utilizados se pierden al bajar de plan o cancelar;
              no se reembolsan ni se transfieren.
            </li>
          </ul>

          <h2>Reembolsos</h2>
          <p>
            Como Polar es el comerciante registrado, los reembolsos y las
            disputas pueden plantearse directamente ante Polar en{" "}
            <a href="mailto:support@polar.sh">support@polar.sh</a>, conforme a sus{" "}
            <a
              href="https://polar.sh/legal/checkout-buyer-terms"
              target="_blank"
              rel="noopener noreferrer"
            >
              términos para compradores de Polar
            </a>
            . También puedes escribirnos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a> y te orientamos
            sobre el proceso.
          </p>

          <h2>Derecho de desistimiento en la UE</h2>
          <p>
            Los consumidores en la Unión Europea cuentan con un derecho de
            desistimiento de 14 días para compras de contenido y servicios
            digitales. Conforme al artículo 16(m) de la Directiva sobre derechos
            de los consumidores, este derecho solo se renuncia válidamente cuando,{" "}
            <strong>antes de que comience la prestación</strong>, el consumidor:
            (1) otorga su consentimiento previo y expreso para la prestación
            inmediata del servicio, (2) reconoce de forma expresa que con ello
            pierde su derecho de desistimiento, y (3) recibe del comerciante una
            confirmación en un soporte duradero. Estos tres requisitos se recaban
            en el checkout de Polar antes de iniciar el servicio.
          </p>
          <p>
            Si <strong>no</strong> otorgas ese consentimiento, conservas
            íntegramente tu derecho de desistimiento de 14 días. Si el servicio se
            presta parcialmente con tu consentimiento, podrá cobrarse un importe
            proporcional a lo ya prestado. El simple hecho de activar el plan o
            usar créditos no constituye, por sí solo, una renuncia válida.
          </p>

          <h2>Cláusula de salvaguarda</h2>
          <p>
            Nada en esta página limita los derechos irrenunciables que te
            correspondan como consumidor conforme a la ley aplicable, incluidas la
            Ley Federal de Protección al Consumidor de México y la legislación de
            consumo de la UE. En caso de cargos no autorizados o duplicados, o de
            un servicio no prestado, tendrás derecho al reembolso correspondiente.
          </p>

          <h2>Contacto</h2>
          <p>
            Para cualquier consulta sobre facturación, cancelaciones o reembolsos,
            escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. Consulta
            también nuestros{" "}
            <Link href="/terms">Términos del servicio</Link> y nuestra{" "}
            <Link href="/privacy">Política de privacidad</Link>.
          </p>
        </>
      ) : (
        <>
          <p>
            This page explains how OpenLen&apos;s plans and credits work, how your
            subscription renews, how to cancel it, and how to request a refund. We
            aim to be clear and honest about the current model.
          </p>

          <h2>Who operates OpenLen</h2>
          <p>
            OpenLen is operated by <strong>[NOMBRE LEGAL]</strong>, operating
            OpenLen, based in Mexico (the &quot;operator&quot;). For any question
            about billing, cancellations, or refunds, email us at{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. These terms are
            governed by the laws of Mexico.
          </p>

          <h2>Plans and credit model</h2>
          <p>
            OpenLen&apos;s AI is metered by credits. Each AI generation or edit
            consumes credits based on its cost. As a reference, 1 credit is
            roughly US$0.01 of AI cost.
          </p>
          <ul>
            <li>
              <strong>Free plan:</strong> 20 credits per month, at no cost.
            </li>
            <li>
              <strong>Pro plan:</strong> US$7 per month for 150 credits per month.
            </li>
          </ul>
          <p>
            Credits reset monthly and <strong>do not roll over</strong>: any
            unused credits are forfeited at the start of each new period and do
            not carry into the following month.
          </p>

          <h2>Who charges you: Polar as Merchant of Record</h2>
          <p>
            Payments are handled by <strong>Polar</strong> (Polar Software Inc.,
            United States) acting as the{" "}
            <strong>Merchant of Record</strong>. This means Polar is the legal
            seller of the subscription: Polar processes your payment and billing
            data (financial/patrimonial data), issues the invoice or receipt to
            the customer, and collects and remits any applicable taxes. The charge
            appears under Polar on your statement, not OpenLen. OpenLen only stores
            your subscription status and plan; we <strong>never</strong> store
            card numbers. See our{" "}
            <Link href="/terms">Terms of Service</Link> and our{" "}
            <Link href="/privacy">Privacy Policy</Link> for more detail.
          </p>

          <h2>Auto-renewal</h2>
          <p>
            The Pro plan <strong>renews automatically each month</strong> at US$7
            until you cancel. The charge is made on the renewal date, on a monthly
            frequency, for the amount of US$7. In line with Mexico&apos;s Federal
            Consumer Protection Law (LFPC, in force since December 2025), we send a{" "}
            <strong>reminder at least 5 business days before each renewal</strong>,
            so you can cancel beforehand at no cost before the charge is made.
          </p>

          <h2>How to cancel</h2>
          <p>
            Cancelling is simple: you can do it online in a few clicks from your
            account settings or through Polar, at any time.{" "}
            <strong>There is no penalty, cancellation fee, or retention
            process.</strong> When you cancel:
          </p>
          <ul>
            <li>
              Cancellation takes effect at the end of the period you have already
              paid for; you keep access to Pro features until then.
            </li>
            <li>
              At the end of that period, your account automatically reverts to the
              free plan.
            </li>
            <li>
              Unused credits are forfeited on downgrade or cancellation; they are
              not refunded or carried over.
            </li>
          </ul>

          <h2>Refunds</h2>
          <p>
            Because Polar is the Merchant of Record, refunds and disputes can be
            raised directly with Polar at{" "}
            <a href="mailto:support@polar.sh">support@polar.sh</a>, under Polar&apos;s{" "}
            <a
              href="https://polar.sh/legal/checkout-buyer-terms"
              target="_blank"
              rel="noopener noreferrer"
            >
              buyer terms
            </a>
            . You may also email us at{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a> and we&apos;ll
            help you through the process.
          </p>

          <h2>EU right of withdrawal</h2>
          <p>
            Consumers in the European Union have a 14-day right of withdrawal for
            purchases of digital content and services. Under Article 16(m) of the
            Consumer Rights Directive, this right is only validly waived where,{" "}
            <strong>before performance begins</strong>, the consumer: (1) gives
            prior express consent to the immediate provision of the service, (2)
            expressly acknowledges that they thereby lose the right of withdrawal,
            and (3) receives the trader&apos;s confirmation on a durable medium.
            These three requirements are captured at the Polar checkout before the
            service starts.
          </p>
          <p>
            If you do <strong>not</strong> give that consent, you keep the full
            14-day right of withdrawal. If the service has been partly supplied
            with your consent, a pro-rata amount for what has already been provided
            may be charged. Merely activating the plan or using credits does not,
            by itself, constitute a valid waiver.
          </p>

          <h2>Savings clause</h2>
          <p>
            Nothing on this page limits any non-waivable consumer rights you may
            have under applicable law, including Mexico&apos;s Federal Consumer
            Protection Law and EU consumer law. For unauthorized or duplicate
            charges, or for a service that was not delivered, you are entitled to a
            refund.
          </p>

          <h2>Contact</h2>
          <p>
            For any question about billing, cancellations, or refunds, email us at{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. See also our{" "}
            <Link href="/terms">Terms of Service</Link> and our{" "}
            <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </>
      )}
    </LegalPage>
  );
}
