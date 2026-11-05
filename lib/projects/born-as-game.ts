// A BLANK PROJECT IS BORN AS A GAME (spec local 2026-11-05-modo-juego-design, §8.1, §11): the first message of a
// blank project with the «Juego» card carries `naceComo: "game"`, and before Len reads anything the project gets
// the game skeleton — an app with `data.game`. The same guarded statement as an app's birth (`bornWithSkeleton`);
// games are open to every plan, like apps (Jesús, 05/11).
import "server-only";

import { gameSkeleton } from "@/lib/games/skeleton";

import { bornWithSkeleton } from "./nacer-como-app";

export async function bornAsGame(p: {
  readonly projectId: string;
  readonly userId: string;
  readonly title: string;
  readonly locale: string;
}): Promise<"born" | "not_blank"> {
  const s = gameSkeleton({ title: p.title, locale: p.locale });
  const born = await bornWithSkeleton({
    projectId: p.projectId,
    userId: p.userId,
    patch: { html: s.html, app: s.app, game: s.game },
    files: s.files,
  });
  return born ? "born" : "not_blank";
}
