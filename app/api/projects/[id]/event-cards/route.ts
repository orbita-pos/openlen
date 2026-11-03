// GET /api/projects/[id]/event-cards — the project's event-task cards for the chat (spec local
// 2026-11-03-len-que-avisa, §7.6, §8): the pending ones and those of the last 7 days, newest first, each with its
// task's name. Anyone who can see the project; only an editor presses (the POST beside this). The phone too.
import { cardsOfProject } from "@/lib/event-tasks/cards";
import { eventTasksEnabled } from "@/lib/event-tasks/enabled";
import { listEventTasks } from "@/lib/event-tasks/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { exigirAcceso } from "@/lib/projects/acceso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 86_400_000;

export const GET = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  if (!eventTasksEnabled()) return Response.json({ cards: [] });
  const { id } = await params;
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const acceso = await exigirAcceso(id, userId, "ver");
  if (acceso instanceof Response) return acceso;
  const [cards, tasks] = await Promise.all([cardsOfProject(id, { since: new Date(Date.now() - WEEK_MS) }), listEventTasks(id, { includeInactive: true })]);
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  return Response.json({
    cards: cards.map((c) => ({
      id: c.id,
      taskId: c.taskId,
      taskTitle: titles.get(c.taskId) ?? "",
      title: c.title,
      summary: c.summary,
      proposedAction: c.proposedAction,
      status: c.status,
      acceptedRowId: c.acceptedRowId,
      createdAt: c.createdAt.toISOString(),
    })),
  });
});

export const OPTIONS = respuestaPrevia;
