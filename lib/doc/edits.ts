// Op builders — the intent→op layer between the editor UI and the algebra.
//
// §6 of docs/document-model.md calls for "intent-level builder functions that
// emit primitive ops." The inspector / canvas call a builder with a UI intent
// plus the current document; the builder encapsulates the fiddly part —
// computing `prev`, snapshotting a removed subtree, finding a node's position
// — and returns the typed `Op` (or `null` when the intent can't be expressed,
// e.g. removing the root). The op then goes through `dispatch` (editor.ts),
// which commits + schema-validates it.

import { cloneJson, createNode, deepEqual, mintId, subtreeIds } from "./model";
import type {
  ComponentDefinition,
  ComponentId,
  Condition,
  Document,
  Node,
  NodeId,
  Props,
  StyleProps,
} from "./model";
import { apply } from "./ops";
import type { Op } from "./ops";

// The Phase-3 editor edits the page tree; component bodies come later.
const TREE = "doc" as const;

/** Replace a node's props (Text runs, Link href, Image src/alt, …). */
export function editSetProps(
  doc: Document,
  id: NodeId,
  next: Props,
): Op | null {
  const node = doc.nodes[id];
  if (!node) return null;
  return {
    t: "set_props",
    tree: TREE,
    id,
    prev: cloneJson(node.props),
    next: cloneJson(next),
  };
}

/** Set a node's style for one condition layer (null = the base layer). `next`
 *  is the FULL props of that layer; an empty `next` removes a conditional
 *  layer. */
export function editSetStyle(
  doc: Document,
  id: NodeId,
  condition: Condition | null,
  next: StyleProps,
): Op | null {
  const node = doc.nodes[id];
  if (!node) return null;
  const prev =
    condition === null
      ? node.style.base
      : (node.style.layers.find((l) => deepEqual(l.condition, condition))
          ?.props ?? {});
  return {
    t: "set_style",
    tree: TREE,
    id,
    condition,
    prev: cloneJson(prev),
    next: cloneJson(next),
  };
}

/** Insert a fresh subtree under a parent at an index. `nodes` is the subtree
 *  keyed by id; its root is `rootId`. */
export function editInsert(
  doc: Document,
  parentId: NodeId,
  index: number,
  rootId: NodeId,
  nodes: Record<NodeId, Node>,
): Op | null {
  if (!doc.nodes[parentId] || !nodes[rootId]) return null;
  return {
    t: "insert_node",
    tree: TREE,
    parentId,
    index,
    rootId,
    nodes: cloneJson(nodes),
  };
}

/** Remove a node and its subtree. Returns null for the tree root or a missing
 *  node — the inverse-snapshot is captured here so undo is exact. */
export function editRemove(doc: Document, id: NodeId): Op | null {
  const node = doc.nodes[id];
  if (!node || node.parentId === null) return null;
  const parent = doc.nodes[node.parentId];
  if (!parent) return null;
  const index = parent.childIds.indexOf(id);
  const nodes: Record<NodeId, Node> = {};
  for (const x of subtreeIds(doc.nodes, id)) nodes[x] = cloneJson(doc.nodes[x]);
  return {
    t: "remove_node",
    tree: TREE,
    parentId: node.parentId,
    index,
    rootId: id,
    nodes,
  };
}

/** Reparent / reorder a node. `toIndex` is the index in the destination
 *  child-list AFTER the node is detached. Returns null for the root or a
 *  missing node. */
export function editMove(
  doc: Document,
  id: NodeId,
  toParentId: NodeId,
  toIndex: number,
): Op | null {
  const node = doc.nodes[id];
  if (!node || node.parentId === null) return null;
  const fromParent = doc.nodes[node.parentId];
  if (!fromParent || !doc.nodes[toParentId]) return null;
  return {
    t: "move_node",
    tree: TREE,
    id,
    fromParentId: node.parentId,
    fromIndex: fromParent.childIds.indexOf(id),
    toParentId,
    toIndex,
  };
}

/** Set a design token's value for a mode. Returns null when the token is
 *  absent (token definitions are managed elsewhere). */
export function editSetToken(
  doc: Document,
  tokenId: string,
  mode: string,
  value: string,
): Op | null {
  const def = doc.tokens.defs[tokenId];
  if (!def) return null;
  return {
    t: "set_token",
    tokenId,
    mode,
    prev: def.values[mode] ?? null,
    next: value,
  };
}

/**
 * Make a node into a reusable component: snapshot its subtree as a component
 * definition and replace the node in place with an `Instance` of it. Returns
 * the op sequence [define_component, remove_node, insert_node], or null for
 * the tree root / a missing node. (v1: no slots or per-instance overrides.)
 */
export function editDefineComponent(
  doc: Document,
  nodeId: NodeId,
  name: string,
): Op[] | null {
  const node = doc.nodes[nodeId];
  if (!node || node.parentId === null) return null;
  const parent = doc.nodes[node.parentId];
  if (!parent) return null;
  const index = parent.childIds.indexOf(nodeId);

  // Snapshot the subtree as the component body — its root detaches.
  const bodyNodes: Record<NodeId, Node> = {};
  for (const id of subtreeIds(doc.nodes, nodeId)) {
    const n = doc.nodes[id];
    if (n) bodyNodes[id] = cloneJson(n);
  }
  bodyNodes[nodeId] = { ...cloneJson(node), parentId: null };

  const componentId = mintId("cmp");
  const definition: ComponentDefinition = {
    id: componentId,
    name: name.trim() || "Component",
    props: [],
    slots: [],
    body: { root: nodeId, nodes: bodyNodes },
  };

  const remove = editRemove(doc, nodeId);
  if (!remove) return null;
  const instance = createNode("Instance", { componentId });
  const insert = editInsert(doc, node.parentId, index, instance.id, {
    [instance.id]: instance,
  });
  if (!insert) return null;

  return [
    { t: "define_component", componentId, prev: null, next: definition },
    remove,
    insert,
  ];
}

/**
 * Wrap N siblings (same parent) in a new Box, placed at the first one's
 * position. Children are moved into the Box in their on-screen order. Returns
 * the op sequence [insert_node, move_node, …] or null when the ids don't
 * share a parent, the root is included, or 0 ids are given. `ids.length === 1`
 * is a valid "wrap this single node in a box" intent.
 *
 * State must be threaded between builders because each move's `fromIndex`
 * depends on previous ops being applied — `editMove` snapshots the index at
 * builder time, and the parent's childIds shifts after each remove/insert.
 */
export function editGroup(doc: Document, ids: NodeId[]): Op[] | null {
  if (ids.length === 0) return null;
  const firstNode = doc.nodes[ids[0]];
  if (!firstNode || firstNode.parentId === null) return null;
  const parentId = firstNode.parentId;
  const parent = doc.nodes[parentId];
  if (!parent) return null;
  for (const id of ids) {
    const n = doc.nodes[id];
    if (!n || n.parentId !== parentId) return null;
  }

  // Preserve the visual order — the new Box's childIds should match the
  // on-screen sequence, not the click order.
  const orderedIds = [...ids].sort(
    (a, b) => parent.childIds.indexOf(a) - parent.childIds.indexOf(b),
  );
  const firstIdx = parent.childIds.indexOf(orderedIds[0]);
  const newBox = createNode("Box", {}, "div");

  const ops: Op[] = [];
  let current = doc;

  const insertOp = editInsert(current, parentId, firstIdx, newBox.id, {
    [newBox.id]: newBox,
  });
  if (!insertOp) return null;
  ops.push(insertOp);
  const r1 = apply(current, insertOp);
  if ("err" in r1) return null;
  current = r1.ok;

  for (let i = 0; i < orderedIds.length; i++) {
    const moveOp = editMove(current, orderedIds[i], newBox.id, i);
    if (!moveOp) return null;
    ops.push(moveOp);
    const r = apply(current, moveOp);
    if ("err" in r) return null;
    current = r.ok;
  }

  return ops;
}

/**
 * Inverse of editGroup: move a Box's children up to the grandparent at the
 * Box's position, then remove the now-empty Box. Null for the root, a missing
 * node, or a non-Box. Empty Boxes are simply removed.
 */
export function editUngroup(doc: Document, boxId: NodeId): Op[] | null {
  const box = doc.nodes[boxId];
  if (!box || box.parentId === null) return null;
  const parent = doc.nodes[box.parentId];
  if (!parent) return null;
  const boxIdx = parent.childIds.indexOf(boxId);
  if (boxIdx < 0) return null;

  if (box.childIds.length === 0) {
    const op = editRemove(doc, boxId);
    return op ? [op] : null;
  }

  const childIds = [...box.childIds];
  const ops: Op[] = [];
  let current = doc;

  for (let i = 0; i < childIds.length; i++) {
    const moveOp = editMove(current, childIds[i], parent.id, boxIdx + i);
    if (!moveOp) return null;
    ops.push(moveOp);
    const r = apply(current, moveOp);
    if ("err" in r) return null;
    current = r.ok;
  }

  const removeOp = editRemove(current, boxId);
  if (!removeOp) return null;
  ops.push(removeOp);

  return ops;
}

/**
 * Deep-clone a subtree under fresh ids. Used by editDuplicate so the new
 * copies don't collide with the originals.
 */
function cloneSubtreeWithFreshIds(
  nodes: Record<NodeId, Node>,
  rootId: NodeId,
): { rootId: NodeId; nodes: Record<NodeId, Node> } | null {
  const ids = subtreeIds(nodes, rootId);
  if (ids.length === 0) return null;
  const idMap = new Map<NodeId, NodeId>();
  for (const oldId of ids) idMap.set(oldId, mintId());
  const out: Record<NodeId, Node> = {};
  for (const oldId of ids) {
    const orig = nodes[oldId];
    if (!orig) continue;
    const newId = idMap.get(oldId)!;
    const remappedParent =
      orig.parentId && idMap.has(orig.parentId)
        ? idMap.get(orig.parentId)!
        : null;
    out[newId] = {
      ...cloneJson(orig),
      id: newId,
      parentId: remappedParent,
      childIds: orig.childIds.map((c) => idMap.get(c) ?? c),
    };
  }
  return { rootId: idMap.get(rootId)!, nodes: out };
}

/**
 * Duplicate one or more nodes — each clone lands right after its original in
 * the same parent. Threads state because each insert shifts later positions;
 * processed in given order against the live current state.
 *
 * Returns the op sequence plus the new root ids (in input order) so the
 * caller can update the selection to point at the duplicates.
 * Null for any id that is missing, is the root, or fails to clone.
 */
export function editDuplicate(
  doc: Document,
  ids: NodeId[],
): { ops: Op[]; newIds: NodeId[] } | null {
  if (ids.length === 0) return null;
  for (const id of ids) {
    const n = doc.nodes[id];
    if (!n || n.parentId === null) return null;
  }
  const ops: Op[] = [];
  const newIds: NodeId[] = [];
  let current = doc;
  for (const id of ids) {
    const node = current.nodes[id];
    if (!node || node.parentId === null) return null;
    const parent = current.nodes[node.parentId];
    if (!parent) return null;
    const idx = parent.childIds.indexOf(id);
    if (idx < 0) return null;
    const cloned = cloneSubtreeWithFreshIds(current.nodes, id);
    if (!cloned) return null;
    const insertOp = editInsert(
      current,
      node.parentId,
      idx + 1,
      cloned.rootId,
      cloned.nodes,
    );
    if (!insertOp) return null;
    ops.push(insertOp);
    newIds.push(cloned.rootId);
    const r = apply(current, insertOp);
    if ("err" in r) return null;
    current = r.ok;
  }
  return { ops, newIds };
}

/**
 * Add a new named breakpoint to the document. Sorted by minWidth so the
 * inspector's chip strip reads narrow → wide left to right. Returns null
 * for an empty/duplicate name. Emits a `set_doc` op with prev/next.
 */
export function editAddBreakpoint(
  doc: Document,
  name: string,
  minWidth: number,
): Op | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (!Number.isFinite(minWidth) || minWidth < 0) return null;
  if (doc.breakpoints.some((b) => b.name === trimmed)) return null;
  const next = [...doc.breakpoints, { name: trimmed, minWidth }].sort(
    (a, b) => a.minWidth - b.minWidth,
  );
  return {
    t: "set_doc",
    prev: { breakpoints: doc.breakpoints },
    next: { breakpoints: next },
  };
}

/** Insert an `Instance` of an existing component. Null when the component or
 *  the destination parent is missing. */
export function editInstantiate(
  doc: Document,
  componentId: ComponentId,
  parentId: NodeId,
  index: number,
): Op | null {
  if (!doc.components[componentId] || !doc.nodes[parentId]) return null;
  const instance = createNode("Instance", { componentId });
  return editInsert(doc, parentId, index, instance.id, {
    [instance.id]: instance,
  });
}
