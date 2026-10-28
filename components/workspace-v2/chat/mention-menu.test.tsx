// THE CHAT'S «@» (spec local 2026-10-27): typing «@» lists what can be pointed
// at, the canvas outlines the active row, Enter leaves a mention in the text.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
}));

import { ChatComposer } from "./chat-composer";
import { registerMentionCanvas } from "../mention-highlight";
import { MAX_MENTIONS, type MentionEntry, type MentionRef } from "@/lib/mentions/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function entry(n: number, over: Partial<MentionEntry>): MentionEntry {
  const tag = over.tag ?? "p";
  return {
    key: `/index.html:${n}:1`,
    ruta: "/index.html",
    line: n,
    tag,
    kind: "text",
    name: tag,
    text: "",
    attrs: {},
    component: null,
    parent: null,
    collapsed: false,
    target: { type: "page", page: null, path: `${tag}:nth-of-type(${n})`, tag },
    ...over,
  };
}
const HERO = entry(3, { tag: "h1", kind: "heading", name: "Pan de verdad", text: "Pan de verdad" });
const LINK = entry(4, {
  tag: "a",
  kind: "link",
  name: "Ver el mostrador",
  text: "Ver el mostrador",
  target: { type: "page", page: null, path: "a:nth-of-type(1)", tag: "a", text: "Ver el mostrador" },
});
const INDEX = { entries: [HERO, LINK], files: ["/LEN.md"] };
const ELI = { userId: "u-eli", nombre: "Eli Editor" };

const roots: Root[] = [];
const posted: unknown[] = [];
let unregister: () => void = () => {};
beforeEach(() => {
  posted.splice(0);
  unregister = registerMentionCanvas({ window: () => ({ postMessage: (m: unknown) => posted.push(m) }) as unknown as Window, page: () => null });
});
afterEach(() => {
  unregister();
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function Box(props: { withPeople?: boolean; initial?: MentionRef[]; initialValue?: string; onSubmit?: () => void; onMentions: (m: MentionRef[]) => void; onPick: () => void; value: { current: string } }) {
  const [v, setV] = useState(props.initialValue ?? "");
  const [mentions, setMentions] = useState<MentionRef[]>(props.initial ?? []);
  props.value.current = v;
  const ta = useRef<HTMLTextAreaElement | null>(null);
  return (
    <ChatComposer
      value={v}
      onChange={setV}
      onSubmit={props.onSubmit ?? (() => {})}
      onStop={() => {}}
      busy={false}
      textareaRef={ta}
      comments={[]}
      onRemoveComment={() => {}}
      scopedSelection={null}
      sectionSelectMode={false}
      onToggleSectionSelect={(on) => on && props.onPick()}
      attachedImage={null}
      onAttachImage={() => {}}
      onClearAttachedImage={() => {}}
      effort="auto"
      effortLevels={["low", "medium", "high"]}
      effortResolvesTo="medium"
      onEffortChange={() => {}}
      mode="len"
      mentionIndex={INDEX}
      mentions={mentions}
      onMentionsChange={(m) => {
        setMentions(m);
        props.onMentions(m);
      }}
      {...(props.withPeople ? { mencionables: { gente: [ELI], colorDe: () => "rgb(9, 8, 7)", conLen: true } } : {})}
    />
  );
}

function mount(opts: { withPeople?: boolean; initial?: MentionRef[]; initialValue?: string; onSubmit?: () => void } = {}) {
  const onMentions = vi.fn();
  const onPick = vi.fn();
  const value = { current: "" };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<Box {...opts} onMentions={onMentions} onPick={onPick} value={value} />));
  const box = host.querySelector("textarea")!;
  const type = (text: string) =>
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(box, text);
      box.setSelectionRange(text.length, text.length);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const key = (k: string) => act(() => void box.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));
  const rows = () => [...host.querySelectorAll('[data-mention-menu] [role="option"]')].map((o) => o.textContent ?? "");
  return { host, type, key, rows, onMentions, onPick, value };
}

describe("the «@» menu", () => {
  it("lists «Ver el mostrador» for @ver and Enter leaves the mention in the text", () => {
    const v = mount();
    v.type("haz @ver");
    expect(v.rows()[0]).toContain("Ver el mostrador");
    expect(v.rows()[0]).toContain("mentions.kind.link");
    v.key("Enter");
    expect(v.value.current).toBe("haz @mentions.kind.link · Ver el mostrador ");
    expect(v.onMentions).toHaveBeenLastCalledWith([
      { type: "element", label: "@mentions.kind.link · Ver el mostrador", text: "Ver el mostrador", target: LINK.target },
    ]);
  });

  it("keeps searching across a space while there are matches", () => {
    const v = mount();
    v.type("@ver most");
    expect(v.rows()[0]).toContain("Ver el mostrador");
  });

  it("outlines the active row on the canvas and clears it when the menu closes", () => {
    const v = mount();
    v.type("@ver");
    expect(posted).toContainEqual({ type: "openlen:mention-highlight", key: LINK.key, target: LINK.target });
    v.key("Escape");
    expect(posted.at(-1)).toEqual({ type: "openlen:mention-highlight", key: LINK.key, target: null });
  });

  it("opens nothing for an address typed mid-word, and Escape leaves a lone @ alone", () => {
    const v = mount();
    v.type("escribe a ana@x.com");
    expect(v.rows()).toEqual([]);
    v.type("@");
    expect(v.rows().length).toBeGreaterThan(0);
    v.key("Escape");
    expect(v.rows()).toEqual([]);
    expect(v.value.current).toBe("@");
    expect(v.onMentions).not.toHaveBeenCalled();
  });

  it("puts the people first in the team chat, and picking one is the person mention it always was", () => {
    const v = mount({ withPeople: true });
    v.type("@");
    expect(v.rows()[0]).toContain("Len");
    expect(v.rows()[1]).toContain("Eli Editor");
    v.key("ArrowDown");
    v.key("Enter");
    expect(v.value.current).toBe("@Eli Editor ");
    expect(v.onMentions).not.toHaveBeenCalled();
  });

  it("picking the same element twice keeps one mention", () => {
    const v = mount();
    v.type("@ver");
    v.key("Enter");
    v.type(`${v.value.current}y @ver`);
    v.key("Enter");
    expect(v.onMentions.mock.calls.at(-1)![0]).toHaveLength(1);
  });

  it("drops a mention whose label was deleted from the text", () => {
    const v = mount();
    v.type("@ver");
    v.key("Enter");
    v.type("haz ");
    expect(v.onMentions).toHaveBeenLastCalledWith([]);
  });

  it("refuses a mention past the limit and says so", () => {
    const full = Array.from({ length: MAX_MENTIONS }, (_, i): MentionRef => ({ type: "file", label: `@/f${i}.md`, ruta: `/f${i}.md` }));
    const text = full.map((m) => m.label).join(" ");
    const v = mount({ initial: full, initialValue: text });
    v.type(`${text} @ver`);
    expect(v.host.querySelector("[data-mention-menu]")!.textContent).toContain("mentions.limit");
    v.key("Enter");
    expect(v.value.current.endsWith("@ver")).toBe(true);
  });

  it("lets Enter send a message with an unpicked «@» in its prose, text unchanged", () => {
    const sent = vi.fn();
    const v = mount({ onSubmit: sent });
    v.type("Cambia el @ por un icono");
    v.key("Enter");
    expect(v.value.current).toBe("Cambia el @ por un icono");
    expect(v.onPick).not.toHaveBeenCalled();
    expect(sent).toHaveBeenCalled();
  });

  it("closes for a word that matches nothing, so Enter sends", () => {
    const sent = vi.fn();
    const v = mount({ onSubmit: sent });
    v.type("@zzzz");
    expect(v.rows()).toEqual([]);
    v.key("Enter");
    expect(sent).toHaveBeenCalled();
    expect(v.value.current).toBe("@zzzz");
  });

  it("ends with «pick on the canvas», which turns pointing on", () => {
    const v = mount();
    v.type("@");
    expect(v.rows().at(-1)).toContain("mentions.pickOnCanvas");
    for (let i = 0; i < v.rows().length - 1; i++) v.key("ArrowDown");
    v.key("Enter");
    expect(v.onPick).toHaveBeenCalled();
    expect(v.value.current).toBe("");
  });
});
