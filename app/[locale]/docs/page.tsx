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
  return {
    title: locale === "es" ? "Documentación" : "Documentation",
    alternates: { canonical: `${SITE_URL}/${locale}/docs` },
  };
}

export default async function DocsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const es = locale === "es";

  return (
    <LegalPage title={es ? "Documentación" : "Documentation"}>
      {es ? (
        <>
          <p>OpenLen crea landing pages que son tuyas.</p>
          <h2>Cómo empezar</h2>
          <ol>
            <li>
              <strong>Crea</strong> — describe tu página, elige una plantilla o
              pega tu propio HTML.
            </li>
            <li>
              <strong>Edita</strong> — ajusta el texto, cambia imágenes y
              reestiliza con IA en el espacio de trabajo.
            </li>
            <li>
              <strong>Publica</strong> — sal en vivo en tu subdominio gratuito
              &lt;nombre&gt;.openlen.com, conecta un dominio propio, o exporta a
              tu propia cuenta de Vercel o GitHub Pages desde el menú Publicar.
            </li>
          </ol>
          <h2>Desplegar en Vercel / GitHub</h2>
          <p>
            Abre un proyecto, pulsa Publicar, elige Vercel o GitHub, conecta tu
            cuenta una vez, escribe un nombre y despliega. Volver a desplegar
            actualiza el mismo destino.
          </p>
          <p>
            Estamos preparando guías más completas — mientras tanto, escríbenos a{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>
        </>
      ) : (
        <>
          <p>OpenLen builds landing pages you own.</p>
          <h2>Getting started</h2>
          <ol>
            <li>
              <strong>Create</strong> — describe your page, pick a template, or
              paste your own HTML.
            </li>
            <li>
              <strong>Edit</strong> — tweak text, swap images, and restyle with
              AI in the workspace.
            </li>
            <li>
              <strong>Publish</strong> — go live on your free
              &lt;name&gt;.openlen.com subdomain, connect a custom domain, or
              export to your own Vercel or GitHub Pages from the Deploy menu.
            </li>
          </ol>
          <h2>Deploy to Vercel / GitHub</h2>
          <p>
            Open a project, click Deploy, choose Vercel or GitHub, connect your
            account once, pick a name, and deploy. Re-deploying updates the same
            target.
          </p>
          <p>
            Fuller guides are on the way — for now, reach us at{" "}
            <a href="mailto:info@jesusbr.com">info@jesusbr.com</a>.
          </p>
        </>
      )}
    </LegalPage>
  );
}
