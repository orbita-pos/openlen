// @vitest-environment jsdom
//
// The form's automatic reply in the inspector (spec local
// 2026-10-22-email-integration, 6.5), with the REAL Spanish texts: the two
// fields, `{{field}}` shown as typed (ICU would read the braces as its own), and
// what the owner types saved as the form's `autoReply`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import panelsProps from "@/messages/es/panelsProps.json";
import modalsDomain from "@/messages/es/modalsDomain.json";
import type { FormConfig } from "@/lib/projects/types";

import { PropertiesPanel } from "./properties-panel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

const noop = () => {};

function mount(config: FormConfig | null, onApplyFormConfig = vi.fn()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <NextIntlClientProvider locale="es" messages={{ panelsProps, modalsDomain }}>
        <PropertiesPanel
          selection={{ path: "0.1", tag: "form", hint: "form", props: {}, formIndex: 0, formId: "f1a2b3" }}
          pageMeta={null}
          formConfig={config}
          onApplyElementProp={noop}
          onLinkifyButton={noop}
          onApplyPageMeta={noop}
          onApplyFormConfig={onApplyFormConfig}
          onApplyStyle={noop}
          onResetProps={noop}
          onSelectPath={noop}
          onApplyBg={noop}
          onApplyHide={noop}
          onClearSelection={noop}
          onClose={noop}
        />
      </NextIntlClientProvider>,
    ),
  );
  return { host, onApplyFormConfig };
}

const f = panelsProps.form;

describe("the form's automatic reply in the inspector", () => {
  it("shows its two fields with {{field}} as typed, and the note", () => {
    const { host } = mount({ autoReply: { subject: "Gracias, {{nombre}}", body: "Te escribimos pronto." } });
    expect(host.textContent).toContain(f.autoReplySubject);
    expect(host.textContent).toContain(f.autoReplyBody);
    expect(host.textContent).toContain(f.autoReplyNote.replace("{open}", "{{").replace("{close}", "}}"));
    const inputs = [...host.querySelectorAll<HTMLInputElement>("input[type=text]")];
    const subject = inputs.find((i) => i.value === "Gracias, {{nombre}}");
    expect(subject).toBeDefined();
    expect(host.querySelector<HTMLTextAreaElement>("textarea[placeholder*='{{']")?.placeholder).toBe(f.autoReplyBodyPlaceholder.replace("{open}", "{{").replace("{close}", "}}"));
  });

  it("typing the subject saves autoReply with the text that was there", () => {
    const { host, onApplyFormConfig } = mount({ autoReply: { subject: "", body: "Te escribimos pronto." } });
    const subject = [...host.querySelectorAll<HTMLInputElement>("input[type=text]")].find((i) => i.placeholder.includes("{{"))!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(subject, "Gracias, {{nombre}}");
      subject.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      subject.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onApplyFormConfig).toHaveBeenCalledWith(0, "f1a2b3", { autoReply: { subject: "Gracias, {{nombre}}", body: "Te escribimos pronto." } });
  });
});
