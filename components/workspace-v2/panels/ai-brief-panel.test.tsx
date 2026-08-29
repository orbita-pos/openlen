import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { BriefFormState } from "@/components/workspace/types";
import { QUICK_PROMPTS } from "@/lib/quick-prompts";
import { AiBriefPanel } from "./ai-brief-panel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { max?: number }) =>
    key === "aiBrief.trimmed" ? `trimmed at ${values?.max}` : key,
}));

const roots: Root[] = [];

function Harness({
  initialPrompt = "",
  truncatedPrompt = null,
}: {
  initialPrompt?: string;
  truncatedPrompt?: string | null;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [sharedTruncatedPrompt, setSharedTruncatedPrompt] =
    useState(truncatedPrompt);
  const [announcementToken, setAnnouncementToken] = useState<string | null>(
    truncatedPrompt !== null ? "external-1" : null,
  );
  const [mounted, setMounted] = useState(true);
  const state: BriefFormState = {
    prompt,
    setPrompt,
    reference: null,
    setReference: () => undefined,
    foto: null,
    setFoto: () => undefined,
    truncatedPrompt: sharedTruncatedPrompt,
    setTruncatedPrompt: setSharedTruncatedPrompt,
    truncationAnnouncementToken: announcementToken,
    setTruncationAnnouncementToken: setAnnouncementToken,
  };

  return (
    <>
      <button
        type="button"
        data-external="different"
        onClick={() => setPrompt("external prompt value")}
      />
      <button
        type="button"
        data-external="restore"
        onClick={() => setPrompt(initialPrompt)}
      />
      <button
        type="button"
        data-mount="toggle"
        onClick={() => setMounted((value) => !value)}
      />
      <button
        type="button"
        data-external="same-truncation"
        onClick={() => {
          setSharedTruncatedPrompt(initialPrompt);
          setAnnouncementToken("external-2");
        }}
      />
      {mounted && (
        <AiBriefPanel
          state={state}
          onGenerate={() => undefined}
          generating={false}
          effort="low"
          onEffortChange={() => undefined}
        />
      )}
    </>
  );
}

function renderHarness(props: React.ComponentProps<typeof Harness> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(<Harness {...props} />);
  });
  roots.push(root);
  return container;
}

function paste(
  textarea: HTMLTextAreaElement,
  pastedText: string,
  selectionStart: number,
  selectionEnd: number,
) {
  textarea.setSelectionRange(selectionStart, selectionEnd);
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text" ? pastedText : "") },
  });
  act(() => textarea.dispatchEvent(event));
}

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

afterEach(() => {
  roots.splice(0).forEach((root) => act(() => root.unmount()));
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("AiBriefPanel — límite compartido", () => {
  it("acepta 3000 caracteres y muestra el contador sólo después de 75%", () => {
    const atThreshold = renderHarness({ initialPrompt: "a".repeat(3000) });
    const firstTextarea = atThreshold.querySelector("textarea") as HTMLTextAreaElement;
    expect(firstTextarea.maxLength).toBe(4000);
    expect(atThreshold.textContent).not.toContain("3000 / 4000");

    const overThreshold = renderHarness({ initialPrompt: "b".repeat(3001) });
    expect(overThreshold.textContent).toContain("3001 / 4000");
    expect(overThreshold.querySelector('[role="status"]')).toBeNull();
  });

  it("pegar un carácter de más deja 4000, avisa y conecta la descripción accesible", () => {
    const container = renderHarness({ initialPrompt: "a".repeat(3999) });
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;

    paste(textarea, "XY", 3999, 3999);

    expect(textarea.value).toBe(`${"a".repeat(3999)}X`);
    const descriptionId = textarea.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(container.querySelector(`#${descriptionId}`)?.textContent).toContain(
      "trimmed at 4000",
    );
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "trimmed at 4000",
    );
    expect(container.textContent).toContain("4000 / 4000");
  });

  it("reemplazar todo por exactamente 4000 que sí caben limpia el aviso previo", () => {
    const container = renderHarness({ initialPrompt: "a".repeat(3999) });
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    paste(textarea, "XY", 3999, 3999);
    expect(textarea.getAttribute("aria-describedby")).toBeTruthy();

    paste(textarea, "z".repeat(4000), 0, 4000);

    expect(textarea.value).toBe("z".repeat(4000));
    expect(textarea.getAttribute("aria-describedby")).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).toContain("4000 / 4000");
  });

  it("un quick prompt distinto limpia un aviso de pegado anterior", () => {
    const container = renderHarness({ initialPrompt: "a".repeat(3999) });
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    paste(textarea, "XY", 3999, 3999);

    const quickPrompt = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(`quickPrompts.${QUICK_PROMPTS[0]!.key}`),
    );
    expect(quickPrompt).toBeDefined();
    click(quickPrompt!);

    expect(textarea.value).toBe(QUICK_PROMPTS[0]!.prompt);
    expect(textarea.getAttribute("aria-describedby")).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("presenta como advertido un valor recortado por un deep-link", () => {
    const prompt = "d".repeat(4000);
    const container = renderHarness({ initialPrompt: prompt, truncatedPrompt: prompt });
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;

    expect(textarea.getAttribute("aria-describedby")).toBeTruthy();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "trimmed at 4000",
    );
  });

  it("un setter externo distinto consume el marcador compartido y no lo revive", () => {
    const prompt = "d".repeat(4000);
    const container = renderHarness({ initialPrompt: prompt, truncatedPrompt: prompt });
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.getAttribute("aria-describedby")).toBeTruthy();

    click(container.querySelector('[data-external="different"]')!);
    expect(textarea.value).toBe("external prompt value");
    expect(textarea.getAttribute("aria-describedby")).toBeNull();

    click(container.querySelector('[data-external="restore"]')!);
    expect(textarea.value).toBe(prompt);
    expect(textarea.getAttribute("aria-describedby")).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("un remount conserva el aviso visible sin volver a anunciarlo", () => {
    const prompt = "d".repeat(4000);
    const container = renderHarness({ initialPrompt: prompt, truncatedPrompt: prompt });
    expect(container.querySelector('[role="status"]')).not.toBeNull();

    click(container.querySelector('[data-mount="toggle"]')!);
    expect(container.querySelector("textarea")).toBeNull();
    click(container.querySelector('[data-mount="toggle"]')!);

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.getAttribute("aria-describedby")).toBeTruthy();
    expect(container.textContent).toContain("trimmed at 4000");
    expect(container.textContent).toContain("4000 / 4000");
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("otro recorte externo con el mismo prefijo crea un anuncio nuevo", () => {
    const prompt = "d".repeat(4000);
    const container = renderHarness({ initialPrompt: prompt, truncatedPrompt: prompt });
    const firstStatus = container.querySelector('[role="status"]');
    expect(firstStatus).not.toBeNull();

    click(container.querySelector('[data-external="same-truncation"]')!);

    const secondStatus = container.querySelector('[role="status"]');
    expect(secondStatus).not.toBeNull();
    expect(secondStatus).not.toBe(firstStatus);
  });
});
