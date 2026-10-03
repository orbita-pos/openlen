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
      titulo: "Len 2.0",
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
      antetitulo: "Len 1.5 → Len 2.0",
      titulo: "What changed since 1.5, measured.",
      leer: "How we measured it",
      items: [
        {
          valor: "50 → 83 %",
          texto: "on the requests 1.5 didn’t get right: 12 requests, three runs each, both versions on the same night and with the same model",
          commit: "b5d12836",
        },
        {
          valor: "82 → 96 %",
          texto: "on 15 sealed requests nobody saw while 2.0 was being built, graded with the same criteria for both versions",
          commit: "b5d12836",
        },
      ],
      nota: "With 12 and 15 requests the margin is wide: ±39 and ±17 points. On the 19 that 1.5 already got right, 2.0 doesn’t get worse (98 %, counting fixes we didn’t measure again) and it costs less per request. And one failure it still has: when a detail is missing, it sometimes fills in with made-up reviews.",
      notaCommit: "b5d12836",
    },
    tarjeta: {
      antetitulo: "Len · October 2026",
      titulo: "Nineteen tools, one developer",
      texto:
        "It works on your site the way a programmer works on code: every page is a file it reads, searches and changes precisely. And before handing it over, it uses the page the way a visitor would: it clicks, types, reloads and looks at what happened.",
      como: "How it works →",
      grupos: {
        mirar: {
          titulo: "Look and use",
          texto:
            "It measures the page in a real browser —pixel contrast, mobile overflow, JS errors— and uses it like a visitor: it clicks buttons, fills in forms and reloads to see what changed.",
        },
        leer: {
          titulo: "Read and search",
          texto:
            "Every page is a file: it reads it and searches the whole site for the detail it is about to change. And what is published somewhere else —opening hours, a price— it looks up and reads on the web.",
        },
        editar: {
          titulo: "Write",
          texto: "It changes the exact text that needs changing, writes whole new pages and undoes its last change.",
        },
        fotos: { titulo: "Photos", texto: "Choose and edit images for your line of business." },
        datos: {
          titulo: "Data and modules",
          texto:
            "It turns on the chat — a real OpenLen module, not a painted form. What your page stores —a catalog, some reviews, some orders— lives in data files that survive a reload.",
        },
        resultados: {
          titulo: "Your results",
          texto:
            "It tells you how many visits your page had and where they came from, reads the forms and messages people leave you, and drafts the reply: you send it.",
        },
        contigo: {
          titulo: "With you",
          texto: "It asks you for the detail it’s missing instead of making it up, and publishes when you confirm.",
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
          p: "The project’s real state — the pages, their data, the modules, whether it is published — not what it remembers from the chat.",
        },
        { k: "two", t: "Act", p: "It changes the exact text. It never rewrites a whole page to change a sentence." },
        {
          k: "three",
          t: "Look",
          p: "It renders in a real browser and measures —pixel contrast, mobile overflow, JS errors— and uses the page like a visitor.",
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
