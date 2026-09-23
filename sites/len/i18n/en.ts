import type { Diccionario } from "./index";

export const en: Diccionario = {
  htmlLang: "en",
  meta: {
    title: "Len — your own web developer",
    description:
      "Tell Len what you want and it builds your page, publishes it, and changes it whenever you ask. No agency, no quotes.",
  },
  nav: {
    research: "Research",
    principios: "Principles",
    openlen: "OpenLen",
    prueba: "Try Len",
    otroIdioma: "Español",
    otroLang: "es",
  },
  pie: {
    marca: "Len, by OpenLen",
    abierto: "Open source (AGPLv3). Every number on this site links to the evidence behind it.",
    len: "Len",
    openlen: "OpenLen",
    idioma: "Language",
    status: "Status",
    github: "GitHub",
  },
  pruebaUrl: "https://openlen.com/en/new",
  principiosPagina: {
    titulo: "Principles",
    intro:
      "What Len promises, why, how we check it, and where each promise stands today. No varnish: what isn’t guaranteed yet, we say.",
  },
  research: {
    titulo: "Research",
    intro:
      "What we’ve learned building Len: the problem, how we measured it, what we found —our own mistakes included— and what’s still open.",
    leer: "min read",
    volver: "← All research",
    otroIdioma: "Leer en español",
  },
  portada: {
    antetitulo: "Len, by OpenLen",
    titular: ["Your ", "own", " web developer."],
    parrafo:
      "Tell Len what you want, the way you’d tell a person, and it builds your page, publishes it, and changes it whenever you ask. No agency, no quotes, no waiting weeks.",
    cta: "Try Len",
    ctaSecundario: "What it can do",
    altCielo: "A painted dawn sky with a thin coral ring of light among the clouds.",
    cielo: {
      titulo: "Len 1.5",
      texto: "What used to mean hiring someone now means sending a message.",
      cta: "How it works →",
    },
    oficio: {
      antetitulo: "What it does for you",
      titulo: "What you’d ask a developer for.",
      tarjetas: [
        {
          k: "construye",
          t: "Builds what you ask for",
          p: "A section, a new page, or the whole site redesigned. And if you ask to change one sentence, it changes that sentence — it doesn’t rewrite everything else.",
          commit: "",
        },
        {
          k: "funciona",
          t: "Working, not just good-looking",
          p: "Forms that reach you, a cart that saves to a database, an assistant that answers your visitors.",
          commit: "fa5443c7",
        },
        {
          k: "pruebas",
          t: "Leaves tests for what it builds",
          p: "When something on your page moves — a cart, tabs, a menu — it writes a test and runs it in a real browser. After every later change it runs it again: if something that worked breaks, it tells you.",
          commit: "f3b10e53",
        },
        {
          k: "mira",
          t: "Looks before handing over",
          p: "It opens the page and measures it: contrast at the pixel, mobile overflow, and JavaScript errors. On every page it touched, not just the last one.",
          commit: "10c1cdaa",
        },
        {
          k: "cuenta",
          t: "Tells you what it checked",
          p: "What it did, what it checked, and what it didn’t. If something didn’t work out, it says so — and what was missing.",
          commit: "f8e9e8cd",
        },
        {
          k: "cobro",
          t: "Doesn’t charge for what it didn’t do",
          p: "If a turn gets stuck and goes nowhere, it isn’t charged.",
          commit: "bfa5a400",
        },
      ],
    },
    cifras: {
      antetitulo: "Len 1.0 → Len 1.5",
      titulo: "What changed since 1.0, measured.",
      leer: "How we measured it",
      items: [
        {
          valor: "64 → 67",
          texto: "of 69 requests solved, with the same battery run against both versions’ code and the same model",
          commit: "48a3b66b",
        },
        {
          valor: "3",
          texto: "1.0 failures that 1.5 no longer has: it ran out of steps, warned about an edit nobody made, and when it hit its limit it neither looked at the page nor said it hadn’t",
          commit: "48a3b66b",
        },
      ],
      nota: "One run per request: the difference is small and close to noise. There are 14 more requests, written after 1.0, that its test bench can’t pose; 1.5 solves 13. And one failure both share: they invent the country code for a phone number you give them without one.",
      notaCommit: "48a3b66b",
    },
    tarjeta: {
      antetitulo: "Len 1.5 · September 2026",
      titulo: "Twenty-seven tools, one developer",
      texto:
        "It edits your page node by node, searches the whole site for the detail it is about to change, picks photos and publishes. And it verifies every change by looking at it: a screenshot something describes, and a measurement that depends on no model at all.",
      como: "How it works →",
      grupos: {
        mirar: {
          titulo: "Look",
          nota: "1 tool · 2 modes",
          texto:
            "Measure, for free, in a real browser —pixel contrast, mobile overflow, JS errors— or describe the screenshot with vision when it’s needed. The mode is explicit, so cost never depends on how a sentence was phrased.",
        },
        leer: {
          titulo: "Read",
          texto: "The project’s real state, anything across the whole site, and the web pages you hand it.",
        },
        editar: {
          titulo: "Edit",
          texto: "Text, attributes, HTML and the page’s JavaScript, node by node; and undo its last change.",
        },
        disenar: {
          titulo: "Design and create",
          texto: "Theme, style, full redesign, new pages on the site and switching between them.",
        },
        fotos: { titulo: "Photos", texto: "Choose and edit images for your line of business." },
        datos: {
          titulo: "Data and modules",
          texto: "Turn on the chat — a real OpenLen module, not a painted form — and save, edit, remove or connect live data.",
        },
        contigo: {
          titulo: "With you",
          texto:
            "It asks when unsure, writes down its tasks, remembers your preferences, proposes goals, prepares your marketing and publishes.",
        },
      },
    },
    como: {
      antetitulo: "How it works",
      titulo: "Read, act, look, report.",
      pasos: [
        {
          k: "one",
          t: "Read",
          p: "The project’s real state — the document, the pages, the modules, whether it is published — not what it remembers from the chat.",
        },
        { k: "two", t: "Act", p: "It changes the exact node. It never rewrites the whole document to change a sentence." },
        {
          k: "three",
          t: "Look",
          p: "It renders in a real browser and measures: pixel contrast, mobile overflow, JS errors.",
        },
        { k: "four", t: "Report", p: "What happened, with the evidence. If it couldn’t, it says so — and what was missing." },
      ],
    },
    ultimo: { antetitulo: "Research", titulo: "Latest", todo: "All research" },
    principios: {
      antetitulo: "Principles",
      titulo: "What Len promises — and how we check",
      leer: "Read the principles",
      tres: [
        {
          k: "first",
          t: "Don’t lie",
          p: "Every claim rests on an observed result. If it didn’t look, it doesn’t say it’s fine.",
          estado: "vigilado",
          chip: "Guarded by its battery and a guard in the loop",
        },
        {
          k: "second",
          t: "Finish the job",
          p: "What you asked for is the deliverable. If it doesn’t fit, it says exactly what’s left.",
          estado: "medicion",
          chip: "Built, being measured",
        },
        {
          k: "third",
          t: "A condition someone else confirms",
          p: "The work isn’t done until a separate evaluator checks it. With a spending cap: when in doubt, it stops.",
          estado: "medicion",
          chip: "Built, being measured",
        },
      ],
    },
    disponible: {
      antetitulo: "Available today",
      titulo: "Len works inside OpenLen.",
      texto: "It’s the chat in the editor: open your page, tell it what you want, and it gets to work. In ten languages.",
      cta: "Try Len",
    },
    mision: {
      antetitulo: "Why",
      frase: ["A good website shouldn’t depend on ", "being able to afford one", "."],
    },
  },
};
