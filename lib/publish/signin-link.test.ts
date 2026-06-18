import { describe, it, expect } from "vitest";
import { applySigninLink, signinLabelFor } from "./signin-link";

const OPTS = { href: "/miembros", label: "Iniciar sesión" };

describe("signinLabelFor", () => {
  it("maps known locales, falls back to en", () => {
    expect(signinLabelFor("es")).toBe("Iniciar sesión");
    expect(signinLabelFor("en")).toBe("Sign in");
    expect(signinLabelFor("xx")).toBe("Sign in");
    expect(signinLabelFor(null)).toBe("Sign in");
  });
});

describe("applySigninLink — rewire existing", () => {
  it("rewires a template sign-in link's href, keeping its classes + text", () => {
    const html = `<header><nav><a href="#x">Pricing</a></nav><div><a href="#cta" class="text-sm" style="color:var(--ink-soft)">Iniciar sesión</a><a href="#cta" class="btn">Empezar</a></div></header>`;
    const out = applySigninLink(html, OPTS);
    expect(out).toContain(
      `<a href="/miembros" class="text-sm" style="color:var(--ink-soft)">Iniciar sesión</a>`,
    );
    // CTA + nav links untouched
    expect(out).toContain(`<a href="#cta" class="btn">Empezar</a>`);
    expect(out).toContain(`<a href="#x">Pricing</a>`);
    // exactly one sign-in, no injected duplicate
    expect((out.match(/Iniciar sesión/g) || []).length).toBe(1);
    expect(out).not.toContain("data-ol-signin");
  });

  it("rewires English 'Sign in' too", () => {
    const html = `<header><a href="#">Sign in</a></header>`;
    expect(applySigninLink(html, OPTS)).toContain(`<a href="/miembros">Sign in</a>`);
  });

  it("rewires ALL matching links (mobile menu duplicate)", () => {
    const html = `<header><a href="#a">Sign in</a></header><div id="m"><a href="#b">Sign in</a></div>`;
    const out = applySigninLink(html, OPTS);
    expect((out.match(/href="\/miembros"/g) || []).length).toBe(2);
  });

  it("does NOT match a different link like 'Iniciar proyecto'", () => {
    const html = `<header><nav><a href="#p">Iniciar proyecto</a></nav></header>`;
    const out = applySigninLink(html, OPTS);
    expect(out).toContain("Iniciar proyecto</a>"); // original intact
    expect(out).toContain("data-ol-signin"); // injected instead
    expect(out).toContain(`href="/miembros"`);
  });
});

describe("applySigninLink — inject when absent", () => {
  it("appends into the first <nav> as the last item", () => {
    const html = `<header><nav class="flex"><a href="#a">Producto</a><a href="#b">Precios</a></nav><div><a class="btn" href="#cta">Empezar</a></div></header>`;
    const out = applySigninLink(html, OPTS);
    expect(out).toMatch(
      /<a href="\/miembros" data-ol-signin[^>]*>Iniciar sesión<\/a><\/nav>/,
    );
  });

  it("falls back to <header> when there is no <nav>", () => {
    const html = `<header><a class="btn" href="#cta">Start</a></header><main></main>`;
    const out = applySigninLink(html, { href: "/members", label: "Sign in" });
    expect(out).toMatch(/data-ol-signin[^>]*>Sign in<\/a><\/header>/);
  });

  it("falls back to a fixed pill before </body> when no nav/header", () => {
    const html = `<body><main>hi</main></body>`;
    const out = applySigninLink(html, OPTS);
    expect(out).toMatch(
      /<a href="\/miembros" data-ol-signin style="position:fixed[^>]*>Iniciar sesión<\/a><\/body>/,
    );
  });

  it("is idempotent — re-applying rewires the injected link, no duplicate", () => {
    const html = `<header><nav><a href="#a">Producto</a></nav></header>`;
    const twice = applySigninLink(applySigninLink(html, OPTS), OPTS);
    expect((twice.match(/Iniciar sesión/g) || []).length).toBe(1);
    expect((twice.match(/data-ol-signin/g) || []).length).toBe(1);
  });

  it("no-op on empty input", () => {
    expect(applySigninLink("", OPTS)).toBe("");
  });
});
