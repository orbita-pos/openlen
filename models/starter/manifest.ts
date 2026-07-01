// Starter pack — 3 CC-BY-4.0 GLBs from the Khronos glTF Sample Assets
// repository that ship in-repo so a fresh OpenLen deploy has models to
// show in the 3D panel immediately.
//
// To seed an instance: `npm run models:seed`. That uploads each GLB to
// object storage and inserts a row in `models`. After seed, add more via
// `npm run models:add`.
//
// Attribution: all three models are from the Khronos glTF Sample Assets
// repository (https://github.com/KhronosGroup/glTF-Sample-Assets) and are
// licensed under CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/).

import type { ModelFamily } from "@/lib/models/families";

export interface StarterModelEntry {
  id: string;
  name: string;
  family: ModelFamily;
  author: string;
  pitch: string;
  description: string;
  fileName: string;
  license: string;
}

export const STARTER_MODELS: StarterModelEntry[] = [
  {
    id: "damaged-helmet",
    name: "Damaged Helmet",
    family: "mechanical",
    author: "ctxwing — Khronos glTF Sample Assets (CC-BY-4.0)",
    pitch: "Casco battle-worn de ciencia ficción con materiales PBR de referencia.",
    description:
      "Casco de astronauta con daños de combate y materiales PBR de alta fidelidad. Referencia clásica del ecosistema glTF — ideal para páginas de tecnología, juegos o sci-fi.",
    fileName: "helmet.glb",
    license: "cc-by-4.0",
  },
  {
    id: "materials-shoe",
    name: "Materials Shoe",
    family: "product",
    author: "Shopify / Khronos glTF Sample Assets (CC-BY-4.0)",
    pitch: "Sneaker de exhibición para páginas de moda y e-commerce.",
    description:
      "Tenis de alto detalle con múltiples variantes de material, ideal para hero-shots de e-commerce, páginas de moda o demostraciones de producto 3D.",
    fileName: "shoe.glb",
    license: "cc-by-4.0",
  },
  {
    id: "antique-camera",
    name: "Antique Camera",
    family: "prop",
    author: "Max Limper / UX3D — Khronos glTF Sample Assets (CC-BY-4.0)",
    pitch: "Cámara retro de fuelle que transporta a la época analógica.",
    description:
      "Réplica de cámara de fuelle vintage con geometría detallada y materiales metálicos oxidados. Perfecta para estudios fotográficos, agencias creativas o blogs de fotografía.",
    fileName: "camera.glb",
    license: "cc-by-4.0",
  },
];
