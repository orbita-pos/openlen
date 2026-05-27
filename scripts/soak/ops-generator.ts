// Ops batch + parseOps envelope generators for the F1 shadow-soak synthetic
// load. Both helpers take already-known inputs and emit hand-crafted test
// shapes — zero AI calls, deterministic, repeatable.

import type { Op } from "@/lib/html-ops";

export interface OpBatch {
  /** Stable identifier — e.g. "single-replace", "cascade-parent-delete-child-replace". */
  name: string;
  /** Input HTML (already tagged via `tagWithOpIds`). */
  taggedHtml: string;
  ops: Op[];
}

function findOpIds(taggedHtml: string, max: number): string[] {
  const ids: string[] = [];
  const re = /data-op-id="([a-z0-9]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(taggedHtml)) !== null && ids.length < max) {
    ids.push(m[1]);
  }
  return ids;
}

export function generateOpBatches(taggedHtml: string): OpBatch[] {
  const ids = findOpIds(taggedHtml, 20);

  // Untagged-input edge cases — still useful for the validation path.
  if (ids.length === 0) {
    return [
      { name: "untagged:empty-ops", taggedHtml, ops: [] },
      {
        name: "untagged:invalid-target",
        taggedHtml,
        ops: [{ type: "replace", target: "zzz", newHtml: "<span>x</span>" }],
      },
    ];
  }

  const pick = (i: number): string => ids[Math.min(i, ids.length - 1)];
  const id0 = pick(0);
  const id1 = pick(1);
  const id2 = pick(2);
  const id3 = pick(3);
  const id4 = pick(4);
  const cascadeChild = pick(5);

  return [
    {
      name: "single-replace",
      taggedHtml,
      ops: [{ type: "replace", target: id0, newHtml: "<span>replaced</span>" }],
    },
    {
      name: "single-delete",
      taggedHtml,
      ops: [{ type: "delete", target: id0 }],
    },
    {
      name: "single-insert_before",
      taggedHtml,
      ops: [{ type: "insert_before", target: id0, newHtml: "<span>before</span>" }],
    },
    {
      name: "single-insert_after",
      taggedHtml,
      ops: [{ type: "insert_after", target: id0, newHtml: "<span>after</span>" }],
    },
    {
      name: "mixed-5-ops",
      taggedHtml,
      ops: [
        { type: "replace", target: id0, newHtml: "<span>r</span>" },
        { type: "insert_before", target: id1, newHtml: "<span>ib</span>" },
        { type: "insert_after", target: id2, newHtml: "<span>ia</span>" },
        { type: "delete", target: id3 },
        { type: "replace", target: id4, newHtml: "<span>r2</span>" },
      ],
    },
    {
      // S1 hierarchy-cascade carry-over: delete a likely ancestor (first id is
      // usually a body-level container), then replace a likely descendant.
      // Rust's appliedCount drifts here; html stays byte-equal via the custom
      // equalityFn in lib/html-ops.ts.
      name: "cascade-parent-delete-child-replace",
      taggedHtml,
      ops: [
        { type: "delete", target: id0 },
        { type: "replace", target: cascadeChild, newHtml: "<span>cascade-child</span>" },
      ],
    },
    {
      name: "invalid-op-id",
      taggedHtml,
      ops: [
        { type: "replace", target: "no-such-id-xyz-zzz", newHtml: "<span>x</span>" },
      ],
    },
    {
      name: "empty-ops",
      taggedHtml,
      ops: [],
    },
  ];
}

/** parseOps envelope variants. Input-independent — call once per soak run,
 *  not per-input. The envelopes cover: valid replace (explicit + natural
 *  forms), self-closing delete, multi-op, missing required attribute, unknown
 *  op type, no <edits> block, surrounding markdown fences, empty. */
export function generateOpsEnvelopes(): { name: string; envelope: string }[] {
  return [
    { name: "envelope:empty", envelope: "" },
    {
      name: "envelope:single-replace-explicit-new",
      envelope: `<edits><edit op="replace" target="a"><new><span>hi</span></new></edit></edits>`,
    },
    {
      name: "envelope:single-replace-natural",
      envelope: `<edits><edit op="replace" target="b"><span>hi</span></edit></edits>`,
    },
    {
      name: "envelope:self-closing-delete",
      envelope: `<edits><edit op="delete" target="c" /></edits>`,
    },
    {
      name: "envelope:multi-op",
      envelope: `<edits><edit op="replace" target="a"><span>r</span></edit><edit op="insert_before" target="b"><span>ib</span></edit><edit op="delete" target="c" /></edits>`,
    },
    {
      name: "envelope:missing-target-attr",
      envelope: `<edits><edit op="replace"><span>x</span></edit></edits>`,
    },
    {
      name: "envelope:unknown-op-type",
      envelope: `<edits><edit op="frobnicate" target="a"><span>x</span></edit></edits>`,
    },
    {
      name: "envelope:no-edits-block",
      envelope: `<!DOCTYPE html><html><body><p>Full doc instead of envelope</p></body></html>`,
    },
    {
      name: "envelope:markdown-fenced",
      envelope: "```html\n<edits><edit op=\"replace\" target=\"a\"><span>x</span></edit></edits>\n```",
    },
  ];
}
