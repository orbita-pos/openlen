// The chat's `/` menu (spec local 2026-10-26-len-skills, §4.5): typing `/` at the start of a word
// lists the skills the person can invoke, filtered by what follows; Enter or Tab picks and leaves
// "/name "; Escape closes it. Same harness as chat-composer.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (clave: string) => clave }));

import { menuDescription, skillOptions, slashInProgress, useSkillSlash } from "./skill-menu";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SKILLS = [
  { name: "office", description: "Route office work." },
  { name: "office-docx", description: "Word documents." },
  { name: "cotizar", description: "How I quote." },
];

describe("slashInProgress", () => {
  it("is a / at the start of a word, up to the cursor", () => {
    expect(slashInProgress("/off", 4)).toEqual({ from: 0, query: "off" });
    expect(slashInProgress("hazme /cot", 10)).toEqual({ from: 6, query: "cot" });
    expect(slashInProgress("https://x/off", 13)).toBeNull();
    expect(slashInProgress("/office hola", 12)).toBeNull();
  });
});

describe("skillOptions", () => {
  it("filters by the typed prefix", () => {
    expect(skillOptions("off", SKILLS).map((s) => s.name)).toEqual(["office", "office-docx"]);
    expect(skillOptions("", SKILLS).length).toBe(3);
  });
});

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function Harness(p: { skills: typeof SKILLS; onValue: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState("");
  const set = (v: string) => {
    setValue(v);
    p.onValue(v);
  };
  const slash = useSkillSlash(value, set, ref, p.skills);
  return (
    <div>
      {slash.menu}
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          set(e.target.value);
          slash.onSeleccion(e);
        }}
        onSelect={slash.onSeleccion}
        onKeyDown={(e) => void slash.tecla(e)}
      />
    </div>
  );
}

function mount(skills = SKILLS) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const values: string[] = [];
  act(() => root.render(<Harness skills={skills} onValue={(v) => values.push(v)} />));
  const ta = host.querySelector("textarea")!;
  const type = (text: string) =>
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(ta, text);
      ta.setSelectionRange(text.length, text.length);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const key = (k: string) => act(() => void ta.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
  return { host, type, key, values };
}

describe("useSkillSlash", () => {
  it("lists the matching skills while typing /", () => {
    const m = mount();
    m.type("/off");
    const options = [...m.host.querySelectorAll('[role="option"]')].map((o) => o.querySelector("span")?.textContent);
    expect(options).toEqual(["/office", "/office-docx"]);
  });

  it('Enter picks and leaves "/name "', () => {
    const m = mount();
    m.type("/cot");
    m.key("Enter");
    expect(m.values.at(-1)).toBe("/cotizar ");
  });

  it("Escape closes", () => {
    const m = mount();
    m.type("/off");
    m.key("Escape");
    expect(m.host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("shows composer.noSkills when nothing matches", () => {
    const m = mount();
    m.type("/zzz");
    expect(m.host.textContent).toContain("composer.noSkills");
  });

  it("without skills, no menu at all", () => {
    const m = mount([]);
    m.type("/off");
    expect(m.host.querySelector('[role="listbox"]')).toBeNull();
    expect(m.host.textContent).not.toContain("composer.noSkills");
  });
});

describe("menuDescription", () => {
  const lines: Record<string, string> = { "composer.skillDescriptions.pdf": "Crear PDF y trabajar con los que ya tienes" };
  const t = Object.assign((k: string) => lines[k] ?? k, { has: (k: string) => k in lines });
  it("OpenLen's own skill says it in the person's language", () => {
    expect(menuDescription({ name: "pdf", description: "Create PDF files and work on existing ones…", scope: "bundled" }, t)).toBe("Crear PDF y trabajar con los que ya tienes");
  });
  it("a skill of the project or the person shows its own description, as its author wrote it (Claude Code's menu)", () => {
    expect(menuDescription({ name: "cotizar", description: "Cómo cotizo pasteles.", scope: "project" }, t)).toBe("Cómo cotizo pasteles.");
    expect(menuDescription({ name: "cotizar", description: "Cómo cotizo pasteles." }, t)).toBe("Cómo cotizo pasteles.");
  });
  it("an OpenLen skill without its line falls back to its own description", () => {
    expect(menuDescription({ name: "brand-new", description: "Do the new thing.", scope: "bundled" }, t)).toBe("Do the new thing.");
  });
});
