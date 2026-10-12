// CONECTA OPENLEN CON TU ASISTENTE (plans/mcp-de-openlen, Parte 4). La página
// que anuncian el PRM (resource_documentation) y la metadata OAuth
// (service_documentation): la URL del servidor y cómo se añade en cada
// cliente. Pública, sin sesión.
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CopyButton } from "@/components/mcp/copy-button";
import { Link } from "@/i18n/navigation";
import { mcpResourceUrl } from "@/lib/mcp/config";
import { installSnippets, type InstallSnippet } from "@/lib/mcp/install-snippets";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "projects.mcpInstall" });
  return { title: t("title"), description: t("intro") };
}

export default async function McpInstallPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "projects.mcpInstall" });
  const url = mcpResourceUrl();
  const steps = (key: NonNullable<InstallSnippet["stepsKey"]>) =>
    key === "stepsClaudeAi" ? t("stepsClaudeAi") : key === "stepsChatgpt" ? t("stepsChatgpt") : key === "stepsVscode" ? t("stepsVscode") : t("stepsCursor");
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="opacity-80">{t("intro")}</p>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3">
          <span className="text-sm opacity-70">{t("serverUrl")}</span>
          <code className="text-sm">{url}</code>
          <CopyButton text={url} />
        </div>
        <p className="text-sm opacity-70">{t("signInHint")}</p>
        <p className="text-sm opacity-70">{t("plans")}</p>
      </header>
      <ul className="flex flex-col gap-4">
        {installSnippets(url).map((s) => (
          <li key={s.client} id={s.client} className="flex flex-col gap-2 rounded-lg border px-4 py-3">
            <h2 className="font-medium">{s.label}</h2>
            {s.stepsKey ? <p className="text-sm opacity-80">{steps(s.stepsKey)}</p> : null}
            {s.deepLink ? (
              <a href={s.deepLink} className="self-start rounded-full bg-black px-4 py-1.5 text-sm font-semibold text-white dark:bg-white dark:text-black">
                {t("installIn", { client: s.label })}
              </a>
            ) : null}
            {s.code ? (
              <div className="flex items-start gap-2">
                <pre className="flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-black/5 px-3 py-2 text-xs dark:bg-white/10">{s.code}</pre>
                <CopyButton text={s.code} />
              </div>
            ) : null}
            {s.signIn ? (
              <p className="text-sm opacity-80">
                {t("thenSignIn")} <code className="rounded bg-black/5 px-1.5 py-0.5 text-xs dark:bg-white/10">{s.signIn}</code>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-sm opacity-80">
        {t("tokenAlternative")}{" "}
        <Link href="/mcp/connections" className="underline">
          {t("connectionsLink")}
        </Link>
      </p>
    </main>
  );
}
