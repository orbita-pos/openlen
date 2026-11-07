// The web push of a turn that ended with nobody watching (lib/agent/aviso-del-turno.ts). Pure: the channel reads the
// project's title and hands it here. No prose of ours — the body is the turn's last words, already in the user's
// language. A turn of the person's own assistant (lib/assistants/) is titled with its name and opens its place.
import type { LenTurnoEvent } from "./types";

export interface LenTurnPush {
  title: string;
  body: string;
  url: string;
}

export function lenTurnPush(event: LenTurnoEvent, projectTitle: string | null): LenTurnPush {
  const who = event.asistente?.name ?? "Len";
  const project = projectTitle?.trim();
  return {
    title: project ? `${who} · ${project}` : who,
    body: `${event.pregunta ? "❓ " : ""}${event.preview}`.trim(),
    url: event.asistente ? `/assistant/${encodeURIComponent(event.asistente.slug)}` : `/new?project=${event.projectId}`,
  };
}
