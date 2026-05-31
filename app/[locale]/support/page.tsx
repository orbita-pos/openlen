import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal-page";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://openlen.com";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const es = locale === "es";
  return {
    title: es ? "Soporte" : "Support",
    description: es
      ? "Cómo contactar al equipo de OpenLen y obtener ayuda por correo o GitHub."
      : "How to contact the OpenLen team and get help by email or GitHub.",
    alternates: { canonical: `${SITE_URL}/${locale}/support` },
  };
}

export default async function SupportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const es = locale === "es";

  return (
    <LegalPage title={es ? "Soporte" : "Support"}>
      {es ? (
        <>
          <p>¿Necesitas ayuda? Somos un equipo pequeño y respondemos lo antes posible.</p>
          <h2>Contáctanos</h2>
          <ul>
            <li>
              <strong>Correo</strong> —{" "}
              <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>
            </li>
            <li>
              <strong>GitHub</strong> — abre una incidencia en{" "}
              <a
                href="https://github.com/orbita-pos/openlen/issues"
                target="_blank"
                rel="noreferrer"
              >
                github.com/orbita-pos/openlen
              </a>{" "}
              (OpenLen es de código abierto).
            </li>
          </ul>
          <h2>Desplegar en Vercel o GitHub</h2>
          <p>
            Abre un proyecto, pulsa Publicar, elige Vercel o GitHub, conecta tu
            cuenta una vez, escribe un nombre y despliega. Volver a desplegar
            actualiza el mismo destino.
          </p>
        </>
      ) : (
        <>
          <p>Need help? We&apos;re a small team and answer as quickly as we can.</p>
          <h2>Get in touch</h2>
          <ul>
            <li>
              <strong>Email</strong> —{" "}
              <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>
            </li>
            <li>
              <strong>GitHub</strong> — open an issue at{" "}
              <a
                href="https://github.com/orbita-pos/openlen/issues"
                target="_blank"
                rel="noreferrer"
              >
                github.com/orbita-pos/openlen
              </a>{" "}
              (OpenLen is open source).
            </li>
          </ul>
          <h2>Deploying to Vercel or GitHub</h2>
          <p>
            Open a project, click Deploy, choose Vercel or GitHub, connect your
            account once, pick a name, and deploy. Re-deploying updates the same
            target.
          </p>
        </>
      )}
    </LegalPage>
  );
}
