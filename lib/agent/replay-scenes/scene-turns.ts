// A scene's rows as the chat panel paints them (layer 1 of Len 3.1): the same
// row → turn mapping the panel's history uses (`storedTurnFromRow`), for the
// jsdom checks (`chat-scenes.test.tsx`) and the dev page (`/dev/chat?scene=`).
import { storedTurnFromRow, type ChatRowForTurn } from "@/lib/projects/stored-turn";
import type { StoredChatTurn } from "@/lib/projects/types";
import type { SceneRow } from "./scene-files";

export function storedTurnOfSceneRow(r: SceneRow): StoredChatTurn {
  return storedTurnFromRow({
    id: r.id,
    userText: r.userText,
    assistantReasoning: r.assistantReasoning,
    status: r.status,
    createdAt: new Date(r.createdAt),
    attachedImage: r.attachedImage as ChatRowForTurn["attachedImage"],
    actions: r.actions as ChatRowForTurn["actions"],
  });
}
