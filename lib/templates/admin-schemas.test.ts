// Run via: npx tsx --test lib/templates/admin-schemas.test.ts
// (node:test, no vitest: la validación usa el binding nativo vía
// sanitizeForPublish, que vite no puede cargar.)
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { CreateSchema, UpdateSchema, findTemplateHtmlIssue } from "./admin-schemas";

// Las plantillas se guardan CRUDAS en R2 A PROPÓSITO y se sanitizan al CLONAR
// — ese diseño es lo que permitió que el fix del carrier (977e325) reparara
// los clones futuros solos. Por eso el registro VALIDA Y RECHAZA en vez de
// sanitizar: mutilar aquí destruiría la única copia cruda de esas paletas.
//
// El criterio salió de medir el corpus real (178 plantillas en
// templates/starter, scratch/template-corpus-scan.mts):
//   scripts inline .... 89% de las plantillas  → NO puede ser motivo de rechazo
//   handlers on* ...... 13%                    → NO puede ser motivo de rechazo
//   javascript: URLs ... 0%                    → rechazo seguro
//   iframes ............ 0%                    → rechazo seguro
//   meta refresh ....... 0%                    → rechazo seguro

const HEAD = '<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script>';

const visualMetadata = {
  schemaVersion: "template-visual-metadata/1.0",
  domains: ["children_entertainment"], audiences: ["children"], ageRanges: ["5_10"],
  emotionalRegisters: ["playful"], visualArchetypes: ["illustrated_creative_play"],
  visualSignals: ["child_friendly_illustration"], layoutTraits: ["image_forward"],
  requiredAssetTypes: ["illustration"], negativeTags: ["enterprise_b2b"],
  supportedSiteTypes: ["content_platform"], supportedSectionRoles: ["hero", "stories", "footer"],
  themeability: "high", identityStrength: "high", reviewStatus: "reviewed",
};

test("accepts reviewed visual metadata on create", () => {
  assert.equal(CreateSchema.safeParse({
    id: "kids", name: "Kids", family: "education", accent: "#F472B6",
    pitch: "Creative play", description: "Illustrated activities for children",
    mode: "light", html: "<!doctype html><html><body>Kids</body></html>", visualMetadata,
  }).success, true);
});

test("rejects prose taxonomy tags on update", () => {
  assert.equal(UpdateSchema.safeParse({
    visualMetadata: { ...visualMetadata, domains: ["Children Entertainment"] },
  }).success, false);
});

test("acepta una plantilla curada normal: config de Tailwind + script inline", () => {
  const html =
    HEAD +
    "<script>tailwind.config={theme:{extend:{colors:{ink:'#0a0a0a'}}}}</script>" +
    "<script>document.querySelectorAll('.nav').forEach(function(n){n.dataset.x=1})</script>" +
    "</head><body><h1>Hola</h1></body></html>";
  assert.equal(findTemplateHtmlIssue({ html }), null);
});

test("acepta handlers on* — 13% del corpus los trae y el clon los quita", () => {
  const html = HEAD + '</head><body><button onclick="abrir()">x</button></body></html>';
  assert.equal(findTemplateHtmlIssue({ html }), null);
});

test("rechaza una URL javascript: (0% del corpus legítimo)", () => {
  const html = HEAD + '</head><body><a href="javascript:steal()">x</a></body></html>';
  const issue = findTemplateHtmlIssue({ html });
  assert.ok(issue, "debería rechazar");
  assert.match(issue.reason, /URL/i);
  assert.equal(issue.where, "html");
});

test("rechaza un <iframe> — no sobreviviría al clon, mejor decirlo fuerte", () => {
  const html = HEAD + '</head><body><iframe src="https://evil.example"></iframe></body></html>';
  const issue = findTemplateHtmlIssue({ html });
  assert.ok(issue);
  assert.match(issue.reason, /iframe|incrust/i);
});

test("rechaza meta refresh", () => {
  const html =
    '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://evil.example">' +
    "</head><body>x</body></html>";
  const issue = findTemplateHtmlIssue({ html });
  assert.ok(issue);
  assert.match(issue.reason, /refresh/i);
});

test("rechaza el marcador de modo-editor", () => {
  const html = HEAD + '</head><body><div data-slot-path="hero.title">x</div></body></html>';
  const issue = findTemplateHtmlIssue({ html });
  assert.ok(issue);
  assert.match(issue.reason, /slot-path|editor/i);
});

// El hueco real que cerramos: el POST de admin solo miraba el html de nivel
// superior; PUT y el CLI ya revisaban las páginas.
test("revisa TAMBIÉN las páginas y dice cuál es la culpable", () => {
  const clean = HEAD + "</head><body>ok</body></html>";
  const issue = findTemplateHtmlIssue({
    html: clean,
    pages: [
      { slug: "precios", html: clean },
      { slug: "contacto", html: HEAD + '</head><body><iframe src="x"></iframe></body></html>' },
    ],
  });
  assert.ok(issue, "una página hostil debe rechazar el registro entero");
  assert.equal(issue.where, 'pages["contacto"]');
});

test("páginas limpias pasan", () => {
  const clean = HEAD + "</head><body>ok</body></html>";
  assert.equal(
    findTemplateHtmlIssue({ html: clean, pages: [{ slug: "precios", html: clean }] }),
    null,
  );
});

test("payload sin html (update parcial de solo metadatos) no se queja", () => {
  assert.equal(findTemplateHtmlIssue({}), null);
});
