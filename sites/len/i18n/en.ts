import type { Diccionario } from "./index";

export const en: Diccionario = {
  htmlLang: "en",
  meta: {
    title: "Len — an agent that shows its work",
    description: "Len builds and edits your page, and looks at it before saying “done”.",
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
    antetitulo: "OpenLen · The agent",
    titular: ["An agent that ", "shows", " its work."],
    parrafo:
      "Len builds and edits your page, and before it says “done” it looks: it renders the result, measures contrast pixel by pixel, and tells you what happened — including when something fails.",
    altCielo: "A painted dawn sky with a thin coral ring of light among the clouds.",
    cielo: {
      titulo: "Len 1.0",
      texto: "The agent that builds your page, looks at it, and tells you what it saw.",
      cta: "How it works →",
    },
    tarjeta: {
      antetitulo: "Len · September 2026",
      titulo: "Twenty-seven tools and two eyes",
      texto:
        "It edits your page node by node, knows your business, finds photos and publishes. And it verifies every change by looking at it: a screenshot something describes, and a measurement that depends on no model at all.",
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
          texto: "Turn on real OpenLen modules, and save, edit, remove or connect live data.",
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
        { k: "one", t: "Read", p: "The real state of the page and your business — not what it remembers from the chat." },
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
          chip: "Guarded by two cases in its battery",
        },
        {
          k: "second",
          t: "Finish the job",
          p: "What you asked for is the deliverable. If it doesn’t fit, it says exactly what’s left.",
          estado: "construccion",
          chip: "In progress",
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
    mision: {
      antetitulo: "Why",
      frase: ["A page that ", "lies", " is worse than an unfinished one. Len is built to tell you the truth."],
    },
  },
};
