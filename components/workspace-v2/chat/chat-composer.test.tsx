// LA PUERTA DEL DUEÑO AL MODO PLAN (pieza 7): «Planear primero» en el «+» lo
// enciende, la ficha «Plan» lo enseña y su ✕ lo apaga, como la de DeepSeek.
// Mientras Len trabaja la ficha no se toca, y el chat clásico no lo ofrece.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (clave: string) => clave }));

import { ChatComposer } from "./chat-composer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function Compositor({ busy = false, conPlan = true }: { busy?: boolean; conPlan?: boolean }) {
  const [plan, setPlan] = useState(false);
  const ta = useRef<HTMLTextAreaElement | null>(null);
  return (
    <ChatComposer
      value=""
      onChange={() => {}}
      onSubmit={() => {}}
      onStop={() => {}}
      busy={busy}
      textareaRef={ta}
      comments={[]}
      onRemoveComment={() => {}}
      scopedSelection={null}
      sectionSelectMode={false}
      attachedImage={null}
      onAttachImage={() => {}}
      onClearAttachedImage={() => {}}
      effort="auto"
      effortLevels={["low", "medium", "high"]}
      effortResolvesTo="medium"
      onEffortChange={() => {}}
      mode="len"
      planMode={plan || (busy && conPlan)}
      {...(conPlan ? { onTogglePlan: () => setPlan((p) => !p) } : {})}
    />
  );
}

function montar(props: Parameters<typeof Compositor>[0] = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<Compositor {...props} />));
  return host;
}

const pulsar = (el: Element | null | undefined) => {
  if (!el) throw new Error("no está");
  act(() => (el as HTMLElement).click());
};
const opcionPlan = (host: HTMLElement) =>
  [...host.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.includes("newChat.plan.option"));
const ficha = (host: HTMLElement) => [...host.querySelectorAll("b")].find((b) => b.textContent === "newChat.plan.chip");

describe("el modo plan en el compositor", () => {
  it("«Planear primero» lo enciende, la ficha aparece y su ✕ lo apaga", () => {
    const host = montar();
    expect(ficha(host)).toBeUndefined();
    pulsar(host.querySelector('[aria-label="newChat.composer.plus"]'));
    pulsar(opcionPlan(host));
    expect(ficha(host)).toBeDefined();
    pulsar(host.querySelector('[aria-label="newChat.plan.chipOff"]'));
    expect(ficha(host)).toBeUndefined();
  });

  it("mientras Len trabaja, la ficha se ve pero no se quita", () => {
    const host = montar({ busy: true });
    expect(ficha(host)).toBeDefined();
    expect(host.querySelector('[aria-label="newChat.plan.chipOff"]')).toBeNull();
  });

  it("BRAZO DE CONTROL: sin quien lo cambie (el chat clásico), ni opción ni ficha", () => {
    const host = montar({ conPlan: false });
    pulsar(host.querySelector('[aria-label="newChat.composer.plus"]'));
    expect(opcionPlan(host)).toBeUndefined();
  });
});

// LA PUERTA DEL DUEÑO AL ENCARGO (pieza 8): «Encargo» en el «+» pone la ficha,
// su ✕ la quita, y con un encargo vivo no se ofrece otro (como `/goal`).
function ConEncargo({ disponible = true, conEncargo = true }: { disponible?: boolean; conEncargo?: boolean }) {
  const [encargo, setEncargo] = useState(false);
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
      attachedImage={null}
      onAttachImage={() => {}}
      onClearAttachedImage={() => {}}
      effort="auto"
      effortLevels={["low", "medium", "high"]}
      effortResolvesTo="medium"
      onEffortChange={() => {}}
      mode="len"
      goalChip={encargo}
      goalAvailable={disponible}
      {...(conEncargo ? { onToggleGoal: () => setEncargo((x) => !x) } : {})}
    />
  );
}

function montarEncargo(props: Parameters<typeof ConEncargo>[0] = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<ConEncargo {...props} />));
  return host;
}
const opcionEncargo = (host: HTMLElement) =>
  [...host.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.includes("newChat.goal.option")) as
    | HTMLButtonElement
    | undefined;
const fichaEncargo = (host: HTMLElement) => [...host.querySelectorAll("b")].find((b) => b.textContent === "newChat.goal.chip");

describe("el encargo en el compositor", () => {
  it("«Encargo» pone la ficha, cambia la pista de la caja, y su ✕ la quita", () => {
    const host = montarEncargo();
    pulsar(host.querySelector('[aria-label="newChat.composer.plus"]'));
    pulsar(opcionEncargo(host));
    expect(fichaEncargo(host)).toBeDefined();
    expect(host.querySelector("textarea")?.getAttribute("placeholder")).toBe("newChat.goal.placeholder");
    pulsar(host.querySelector('[aria-label="newChat.goal.chipOff"]'));
    expect(fichaEncargo(host)).toBeUndefined();
  });

  it("con un encargo vivo, la opción no se puede elegir y dice por qué", () => {
    const host = montarEncargo({ disponible: false });
    pulsar(host.querySelector('[aria-label="newChat.composer.plus"]'));
    const opcion = opcionEncargo(host)!;
    expect(opcion.disabled).toBe(true);
    expect(opcion.textContent).toContain("newChat.goal.optionTaken");
  });

  it("BRAZO DE CONTROL: sin quien lo cambie, ni opción", () => {
    const host = montarEncargo({ conEncargo: false });
    pulsar(host.querySelector('[aria-label="newChat.composer.plus"]'));
    expect(opcionEncargo(host)).toBeUndefined();
  });
});
