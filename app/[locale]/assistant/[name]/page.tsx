// THE ASSISTANT'S PLACE (spec local 2026-11-06-asistente-propio, §4.6.2): /<locale>/assistant/<name>. The word is
// English in every locale, like /projects; the name is the assistant's slug. Private: the session decides whose — two
// people with their own «Lucía» share the address and each sees theirs. Someone else's, or none, is a 404.
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { AssistantHome } from "@/components/workspace-v2/assistant/assistant-home";
import { redirect } from "@/i18n/navigation";
import { assistantConversationKey } from "@/lib/assistants/conversation";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { assistantBySlug } from "@/lib/assistants/store";
import { assistantView } from "@/lib/assistants/view";
import { getProject } from "@/lib/projects";
import { getChatMessages } from "@/lib/projects/chat";
import "@/app/[locale]/new/tokens.css";

export const dynamic = "force-dynamic";

export default async function AssistantPage({ params }: { params: Promise<{ locale: string; name: string }> }) {
  if (!assistantsEnabled()) notFound();
  const { locale, name } = await params;
  const personId = (await auth())?.user?.id;
  if (!personId) return redirect({ href: "/login", locale });
  const assistant = await assistantBySlug(personId, name);
  if (!assistant) notFound();
  const project = await getProject(assistant.homeProjectId, personId);
  if (!project) notFound();
  const chat = await getChatMessages(assistant.homeProjectId, { charla: assistantConversationKey(assistant.id) });
  return <AssistantHome assistant={assistantView(assistant)} projectHtml={project.data?.html ?? ""} initialChat={chat} />;
}
