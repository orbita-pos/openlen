// THE ASSISTANT'S PLACE (spec local 2026-11-06-asistente-propio, §4.6.2): /<locale>/assistant/<name>. The word is
// English in every locale, like /projects; the name is the assistant's slug. Private: the session decides whose — two
// people with their own «Lucía» share the address and each sees theirs. Someone else's, or none, is a 404.
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { AssistantHome } from "@/components/workspace-v2/assistant/assistant-home";
import { permanentRedirect, redirect } from "@/i18n/navigation";
import { assistantConversationKey } from "@/lib/assistants/conversation";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { slugFromParam } from "@/lib/assistants/names";
import { assistantByOldSlug, assistantBySlug } from "@/lib/assistants/store";
import { assistantView } from "@/lib/assistants/view";
import { onPageState } from "@/lib/assistants/visitor/on-page";
import { assistantOnPage } from "@/lib/assistants/visitor/store";
import { getProject } from "@/lib/projects";
import { getChatMessages } from "@/lib/projects/chat";
import { publishedHost } from "@/lib/publish/base-host";
import "@/app/[locale]/new/tokens.css";

export const dynamic = "force-dynamic";

export default async function AssistantPage({ params }: { params: Promise<{ locale: string; name: string }> }) {
  if (!assistantsEnabled()) notFound();
  const { locale, name } = await params;
  const personId = (await auth())?.user?.id;
  if (!personId) return redirect({ href: "/login", locale });
  const slug = slugFromParam(name);
  const assistant = await assistantBySlug(personId, slug);
  if (!assistant) {
    // Renamed (phase 4D, spec §6.8): her old address redirects for good to the new one. A live name wins: asked only
    // when no assistant of the person has this one now.
    const moved = await assistantByOldSlug(personId, slug);
    // Encoded: a slug of another script raw in the Location header is refused by Node (a 500); `slugFromParam` decodes
    // it on arrival.
    if (moved) return permanentRedirect({ href: `/assistant/${encodeURIComponent(moved.slug)}`, locale });
    notFound();
  }
  const project = await getProject(assistant.homeProjectId, personId);
  if (!project) notFound();
  const [chat, found] = await Promise.all([
    getChatMessages(assistant.homeProjectId, { charla: assistantConversationKey(assistant.id) }),
    assistantOnPage(assistant.homeProjectId).catch(() => null),
  ]);
  const state = onPageState(found, Boolean(project.data?.app));
  return (
    <AssistantHome
      assistant={assistantView(assistant)}
      projectHtml={project.data?.html ?? ""}
      address={project.subdomain ? publishedHost(project.subdomain) : null}
      projectTitle={project.title ?? null}
      initialChat={chat}
      onPage={state.onPage}
      needsPublish={state.needsPublish}
      nothingToKnow={state.nothingToKnow}
    />
  );
}
