// Curated section templates for the Canva-mode "+ Agregar sección" picker.
// Each template is a `NodeSpec` subtree that buildSubtree turns into a node
// map, which editInsert splices under the root Page. Styles use var()
// references so they inherit the page's tokens (paleta/font/etc.) — picking
// a section into a Coral palette gives a coral-tinted hero, not a generic one.
//
// Keep these spare. The user picks a shape; AI inline / Chat can refine.

import {
  DollarSign,
  HelpCircle,
  LayoutGrid,
  LayoutTemplate,
  MessageSquareQuote,
  MousePointerClick,
  PanelBottom,
  SquarePlus,
  type LucideIcon,
} from "lucide-react";
import type { NodeSpec } from "./doc/build";

export interface SectionTemplate {
  id: string;
  name: string;
  hint: string;
  /** Lucide icon used as the visual cue in the picker + library rail. */
  Icon: LucideIcon;
  spec: NodeSpec;
}

const heroSpec: NodeSpec = {
  type: "Box",
  tag: "section",
  props: {},
  style: {
    base: {
      padding: "96px 32px",
      "text-align": "center",
      "max-width": "880px",
      margin: "0 auto",
    },
  },
  children: [
    {
      type: "Text",
      tag: "h1",
      props: { runs: [{ text: "Tu titular principal acá" }] },
      style: {
        base: {
          "font-size": "56px",
          "line-height": "1.05",
          "letter-spacing": "-0.02em",
          "font-weight": "700",
          margin: "0 0 16px",
          "font-family": "var(--font-display)",
        },
      },
      children: [],
    },
    {
      type: "Text",
      tag: "p",
      props: {
        runs: [
          {
            text: "Una línea que explique qué hacés y por qué importa. Cambiala.",
          },
        ],
      },
      style: {
        base: {
          "font-size": "18px",
          "line-height": "1.5",
          "max-width": "560px",
          margin: "0 auto 28px",
          opacity: "0.75",
        },
      },
      children: [],
    },
    {
      type: "Button",
      tag: "a",
      props: { href: "#" },
      style: {
        base: {
          display: "inline-flex",
          "background-color": "var(--accent)",
          color: "#ffffff",
          padding: "12px 22px",
          "border-radius": "10px",
          "font-weight": "600",
          "text-decoration": "none",
        },
      },
      children: [
        {
          type: "Text",
          tag: "span",
          props: { runs: [{ text: "Empezá ahora" }] },
          style: { base: {} },
          children: [],
        },
      ],
    },
  ],
};

const featuresSpec: NodeSpec = {
  type: "Box",
  tag: "section",
  props: {},
  style: {
    base: {
      padding: "64px 32px",
      "max-width": "1080px",
      margin: "0 auto",
      display: "grid",
      "grid-template-columns": "repeat(3, 1fr)",
      gap: "24px",
    },
  },
  children: [1, 2, 3].map((i): NodeSpec => ({
    type: "Box" as const,
    tag: "div",
    props: {},
    style: {
      base: {
        "background-color": "var(--surface)",
        padding: "28px",
        "border-radius": "14px",
        border: "1px solid var(--border)",
      },
    },
    children: [
      {
        type: "Text" as const,
        tag: "h3",
        props: { runs: [{ text: `Feature ${i}` }] },
        style: {
          base: { "font-size": "18px", "font-weight": "600", margin: "0 0 8px" },
        },
        children: [],
      },
      {
        type: "Text" as const,
        tag: "p",
        props: {
          runs: [{ text: "Describe esta funcionalidad en una o dos líneas." }],
        },
        style: {
          base: {
            "font-size": "14px",
            "line-height": "1.6",
            opacity: "0.75",
            margin: "0",
          },
        },
        children: [],
      },
    ],
  })),
};

const ctaSpec: NodeSpec = {
  type: "Box",
  tag: "section",
  props: {},
  style: {
    base: {
      padding: "80px 32px",
      "text-align": "center",
      "background-color": "var(--surface)",
      "border-radius": "16px",
      margin: "32px",
    },
  },
  children: [
    {
      type: "Text",
      tag: "h2",
      props: { runs: [{ text: "Listo para arrancar?" }] },
      style: {
        base: {
          "font-size": "32px",
          "font-weight": "700",
          margin: "0 0 16px",
        },
      },
      children: [],
    },
    {
      type: "Button",
      tag: "a",
      props: { href: "#" },
      style: {
        base: {
          display: "inline-flex",
          "background-color": "var(--accent)",
          color: "#ffffff",
          padding: "12px 22px",
          "border-radius": "10px",
          "font-weight": "600",
          "text-decoration": "none",
        },
      },
      children: [
        {
          type: "Text",
          tag: "span",
          props: { runs: [{ text: "Sí, vamos" }] },
          style: { base: {} },
          children: [],
        },
      ],
    },
  ],
};

const testimonialsSpec: NodeSpec = {
  type: "Box",
  tag: "section",
  props: {},
  style: {
    base: {
      padding: "64px 32px",
      "max-width": "1080px",
      margin: "0 auto",
      display: "grid",
      "grid-template-columns": "repeat(3, 1fr)",
      gap: "24px",
    },
  },
  children: [1, 2, 3].map((i): NodeSpec => ({
    type: "Box" as const,
    tag: "div",
    props: {},
    style: {
      base: {
        "background-color": "var(--surface)",
        padding: "28px",
        "border-radius": "14px",
        border: "1px solid var(--border)",
      },
    },
    children: [
      {
        type: "Text" as const,
        tag: "p",
        props: {
          runs: [
            { text: '"Cambiá esta cita por una real de un cliente feliz."' },
          ],
        },
        style: {
          base: {
            "font-size": "15px",
            "line-height": "1.6",
            margin: "0 0 16px",
            "font-style": "italic",
          },
        },
        children: [],
      },
      {
        type: "Text" as const,
        tag: "span",
        props: { runs: [{ text: `Nombre del cliente ${i}` }] },
        style: {
          base: { "font-size": "13px", "font-weight": "600", opacity: "0.8" },
        },
        children: [],
      },
    ],
  })),
};

const pricingSpec: NodeSpec = {
  type: "Box",
  tag: "section",
  props: {},
  style: {
    base: {
      padding: "64px 32px",
      "max-width": "1080px",
      margin: "0 auto",
      display: "grid",
      "grid-template-columns": "repeat(3, 1fr)",
      gap: "24px",
    },
  },
  children: ["Free", "Pro", "Team"].map((name, i): NodeSpec => ({
    type: "Box" as const,
    tag: "div",
    props: {},
    style: {
      base: {
        "background-color": "var(--surface)",
        padding: "32px",
        "border-radius": "14px",
        border: i === 1 ? "2px solid var(--accent)" : "1px solid var(--border)",
        "text-align": "center",
      },
    },
    children: [
      {
        type: "Text" as const,
        tag: "h3",
        props: { runs: [{ text: name }] },
        style: {
          base: { "font-size": "18px", "font-weight": "600", margin: "0 0 8px" },
        },
        children: [],
      },
      {
        type: "Text" as const,
        tag: "p",
        props: { runs: [{ text: `$${i * 19}` }] },
        style: {
          base: {
            "font-size": "40px",
            "font-weight": "700",
            margin: "0 0 16px",
          },
        },
        children: [],
      },
      {
        type: "Button" as const,
        tag: "a",
        props: { href: "#" },
        style: {
          base: {
            display: "inline-flex",
            "background-color":
              i === 1 ? "var(--accent)" : "var(--surface)",
            color: i === 1 ? "#ffffff" : "var(--fg)",
            padding: "10px 20px",
            "border-radius": "8px",
            "font-weight": "600",
            "text-decoration": "none",
            border: i === 1 ? "none" : "1px solid var(--border)",
          },
        },
        children: [
          {
            type: "Text" as const,
            tag: "span",
            props: { runs: [{ text: "Elegir" }] },
            style: { base: {} },
            children: [],
          },
        ],
      },
    ],
  })),
};

const faqSpec: NodeSpec = {
  type: "Box",
  tag: "section",
  props: {},
  style: {
    base: {
      padding: "64px 32px",
      "max-width": "720px",
      margin: "0 auto",
    },
  },
  children: [
    {
      type: "Text",
      tag: "h2",
      props: { runs: [{ text: "Preguntas frecuentes" }] },
      style: {
        base: {
          "font-size": "28px",
          "font-weight": "700",
          margin: "0 0 32px",
          "text-align": "center",
        },
      },
      children: [],
    },
    ...[1, 2, 3].map((i): NodeSpec => ({
      type: "Box" as const,
      tag: "div",
      props: {},
      style: {
        base: {
          padding: "20px 0",
          "border-bottom": "1px solid var(--border)",
        },
      },
      children: [
        {
          type: "Text" as const,
          tag: "h3",
          props: { runs: [{ text: `Pregunta ${i}` }] },
          style: {
            base: {
              "font-size": "16px",
              "font-weight": "600",
              margin: "0 0 8px",
            },
          },
          children: [],
        },
        {
          type: "Text" as const,
          tag: "p",
          props: {
            runs: [
              {
                text: "La respuesta a esta pregunta va acá. Editá el texto haciendo click.",
              },
            ],
          },
          style: {
            base: {
              "font-size": "14px",
              "line-height": "1.6",
              opacity: "0.75",
              margin: "0",
            },
          },
          children: [],
        },
      ],
    })),
  ],
};

const footerSpec: NodeSpec = {
  type: "Box",
  tag: "footer",
  props: {},
  style: {
    base: {
      padding: "32px",
      "text-align": "center",
      "border-top": "1px solid var(--border)",
      "font-size": "13px",
      opacity: "0.6",
    },
  },
  children: [
    {
      type: "Text",
      tag: "span",
      props: { runs: [{ text: "© Tu marca 2026" }] },
      style: { base: {} },
      children: [],
    },
  ],
};

const blankSpec: NodeSpec = {
  type: "Box",
  tag: "section",
  props: {},
  style: {
    base: {
      padding: "64px 32px",
      "min-height": "200px",
      border: "1px dashed var(--border)",
      "text-align": "center",
      color: "var(--fg)",
      opacity: "0.5",
    },
  },
  children: [
    {
      type: "Text",
      tag: "p",
      props: { runs: [{ text: "Sección vacía — agregale elementos" }] },
      style: { base: { "font-size": "13px", margin: "0" } },
      children: [],
    },
  ],
};

export const SECTION_TEMPLATES: SectionTemplate[] = [
  { id: "hero", name: "Hero", hint: "Titular grande + subtitle + CTA", Icon: LayoutTemplate, spec: heroSpec },
  { id: "features", name: "Features", hint: "3 cards en grid", Icon: LayoutGrid, spec: featuresSpec },
  { id: "testimonials", name: "Testimonials", hint: "3 quote cards", Icon: MessageSquareQuote, spec: testimonialsSpec },
  { id: "pricing", name: "Pricing", hint: "3 planes (middle highlighted)", Icon: DollarSign, spec: pricingSpec },
  { id: "cta", name: "CTA", hint: "Llamado a la acción centrado", Icon: MousePointerClick, spec: ctaSpec },
  { id: "faq", name: "FAQ", hint: "Preguntas frecuentes", Icon: HelpCircle, spec: faqSpec },
  { id: "footer", name: "Footer", hint: "Pie de página simple", Icon: PanelBottom, spec: footerSpec },
  { id: "blank", name: "En blanco", hint: "Contenedor vacío para armar", Icon: SquarePlus, spec: blankSpec },
];
