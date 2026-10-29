// The `/` menu with the real next-intl and the real Spanish messages: OpenLen's skills read in Spanish (their
// names have dashes, like `office-docx`), a project's skill reads as its author wrote it.
import { afterEach, describe, expect, it } from "vitest";
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import panelsChat from "@/messages/es/panelsChat.json";
import { useSkillSlash, type MenuSkill } from "./skill-menu";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SKILLS: MenuSkill[] = [
  { name: "office-docx", description: "Create, read, edit, and validate Word documents (.docx).", scope: "bundled" },
  { name: "pdf", description: "Create PDF files and work on existing ones in the terminal.", scope: "bundled" },
  { name: "cotizar", description: "Cómo cotiza esta pastelería.", scope: "project" },
];

function Harness() {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState("");
  const slash = useSkillSlash(value, setValue, ref, SKILLS);
  return (
    <div>
      {slash.menu}
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          slash.onSeleccion(e);
        }}
      />
    </div>
  );
}

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

describe("the / menu in Spanish", () => {
  it("OpenLen's skills say it in Spanish; the project's, as its author wrote it", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    act(() =>
      root.render(
        <NextIntlClientProvider locale="es" messages={{ panelsChat }}>
          <Harness />
        </NextIntlClientProvider>,
      ),
    );
    const ta = host.querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(ta, "/");
      ta.setSelectionRange(1, 1);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const rows = [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(rows).toEqual([
      "/office-docxCrear y editar documentos de Word (.docx)",
      "/pdfCrear PDF y trabajar con los que ya tienes",
      "/cotizarCómo cotiza esta pastelería.",
    ]);
  });
});
