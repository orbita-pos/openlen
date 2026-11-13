// A PHOTO THAT IS A FILE OF THE PROJECT'S FOLDER, PAINTED IN THE CHAT (F7, seen in production on
// 12/11). Since 28/10 the image modal leaves an upload at /img/<name>.webp and the chat attaches
// that path — the one the page uses. As an <img src> in the workspace it asked openlen.com for
// /img/…, which is a 404: a broken thumbnail in the composer, in the sent message and in the team's
// chat. The folder's own route serves it; a web address is painted as it always was.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key, useLocale: () => "es" }));

import { ChatComposer } from "./chat-composer";
import { UserMessage } from "./chat-turn";
import { MensajeDelEquipo } from "./mensaje-del-equipo";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});
function mount(node: ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

const IN_FOLDER = { url: "/img/a foto.webp" };
const ON_THE_WEB = { url: "https://cdn.example/b.png" };
const FROM_THE_FOLDER = "/api/projects/p1/ficheros/raw?ruta=%2Fimg%2Fa%20foto.webp";
const sources = (host: HTMLElement) => [...host.querySelectorAll("img")].map((img) => img.getAttribute("src"));

function Composer({ projectId }: { projectId?: string }) {
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  return (
    <ChatComposer
      value=""
      onChange={() => {}}
      onSubmit={() => {}}
      onStop={() => {}}
      busy={false}
      textareaRef={textarea}
      comments={[]}
      onRemoveComment={() => {}}
      scopedSelection={null}
      sectionSelectMode={false}
      attachedImage={IN_FOLDER}
      attachedImages={[IN_FOLDER, ON_THE_WEB]}
      onAttachImage={() => {}}
      onClearAttachedImage={() => {}}
      effort="auto"
      effortLevels={["low", "medium", "high"]}
      effortResolvesTo="medium"
      onEffortChange={() => {}}
      mode="len"
      {...(projectId ? { projectId } : {})}
    />
  );
}

const turn = (extra: Record<string, unknown>) => ({ id: "t1", userText: "pon estas fotos", assistantReasoning: "", status: "applied", preEditHtml: "", ...extra }) as never;

describe("a photo of the project's folder is painted from the folder's route", () => {
  it("in the composer's chip, before sending", () => {
    expect(sources(mount(<Composer projectId="p1" />))).toEqual([FROM_THE_FOLDER, ON_THE_WEB.url]);
  });

  it("in the message once sent", () => {
    const host = mount(<UserMessage turn={turn({ attachedImage: IN_FOLDER, attachedImages: [IN_FOLDER, ON_THE_WEB] })} initial="J" projectId="p1" />);
    expect(sources(host)).toEqual([FROM_THE_FOLDER, ON_THE_WEB.url]);
  });

  it("in a message between people of the team, and its link opens the same file", () => {
    const host = mount(
      <MensajeDelEquipo turn={turn({ tipo: "persona", autorId: "u1", attachedImage: IN_FOLDER })} gente={[{ userId: "u1", nombre: "Eli" }]} yo="u1" colorDe={() => "red"} projectId="p1" />,
    );
    expect(sources(host)).toEqual([FROM_THE_FOLDER]);
    expect(host.querySelector("a")!.getAttribute("href")).toBe(FROM_THE_FOLDER);
  });

  it("CONTROL: with no project to ask, the address is painted as it came", () => {
    expect(sources(mount(<Composer />))).toEqual([IN_FOLDER.url, ON_THE_WEB.url]);
  });
});
