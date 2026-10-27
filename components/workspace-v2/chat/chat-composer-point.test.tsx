// THE «POINT» BUTTON of the chat box (spec local 2026-10-27, §6.6): its name is
// on it, not only in the tooltip — with the icon alone nobody found it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { ChatComposer } from "./chat-composer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function Box({ onToggle, compacta = false }: { onToggle: (on: boolean) => void; compacta?: boolean }) {
  const ta = useRef<HTMLTextAreaElement | null>(null);
  return (
    <ChatComposer
      value=""
      onChange={() => {}}
      onSubmit={() => {}}
      onStop={() => {}}
      busy={false}
      textareaRef={ta}
      comments={[]}
      onRemoveComment={() => {}}
      scopedSelection={null}
      sectionSelectMode={false}
      onToggleSectionSelect={onToggle}
      attachedImage={null}
      onAttachImage={() => {}}
      onClearAttachedImage={() => {}}
      effort="auto"
      effortLevels={["low", "medium", "high"]}
      effortResolvesTo="medium"
      onEffortChange={() => {}}
      mode="len"
      compacta={compacta}
    />
  );
}

function mount(compacta = false) {
  const onToggle = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<Box onToggle={onToggle} compacta={compacta} />));
  return { host, onToggle };
}

describe("the Point button", () => {
  it("shows its name and turns pointing on", () => {
    const { host, onToggle } = mount();
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("composer.pointLabel"));
    expect(button, "no button with a visible name").toBeTruthy();
    act(() => button!.click());
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
