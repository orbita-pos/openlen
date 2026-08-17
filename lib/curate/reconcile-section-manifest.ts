import { parse } from "node-html-parser";

import { sha256 } from "@/lib/generation/content-hash";

const ROLE_ATTRIBUTE = "data-openlen-role";
const ID_ATTRIBUTE = "data-sec";
const EDIT_ID = "data-openlen-edit-id";

const ROW_KEYS = [
  "orderedRoles",
  "selectedSectionIds",
  "selectedContentHashes",
  "selectedSourceKinds",
  "selectedSourceTemplateIds",
  "selectedSourceBandOrdinals",
  "selectedStructuralFingerprints",
  "compatibilityRuleIds",
] as const;

interface Row {
  role: string;
  sectionId: string;
  contentHash: string;
  sourceKind: string;
  sourceTemplateId: string | null;
  sourceBandOrdinal: number | null;
  structuralFingerprint: string;
  compatibilityRuleId: string;
}

/**
 * Deja el manifiesto diciendo la verdad sobre el documento que se va a entregar.
 *
 * La puerta de entrega compara los nodos `[data-openlen-role]` contra el
 * manifiesto sellado al componer: mismo número, mismo orden, mismo `data-sec`.
 * De las herramientas del modelo, `replace_section` hereda la identidad del
 * original y sobrevive — pero `insert_section`, `remove_section` y
 * `move_section` cambian esa lista y NADIE actualizaba el manifiesto, así que
 * la puerta refusaba la página entera y entregaba la baseline. Reportado como
 * `delivered`. Medido: 3 de 10 páginas.
 *
 * Se reconstruye desde el DOM en vez de llevar la cuenta operación por
 * operación: el documento es la única fuente que no puede desincronizarse, y
 * así da igual en qué orden llegaron los parches.
 *
 * La procedencia de una sección del catálogo se CONSERVA —es lo que prueba que
 * la página no clonó una plantilla—; una sección que escribió el modelo entra
 * como `generated`, que es lo que el contrato ya tenía previsto para ella.
 */
export function reconcileSectionManifest<T extends Record<string, unknown>>(
  manifest: T,
  html: string,
): T {
  const previous = readRows(manifest);
  if (previous === null) return manifest;
  const byId = new Map(previous.map((row) => [row.sectionId, row]));

  const document = parse(html);
  const nodes = document.querySelectorAll(`[${ROLE_ATTRIBUTE}]`);
  const rows: Row[] = [];
  for (const node of nodes) {
    const role = node.getAttribute(ROLE_ATTRIBUTE) ?? "";
    if (!role) continue;
    const sectionId = node.getAttribute(ID_ATTRIBUTE) ?? node.getAttribute(EDIT_ID) ?? "";
    if (!sectionId) continue;
    const carried = byId.get(sectionId);
    // El rol viene del documento aunque la fila sea vieja: mover una sección no
    // cambia de dónde salió, pero sí puede cambiar lo que es.
    rows.push(carried ? { ...carried, role } : generatedRow(sectionId, role, node.toString()));
  }
  if (rows.length === 0) return manifest;

  return {
    ...manifest,
    orderedRoles: rows.map((row) => row.role),
    selectedSectionIds: rows.map((row) => row.sectionId),
    selectedContentHashes: rows.map((row) => row.contentHash),
    selectedSourceKinds: rows.map((row) => row.sourceKind),
    selectedSourceTemplateIds: rows.map((row) => row.sourceTemplateId),
    selectedSourceBandOrdinals: rows.map((row) => row.sourceBandOrdinal),
    selectedStructuralFingerprints: rows.map((row) => row.structuralFingerprint),
    compatibilityRuleIds: rows.map((row) => row.compatibilityRuleId),
  };
}

/** Cuántas secciones lleva el documento — el mínimo que la prueba de
 *  originalidad exige es 3, y quitar la cuarta es perder la página entera. */
export function sectionCount(html: string): number {
  return parse(html).querySelectorAll(`[${ROLE_ATTRIBUTE}]`).length;
}

function generatedRow(sectionId: string, role: string, markup: string): Row {
  const digest = sha256(markup);
  return {
    role,
    sectionId,
    contentHash: digest.slice("sha256:".length, "sha256:".length + 12),
    // Lo escribió el modelo: no viene de ninguna plantilla y no puede
    // reclamar procedencia de ninguna.
    sourceKind: "generated",
    sourceTemplateId: null,
    sourceBandOrdinal: null,
    structuralFingerprint: digest,
    compatibilityRuleId: `section_component:${role}`,
  };
}

function readRows(manifest: Record<string, unknown>): Row[] | null {
  const columns = ROW_KEYS.map((key) => manifest[key]);
  if (columns.some((column) => !Array.isArray(column))) return null;
  const [roles, ids, hashes, kinds, templates, ordinals, fingerprints, rules] = columns as unknown[][];
  const length = roles.length;
  if (columns.some((column) => (column as unknown[]).length !== length)) return null;
  return Array.from({ length }, (_unused, index) => ({
    role: String(roles[index]),
    sectionId: String(ids[index]),
    contentHash: String(hashes[index]),
    sourceKind: String(kinds[index]),
    sourceTemplateId: (templates[index] ?? null) as string | null,
    sourceBandOrdinal: (ordinals[index] ?? null) as number | null,
    structuralFingerprint: String(fingerprints[index]),
    compatibilityRuleId: String(rules[index]),
  }));
}
