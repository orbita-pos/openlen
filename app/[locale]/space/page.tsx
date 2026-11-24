// THE PERSON'S SPACE (spec local 2026-11-19-agentes-para-todos, §6.2–6.3): /<locale>/space — Len's chat in the hidden
// project where the person's agents live, with no canvas and nothing to publish. The home's Agente arrives here with its
// one-use ticket (`?brief=`), and «Cambiar a <nombre>» with a draft to fill (`?draft=`). Private: the session decides
// whose; the space is found or born here, as the assistant's place loads her home.
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "@/auth";
import { SpaceHome } from "@/components/workspace-v2/space/space-home";
import { redirect } from "@/i18n/navigation";
import { getChatMessages } from "@/lib/projects/chat";
import { agentsEnabled } from "@/lib/space/enabled";
import { spaceHref } from "@/lib/space/href";
import { ensureSpace } from "@/lib/space/store";
import "@/app/[locale]/new/tokens.css";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined): string | null => (typeof v === "string" && v.trim() ? v : null);

/** «Tu espacio» in the tab, in the person's language (it showed the site's generic English title). */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "wsChrome" });
  return { title: t("space.title") };
}

export default async function SpacePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!agentsEnabled()) notFound();
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const brief = one(query.brief);
  const draft = one(query.draft);
  const first = one(query.first);
  const personId = (await auth())?.user?.id;
  if (!personId) {
    const back = spaceHref({ ...(first ? { first } : {}), ...(brief ? { brief } : {}), ...(draft ? { draft } : {}) });
    return redirect({ href: `/login?next=${encodeURIComponent(back)}`, locale });
  }
  const spaceId = await ensureSpace(personId);
  const chat = await getChatMessages(spaceId);
  return <SpaceHome projectId={spaceId} initialChat={chat} arrivalBrief={brief} draft={draft} arrivalFirst={first} />;
}
