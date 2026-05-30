import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal-page";

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
            OpenLen, cómo cancelar tu suscripción y cómo solicitar un reembolso.
            Buscamos ser claros y honestos sobre el modelo actual.
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
            Los pagos se procesan a través de <strong>Polar</strong>, que actúa
            como <strong>comerciante registrado (Merchant of Record)</strong>.
            Esto significa que Polar es el vendedor legal de la suscripción: Polar
            emite la factura o el recibo al cliente y recauda y remite los
            impuestos aplicables. El cargo aparecerá a nombre de Polar en tu
            estado de cuenta, no de OpenLen.
          </p>

          <h2>Cómo cancelar</h2>
          <p>
            Puedes cancelar tu plan Pro en cualquier momento. Al cancelar:
          </p>
          <ul>
            <li>
              Conservas el acceso a las funciones Pro hasta el final del periodo
              ya pagado.
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
            Como Polar es el comerciante registrado, los reembolsos se solicitan
            a través de Polar conforme a sus términos para compradores. Si
            necesitas ayuda con un reembolso o tienes dudas sobre un cargo,
            escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a> y te
            orientamos sobre el proceso con Polar.
          </p>

          <h2>Derecho de desistimiento en la UE</h2>
          <p>
            Los consumidores en la Unión Europea cuentan con un derecho de
            desistimiento de 14 días para compras de contenido y servicios
            digitales. Este derecho se renuncia una vez que el consumidor
            consiente expresamente la prestación inmediata del servicio y
            reconoce que pierde dicho derecho al comenzar a usar la IA. Al activar
            el plan y empezar a consumir créditos de IA antes de que finalice el
            plazo de 14 días, otorgas ese consentimiento.
          </p>

          <h2>Contacto</h2>
          <p>
            Operamos OpenLen desde México. Para cualquier consulta sobre
            facturación, cancelaciones o reembolsos, escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. Estos términos
            se rigen por las leyes de México.
          </p>
        </>
      ) : (
        <>
          <p>
            This page explains how OpenLen&apos;s plans and credits work, how to
            cancel your subscription, and how to request a refund. We aim to be
            clear and honest about the current model.
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
            Payments are handled by <strong>Polar</strong> acting as the{" "}
            <strong>Merchant of Record</strong>. This means Polar is the legal
            seller of the subscription: Polar issues the invoice or receipt to the
            customer and collects and remits any applicable taxes. The charge
            appears under Polar on your statement, not OpenLen.
          </p>

          <h2>How to cancel</h2>
          <p>You can cancel your Pro plan at any time. When you cancel:</p>
          <ul>
            <li>
              You keep access to Pro features until the end of the period you have
              already paid for.
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
            Because Polar is the Merchant of Record, refunds are requested through
            Polar in accordance with Polar&apos;s buyer terms. If you need help
            with a refund or have a question about a charge, email us at{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a> and we&apos;ll
            point you to the right process with Polar.
          </p>

          <h2>EU right of withdrawal</h2>
          <p>
            Consumers in the European Union have a 14-day right of withdrawal for
            purchases of digital content and services. This right is waived once
            the consumer expressly consents to the immediate provision of the
            service and acknowledges that they lose that right once the AI is used.
            By activating the plan and starting to consume AI credits before the
            14-day period ends, you give that consent.
          </p>

          <h2>Contact</h2>
          <p>
            We operate OpenLen from Mexico. For any question about billing,
            cancellations, or refunds, email us at{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>. These terms are
            governed by the laws of Mexico.
          </p>
        </>
      )}
    </LegalPage>
  );
}
