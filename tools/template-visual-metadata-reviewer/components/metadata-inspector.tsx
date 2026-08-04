import { useState } from "react";
import { TemplateVisualMetadataSchema, type TemplateVisualMetadata } from "../../../lib/templates/visual-metadata";
import type { SafeReviewItemDto } from "../api";

type ArrayField = {
  key: keyof Pick<TemplateVisualMetadata,
    "domains" | "audiences" | "ageRanges" | "emotionalRegisters" | "visualArchetypes" |
    "visualSignals" | "layoutTraits" | "requiredAssetTypes" | "supportedSiteTypes" |
    "supportedSectionRoles" | "negativeTags">;
  label: string;
};

const GROUPS: { title: string; fields: ArrayField[] }[] = [
  { title: "Domains and audiences", fields: [{ key: "domains", label: "Domains" }, { key: "audiences", label: "Audiences" }] },
  { title: "Age ranges and emotional registers", fields: [{ key: "ageRanges", label: "Age ranges" }, { key: "emotionalRegisters", label: "Emotional registers" }] },
  { title: "Visual archetypes and visual signals", fields: [{ key: "visualArchetypes", label: "Visual archetypes" }, { key: "visualSignals", label: "Visual signals" }] },
  { title: "Layout traits and required asset types", fields: [{ key: "layoutTraits", label: "Layout traits" }, { key: "requiredAssetTypes", label: "Required asset types" }] },
  { title: "Supported site types and section roles", fields: [{ key: "supportedSiteTypes", label: "Supported site types" }, { key: "supportedSectionRoles", label: "Supported section roles" }] },
  { title: "Negative tags", fields: [{ key: "negativeTags", label: "Negative tags" }] },
];

const SNAKE_CASE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

function ChipEditor({
  field,
  values,
  disabled,
  onCommit,
}: {
  field: ArrayField;
  values: string[];
  disabled: boolean;
  onCommit(field: string, value: string[]): Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const commit = async () => {
    const value = draft.trim();
    if (!SNAKE_CASE.test(value) || value.length > 64) {
      setError("Use lowercase snake_case (maximum 64 characters).");
      return;
    }
    setError("");
    if (values.includes(value) || await onCommit(field.key, [...values, value])) setDraft("");
  };
  return (
    <div className="field-editor">
      <span className="field-label">{field.label}</span>
      <div className="chips" aria-label={`${field.label} tags`}>
        {values.map((value) => (
          <span className="chip" key={value}>
            <code>{value}</code>
            <button
              type="button"
              aria-label={`Remove ${value} from ${field.label}`}
              disabled={disabled}
              onClick={() => void onCommit(field.key, values.filter((candidate) => candidate !== value))}
            >×</button>
          </span>
        ))}
      </div>
      <input
        aria-label={`Add ${field.label.toLocaleLowerCase()} tag`}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          }
        }}
        placeholder="add_snake_case"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${field.key}-error` : undefined}
      />
      {error && <small className="field-error" id={`${field.key}-error`} role="alert">{error}</small>}
    </div>
  );
}

interface MetadataInspectorProps {
  item: SafeReviewItemDto | null;
  approvalEnabled: boolean;
  busy: boolean;
  onCommit(field: string, value: unknown): Promise<boolean>;
  onApprove(): void;
  onReject(): void;
  onReopen(): void;
}

export function MetadataInspector({
  item,
  approvalEnabled,
  busy,
  onCommit,
  onApprove,
  onReject,
  onReopen,
}: MetadataInspectorProps) {
  const metadata = item?.metadata ?? null;
  const valid = metadata ? TemplateVisualMetadataSchema.safeParse(metadata).success : false;
  const editable = item?.state === "pending" && !busy;
  return (
    <aside className="metadata-inspector" tabIndex={-1} aria-label="Metadata inspector">
      <header className="inspector-header">
        <div>
          <span className="utility-label">Decision surface</span>
          <h2>Visual metadata</h2>
        </div>
        {item && <span className={`status status-${item.state}`}><span aria-hidden="true">●</span> {item.state}</span>}
      </header>

      {!item && <p className="empty-inspector">No item matches the current queue filters.</p>}
      {item?.state === "failed" && (
        <div className="failed-row" role="status">
          <strong>Typed failure</strong>
          <code>{item.failureKind ?? "unknown_failure"}</code>
          <p>This row cannot be approved or edited.</p>
        </div>
      )}
      {metadata && (
        <div className="metadata-groups">
          {GROUPS.map((group) => (
            <fieldset key={group.title} disabled={!editable}>
              <legend>{group.title}</legend>
              {group.fields.map((field) => (
                <ChipEditor
                  key={field.key}
                  field={field}
                  values={metadata[field.key]}
                  disabled={!editable}
                  onCommit={onCommit}
                />
              ))}
            </fieldset>
          ))}
          <fieldset disabled={!editable}>
            <legend>Themeability and identity strength</legend>
            {(["themeability", "identityStrength"] as const).map((field) => (
              <label className="scalar-field" key={field}>
                <span>{field === "themeability" ? "Themeability" : "Identity strength"}</span>
                <select
                  value={metadata[field]}
                  disabled={!editable}
                  onChange={(event) => void onCommit(field, event.currentTarget.value)}
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>
            ))}
            <div className="immutable-row">
              <span>Schema</span>
              <code>{metadata.schemaVersion}</code>
            </div>
          </fieldset>
        </div>
      )}

      <div className="decision-dock">
        {item && (item.state === "approved" || item.state === "rejected") ? (
          <button type="button" className="reopen-button" onClick={onReopen} disabled={busy}>
            Reopen decision
          </button>
        ) : (
          <>
            <button
              type="button"
              className="reject-button"
              data-action="reject"
              onClick={onReject}
              disabled={!editable || !metadata}
            >
              Reject <kbd>R</kbd>
            </button>
            <button
              type="button"
              className="approve-button"
              data-action="approve"
              onClick={onApprove}
              disabled={!editable || !approvalEnabled || !valid}
            >
              Approve <kbd>A</kbd>
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
