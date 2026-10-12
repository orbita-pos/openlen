import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { LenSays } from "./len-says";
import { ClientLogo, INSTALL_CLIENT_LOGO } from "@/components/ui/client-logos";
import { Link } from "@/i18n/navigation";
import type { InstallClient } from "@/lib/mcp/install-snippets";

/* «TU IA DE SIEMPRE» — el MCP de OpenLen en la portada (plans/mcp-de-openlen,
   Parte 4). Quien ya paga Claude, ChatGPT o Cursor puede trabajar en sus
   páginas desde ahí. Cada logo lleva a su receta en /mcp. Server-rendered,
   cero JS de cliente. */

const PANEL =
  "relative overflow-hidden rounded-3xl bg-white/70 dark:bg-white/[0.04] ring-1 ring-zinc-200/70 dark:ring-white/10 backdrop-blur-sm";

// Los nombres son marcas: no se traducen. El orden, de más a menos usados.
const CLIENTS: { id: InstallClient; label: string }[] = [
  { id: "claude-ai", label: "Claude" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "cursor", label: "Cursor" },
  { id: "vscode", label: "VS Code" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "opencode", label: "OpenCode" },
  { id: "kimi", label: "Kimi" },
];

export async function ConnectYourAi() {
  const t = await getTranslations("marketing");
  const steps = [t("mcp.step1"), t("mcp.step2"), t("mcp.step3")];

  return (
    <section id="mcp" data-len-section="mcp" className="relative scroll-mt-20">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-6">
            <LenSays>{t("mcp.lenSays")}</LenSays>
            <h2 className="mt-6 text-3xl sm:text-5xl font-semibold tracking-tightest leading-[1.08]">
              {t.rich("mcp.title", {
                muted: (chunks) => <span className="font-medium text-zinc-500 dark:text-zinc-400">{chunks}</span>,
              })}
            </h2>
            <p className="mt-3 text-zinc-600 dark:text-zinc-400">{t("mcp.subtitle")}</p>

            <ol className="mt-8 space-y-4">
              {steps.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-coral-500/10 text-sm font-semibold text-coral-600 dark:text-coral-400">
                    {i + 1}
                  </span>
                  <span className="pt-0.5 text-[15px] text-zinc-700 dark:text-zinc-300 leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>

            <Link
              href="/mcp"
              className="group/cta mt-9 inline-flex w-fit items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {t("mcp.cta")}
              <ArrowRight size={14} className="transition group-hover/cta:translate-x-0.5" />
            </Link>
          </div>

          <div className={`${PANEL} lg:col-span-6 p-7 sm:p-9`}>
            {/* Amanecer del home, contenido en el panel (como en Trust). */}
            <div
              aria-hidden
              className="pointer-events-none absolute -left-24 -bottom-24 h-72 w-72 rounded-full bg-gradient-to-br from-coral-400/25 via-rose-300/20 to-violet-300/25 dark:from-coral-500/15 dark:via-rose-400/10 dark:to-violet-400/15 blur-3xl"
            />
            <p className="relative text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">{t("mcp.worksWith")}</p>
            <ul className="relative mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {CLIENTS.map((c) => {
                const logo = INSTALL_CLIENT_LOGO[c.id];
                return (
                  <li key={c.id}>
                    <Link
                      href={`/mcp#${c.id}`}
                      className="flex h-full items-center gap-2.5 rounded-2xl bg-white/80 px-3.5 py-3 text-sm font-medium text-zinc-800 ring-1 ring-zinc-200/80 transition hover:ring-zinc-300 dark:bg-white/[0.04] dark:text-zinc-100 dark:ring-white/10 dark:hover:ring-white/20"
                    >
                      {logo ? <ClientLogo name={logo} size={18} className="shrink-0" /> : null}
                      <span className="min-w-0 leading-tight">{c.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="relative mt-5 text-sm text-zinc-500 dark:text-zinc-400">{t("mcp.anyClient")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
