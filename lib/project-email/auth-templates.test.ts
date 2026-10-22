import { describe, expect, it } from "vitest";

import { authTemplateDiagnostics, readAuthTemplates, renderAuthTemplate, templateProblem, templateTypeOf } from "./auth-templates";

// Supabase's own example (supabase.com/docs/guides/local-development/customizing-email-templates).
const TOML = `
[auth]
site_url = "http://127.0.0.1:3000"

[auth.email.template.invite]
subject = "You are invited"
content_path = "./supabase/templates/invite.html"

[auth.email.template.recovery]
subject = "Cambia tu contraseña en {{ .SiteURL }}"
content_path = "./supabase/templates/recovery.html" # the reset email

[functions.pago]
verify_jwt = false
`;

const VARS = { ConfirmationURL: "https://taller.mx/auth/v1/verify?token=abc&type=recovery", Token: "123456", SiteURL: "https://taller.mx", Email: "ana@x.com", RedirectTo: "https://taller.mx/#/" };

describe("readAuthTemplates", () => {
  it("reads subject and content_path of each [auth.email.template.<type>]", () => {
    expect(readAuthTemplates(TOML)).toEqual({
      invite: { subject: "You are invited", contentPath: "./supabase/templates/invite.html" },
      recovery: { subject: "Cambia tu contraseña en {{ .SiteURL }}", contentPath: "./supabase/templates/recovery.html" },
    });
    expect(readAuthTemplates("")).toEqual({});
  });

  it("OpenLen's kinds map to Supabase's template names", () => {
    expect([templateTypeOf("signup"), templateTypeOf("recovery"), templateTypeOf("invite"), templateTypeOf("magiclink")]).toEqual(["confirmation", "recovery", "invite", "magic_link"]);
  });
});

describe("renderAuthTemplate", () => {
  it("fills the five variables, with or without spaces, escaped for HTML", () => {
    const r = renderAuthTemplate({ subject: "Entra a {{ .SiteURL }}", html: '<a href="{{ .ConfirmationURL }}">Entrar</a> {{.Token}} {{ .Email }} {{ .RedirectTo }}' }, { ...VARS, Email: "<ana>@x.com" });
    expect(r).toEqual({
      subject: "Entra a https://taller.mx",
      html: '<a href="https://taller.mx/auth/v1/verify?token=abc&amp;type=recovery">Entrar</a> 123456 &lt;ana&gt;@x.com https://taller.mx/#/',
    });
  });

  it("a Go template action or an unknown variable is refused with the reason", () => {
    expect(renderAuthTemplate({ subject: "s", html: "{{ if .Token }}x{{ end }}" }, VARS)).toEqual({ error: expect.stringMatching(/only \{\{ \.Name \}\} variables/i) });
    expect(renderAuthTemplate({ subject: "s", html: "{{ .Data.name }}" }, VARS)).toEqual({ error: expect.stringMatching(/\.Data\.name/) });
  });
});

describe("templateProblem and the diagnostics Len gets", () => {
  it("a template without the link or the code leaves people out", () => {
    expect(templateProblem("recovery", "<p>hola</p>")).toMatch(/ConfirmationURL/);
    expect(templateProblem("recovery", '<a href="{{ .ConfirmationURL }}">x</a>')).toBeNull();
    expect(templateProblem("magic_link", "Tu código: {{ .Token }}")).toBeNull();
  });

  it("only when config.toml or a template was written, about the templates config.toml names", () => {
    const files = {
      "/supabase/config.toml": TOML,
      "/supabase/templates/invite.html": '<a href="{{ .ConfirmationURL }}">Acepta</a>',
      "/supabase/templates/recovery.html": "<p>hola</p>",
    };
    expect(authTemplateDiagnostics(["/supabase/functions/pago/index.ts"], files)).toEqual([]);
    const d = authTemplateDiagnostics(["/supabase/templates/recovery.html"], files);
    expect(d).toEqual([expect.objectContaining({ ruta: "/supabase/templates/recovery.html", gravedad: "Error", mensaje: expect.stringMatching(/ConfirmationURL/), fuente: "supabase" })]);
    const missing = authTemplateDiagnostics(["/supabase/config.toml"], { "/supabase/config.toml": TOML });
    expect(missing.map((x) => x.ruta)).toEqual(["/supabase/config.toml", "/supabase/config.toml"]);
    expect(missing[0]!.mensaje).toMatch(/invite\.html.*doesn't exist/);
  });
});
