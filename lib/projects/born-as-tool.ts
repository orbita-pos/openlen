// A BLANK PROJECT IS BORN AS A TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.1, §4.9, §4.13): the
// first message of a blank project with the «Herramienta» card carries `naceComo: "tool"`, and before Len reads
// anything the project gets the tool skeleton — an app with `data.tool` and DeepSeek's display record. The
// same guarded statement as an app's birth (`bornWithSkeleton`); tools are for paid plans only.
import "server-only";

import { getUserPlan } from "@/lib/limits";
import { toolSkeleton } from "@/lib/tools/skeleton";

import { bornWithSkeleton } from "./nacer-como-app";

export async function bornAsTool(p: {
  readonly projectId: string;
  readonly userId: string;
  readonly title: string;
  readonly locale: string;
}): Promise<"born" | "not_blank" | "plan_required"> {
  if ((await getUserPlan(p.userId)) === "free") return "plan_required";
  const s = toolSkeleton({ title: p.title, locale: p.locale });
  const born = await bornWithSkeleton({
    projectId: p.projectId,
    userId: p.userId,
    patch: { html: s.html, app: s.app, tool: s.tool },
    files: s.files,
  });
  return born ? "born" : "not_blank";
}
