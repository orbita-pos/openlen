import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal-page";
import { Link } from "@/i18n/navigation";
import { ReportForm, type ReportFormStrings } from "./report-form";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://openlen.com";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const es = locale === "es";
  return {
    title: es ? "Reportar contenido" : "Report content",
    description: es
      ? "Reporta una página publicada con OpenLen que viole nuestra Política de uso aceptable."
      : "Report a page published with OpenLen that violates our Acceptable Use Policy.",
    alternates: { canonical: `${SITE_URL}/${locale}/report-abuse` },
  };
}

export default async function ReportAbusePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const es = locale === "es";

  const t: ReportFormStrings = es
    ? {
        categoryLabel: "Tipo de problema",
        categories: [
          { value: "csam", label: "Material de abuso sexual infantil (CSAM)" },
          { value: "intimate", label: "Imágenes íntimas sin consentimiento" },
          { value: "phishing", label: "Phishing, fraude o estafa" },
          { value: "copyright", label: "Infracción de copyright o marca" },
          { value: "other", label: "Otro" },
        ],
        urlLabel: "URL de la página reportada",
        urlPlaceholder: "https://ejemplo.openlen.com/...",
        detailsLabel: "Describe el problema",
        detailsPlaceholder:
          "Qué viste, dónde, y cualquier contexto que ayude a verificarlo rápido.",
        emailLabel: "Tu email (opcional)",
        emailHint: "Solo para contactarte si necesitamos más detalles.",
        submit: "Enviar reporte",
        sending: "Enviando…",
        sent: "Reporte recibido.",
        sentBody:
          "Lo revisaremos en breve. Los casos urgentes (CSAM, imágenes íntimas) se priorizan de inmediato.",
        errInvalid:
          "Revisa los campos — la URL y una descripción de al menos 10 caracteres son obligatorias.",
        errRate: "Demasiados reportes desde tu conexión. Inténtalo en un rato.",
        errServer: "No se pudo enviar. Inténtalo de nuevo.",
      }
    : {
        categoryLabel: "Type of problem",
        categories: [
          { value: "csam", label: "Child sexual abuse material (CSAM)" },
          { value: "intimate", label: "Non-consensual intimate imagery" },
          { value: "phishing", label: "Phishing, fraud or scam" },
          { value: "copyright", label: "Copyright or trademark infringement" },
          { value: "other", label: "Other" },
        ],
        urlLabel: "URL of the reported page",
        urlPlaceholder: "https://example.openlen.com/...",
        detailsLabel: "Describe the problem",
        detailsPlaceholder:
          "What you saw, where, and any context that helps us verify it quickly.",
        emailLabel: "Your email (optional)",
        emailHint: "Only used to reach you if we need more detail.",
        submit: "Send report",
        sending: "Sending…",
        sent: "Report received.",
        sentBody:
          "We'll review it shortly. Urgent cases (CSAM, intimate imagery) are prioritized immediately.",
        errInvalid:
          "Check the fields — the URL and a description of at least 10 characters are required.",
        errRate: "Too many reports from your connection. Try again in a while.",
        errServer: "Couldn't send. Please try again.",
      };

  return (
    <LegalPage title={es ? "Reportar contenido" : "Report content"}>
      <p>
        {es ? (
          <>
            Si una página publicada con OpenLen viola nuestra{" "}
            <Link href="/acceptable-use">Política de uso aceptable</Link> —
            contenido ilegal, phishing, imágenes íntimas sin consentimiento,
            infracciones de copyright — repórtala aquí. También puedes
            escribirnos directo a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </>
        ) : (
          <>
            If a page published with OpenLen violates our{" "}
            <Link href="/acceptable-use">Acceptable Use Policy</Link> — illegal
            content, phishing, non-consensual intimate imagery, copyright
            infringement — report it here. You can also email us directly at{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </>
        )}
      </p>
      <ReportForm t={t} />
    </LegalPage>
  );
}
