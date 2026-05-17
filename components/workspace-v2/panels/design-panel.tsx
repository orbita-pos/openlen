// Design mode panel — background presets, palette swatches, typography
// systems, density / radius / decoration intensity. All knobs hot-swap the
// preview iframe via the design state in the page shell.

"use client";

import { useMemo, useRef, useState, type ComponentType } from "react";
import type { LayoutPreset } from "@/lib/design/demo-slots";
import { LayoutWireframe } from "../layout-wireframes";
import {
  Check,
  ChevronDown,
  ChevronUp,
  type IconProps,
  ImageIcon,
  Layers,
  PaletteIcon,
  Plus,
  Rows,
  Sparkles,
  SquareDashed,
  Type,
  X,
} from "../icons";
import {
  BG_PRESETS,
  DECORATION_OPTS,
  DENSITY_OPTS,
  LAYOUT_PRESETS,
  PALETTES,
  RADIUS_OPTS,
  TYPE_SYSTEMS,
  makeSectionId,
  type DecorationValue,
  type DensityValue,
  type DesignState,
  type Palette,
  type RadiusValue,
  type SectionInstance,
  type TypeSystem,
} from "../mock-data";
import { BgThumb } from "../thumbs";

interface DesignSectionProps {
  label: string;
  icon: ComponentType<IconProps>;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function DesignSection({
  label,
  icon: Icon,
  defaultOpen = true,
  children,
}: DesignSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b bd">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full px-3 h-9 hover:bg-hover transition"
      >
        <span className="inline-flex items-center gap-2">
          <Icon size={12} className="fg-faint" />
          <span className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
            {label}
          </span>
        </span>
        <ChevronDown
          size={13}
          className={`fg-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="px-3 pb-3 fade-in">{children}</div>}
    </div>
  );
}

interface HslSliderProps {
  hue: number;
  onChange: (h: number) => void;
}

function HslSlider({ hue, onChange }: HslSliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    onChange(Math.round((x / r.width) * 360));
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10.5px] fg-muted ui-small">Custom hue</span>
        <span className="text-[10px] font-mono fg-faint tabular">{hue}°</span>
      </div>
      <div
        ref={ref}
        onMouseDown={move}
        className="relative h-3 rounded-full cursor-pointer overflow-visible"
        style={{
          background:
            "linear-gradient(90deg, oklch(72% 0.18 0), oklch(72% 0.18 60), oklch(72% 0.18 120), oklch(72% 0.18 180), oklch(72% 0.18 240), oklch(72% 0.18 300), oklch(72% 0.18 360))",
        }}
      >
        <span
          style={{ left: `${(hue / 360) * 100}%` }}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-4 rounded-full bg-white shadow-md border-2"
          aria-hidden
        />
      </div>
    </div>
  );
}

interface PaletteSwatchProps {
  palette: Palette;
  active: boolean;
  onClick: () => void;
}

function PaletteSwatch({ palette, active, onClick }: PaletteSwatchProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Hue ${palette.hue}° · ${palette.mode}`}
      className={`relative w-full rounded-md overflow-hidden transition ${
        active
          ? "ring-accent preset-pop"
          : "ring-1 ring-[color:var(--border)] hover:ring-[color:var(--border-strong)]"
      }`}
    >
      <div
        className="relative w-full"
        style={{ aspectRatio: "16 / 9", background: palette.swatch[0] }}
      >
        <div className="absolute inset-0 flex items-end gap-0 p-1.5">
          {palette.swatch.slice(1).map((c, i) => (
            <span
              key={i}
              className="block flex-1 h-3 first:rounded-l-sm last:rounded-r-sm"
              style={{ background: c }}
            />
          ))}
        </div>
        <span
          className="absolute top-1 left-1.5 text-[8.5px] font-mono tabular-nums"
          style={{ color: palette.mode === "dark" ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.45)" }}
        >
          h{palette.hue}
        </span>
        {active && (
          <span className="absolute top-1 right-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-sm">
            <Check size={9} stroke={3} />
          </span>
        )}
      </div>
    </button>
  );
}

interface TypeCardProps {
  system: TypeSystem;
  active: boolean;
  onClick: () => void;
}

function TypeCard({ system, active, onClick }: TypeCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full flex items-center gap-3 h-16 px-3 rounded-md transition text-left ${
        active
          ? "bg-accent-soft border-l-[3px] border-[var(--accent)]"
          : "border-l-[3px] border-transparent hover:bg-hover"
      }`}
    >
      <span
        className="shrink-0 grid place-items-center w-12 h-10 rounded fg"
        style={{
          fontFamily: system.family,
          fontSize: `${system.sampleSize}px`,
          fontWeight: system.weight,
          letterSpacing: system.tracking,
          lineHeight: 1,
        }}
      >
        Aa
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium fg truncate">
          {system.label}
        </div>
        <div className="text-[10.5px] fg-faint font-mono truncate">
          {system.family.split(",")[0].replace(/'/g, "")}
        </div>
      </div>
      {active && <Check size={13} className="text-accent shrink-0" />}
    </button>
  );
}

function TickDiagram({ variant }: { variant: DensityValue }) {
  const gap = { compact: 2, standard: 4, spacious: 6 }[variant];
  return (
    <div className="inline-flex flex-col py-1" style={{ gap }}>
      {[6, 14, 10].map((w, i) => (
        <span
          key={i}
          className="block h-[2px] rounded-sm bg-current"
          style={{ width: w }}
        />
      ))}
    </div>
  );
}

function RadiusDiagram({ variant }: { variant: RadiusValue }) {
  const r = { sharp: 1, soft: 4, pill: 8 }[variant];
  return (
    <span
      className="inline-block h-3 w-5 border-2 border-current"
      style={{ borderRadius: r }}
    />
  );
}

interface SegmentedDiagramProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  getDiagram: (v: T) => React.ReactNode;
}

function SegmentedDiagram<T extends string>({
  value,
  onChange,
  options,
  getDiagram,
}: SegmentedDiagramProps<T>) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`group flex flex-col items-center justify-center h-12 rounded-md border transition ${
              active
                ? "border-[var(--accent)] bg-accent-soft text-accent"
                : "bd hover:bg-hover fg-muted"
            }`}
          >
            {getDiagram(o.value)}
            <span className="mt-1 text-[10.5px] font-medium ui-small">
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface DecorationSliderProps {
  value: DecorationValue;
  onChange: (v: DecorationValue) => void;
  options: ReadonlyArray<{ value: DecorationValue; label: string }>;
}

function DecorationSlider({ value, onChange, options }: DecorationSliderProps) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {options.map((o, i) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`group relative flex flex-col items-center justify-end h-16 rounded-md border overflow-hidden transition ${
              active
                ? "border-[var(--accent)] bg-accent-soft text-accent"
                : "bd hover:bg-hover hover:border-[color:var(--border-strong)] fg-muted"
            }`}
          >
            <svg
              viewBox="0 0 60 40"
              className="absolute inset-x-0 top-1.5 mx-auto w-3/4 h-7"
              preserveAspectRatio="none"
              aria-hidden
            >
              {i === 0 && (
                <path
                  d="M5 30 Q30 22 55 30"
                  stroke="currentColor"
                  strokeWidth="1"
                  fill="none"
                  opacity="0.5"
                />
              )}
              {i === 1 && (
                <>
                  <path
                    d="M0 28 Q15 18 30 24 T60 22"
                    stroke="currentColor"
                    strokeWidth="1"
                    fill="none"
                    opacity="0.7"
                  />
                  <path
                    d="M0 35 Q20 30 35 32 T60 30"
                    stroke="currentColor"
                    strokeWidth="1"
                    fill="none"
                    opacity="0.4"
                  />
                </>
              )}
              {i === 2 && (
                <>
                  <ellipse
                    cx="20"
                    cy="22"
                    rx="14"
                    ry="10"
                    fill="currentColor"
                    opacity="0.18"
                  />
                  <ellipse
                    cx="42"
                    cy="20"
                    rx="12"
                    ry="8"
                    fill="currentColor"
                    opacity="0.22"
                  />
                  <path
                    d="M0 32 Q15 22 30 28 T60 24"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    fill="none"
                    opacity="0.8"
                  />
                  <path
                    d="M0 38 Q20 32 35 35 T60 32"
                    stroke="currentColor"
                    strokeWidth="1"
                    fill="none"
                    opacity="0.5"
                  />
                </>
              )}
            </svg>
            <span className="relative pb-1.5 text-[10.5px] font-medium ui-small">
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface DesignPanelProps {
  design: DesignState;
  setDesign: (patch: Partial<DesignState>) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CompositionEditor — the ordered list of sections that make up the current
// landing. Click a section to swap its variant. Plus button at the bottom
// inserts a new section. Up/down arrows reorder. Trash removes.
// ─────────────────────────────────────────────────────────────────────────────

interface CompositionEditorProps {
  composition: SectionInstance[];
  onChange: (next: SectionInstance[]) => void;
}

function CompositionEditor({ composition, onChange }: CompositionEditorProps) {
  // Local state: which section is currently in "swap variant" picker mode.
  const [openVariantFor, setOpenVariantFor] = useState<string | null>(null);
  // Local state: showing the "add section" picker (lists all 17 layouts).
  const [adding, setAdding] = useState(false);

  const grouped = useMemo<Record<string, LayoutPreset[]>>(
    () =>
      LAYOUT_PRESETS.reduce<Record<string, LayoutPreset[]>>((acc, l) => {
        (acc[l.group] = acc[l.group] || []).push(l);
        return acc;
      }, {}),
    [],
  );

  const swap = (sectionId: string, newLayoutId: string) => {
    onChange(
      composition.map((s) =>
        s.id === sectionId ? { ...s, layoutId: newLayoutId } : s,
      ),
    );
    setOpenVariantFor(null);
  };
  const move = (sectionId: string, dir: -1 | 1) => {
    const idx = composition.findIndex((s) => s.id === sectionId);
    if (idx === -1) return;
    const next = [...composition];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };
  const remove = (sectionId: string) => {
    onChange(composition.filter((s) => s.id !== sectionId));
  };
  const add = (layoutId: string) => {
    onChange([...composition, { id: makeSectionId(), layoutId }]);
    setAdding(false);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {composition.map((sec, i) => {
        const preset = LAYOUT_PRESETS.find((l) => l.id === sec.layoutId);
        const open = openVariantFor === sec.id;
        return (
          <div key={sec.id}>
            <div
              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] bd ring-1 ring-[color:var(--border)] bg-[color:var(--bg)]"
            >
              <span className="font-mono text-[9.5px] tabular-nums fg-faint w-4 ui-small">
                {String(i + 1).padStart(2, "0")}
              </span>
              <button
                type="button"
                onClick={() => setOpenVariantFor(open ? null : sec.id)}
                className="flex-1 text-left flex items-center gap-2 min-w-0"
                title={preset?.label}
              >
                <span className="shrink-0 fg-faint">
                  <LayoutWireframe layoutId={sec.layoutId} size={42} />
                </span>
                <span className="min-w-0 flex flex-col gap-0">
                  <span className="font-medium fg truncate leading-tight">
                    {preset?.group ?? "??"}
                  </span>
                  <span className="fg-muted truncate text-[10.5px] leading-tight">
                    {preset?.label ?? sec.layoutId}
                  </span>
                </span>
                <ChevronDown
                  size={10}
                  className={`fg-faint ml-auto transition-transform ${open ? "rotate-180" : ""}`}
                />
              </button>
              <button
                type="button"
                title="Move up"
                onClick={() => move(sec.id, -1)}
                disabled={i === 0}
                className="p-1 rounded fg-faint hover:bg-hover disabled:opacity-30"
              >
                <ChevronUp size={11} />
              </button>
              <button
                type="button"
                title="Move down"
                onClick={() => move(sec.id, 1)}
                disabled={i === composition.length - 1}
                className="p-1 rounded fg-faint hover:bg-hover disabled:opacity-30"
              >
                <ChevronDown size={11} />
              </button>
              <button
                type="button"
                title="Remove section"
                onClick={() => remove(sec.id)}
                className="p-1 rounded fg-faint hover:bg-hover hover:text-[oklch(58%_0.22_25)]"
              >
                <X size={11} />
              </button>
            </div>
            {open && (
              <div className="mt-1.5 mb-2 ml-5 pl-2 border-l-[1.5px] bd flex flex-col gap-1.5">
                {Object.entries(grouped).map(([group, items]) => (
                  <div key={group} className="py-1">
                    <div className="text-[9px] uppercase tracking-[0.16em] font-semibold fg-faint mb-1 ui-small">
                      {group}
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {items.map((l) => {
                        const active = sec.layoutId === l.id;
                        return (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => swap(sec.id, l.id)}
                            title={l.label}
                            className={`group flex flex-col items-center gap-1 p-1 rounded-md text-[9.5px] transition ${
                              active
                                ? "bg-accent-soft ring-1 ring-[var(--accent)]"
                                : "ring-1 ring-[color:var(--border)] hover:ring-[color:var(--border-strong)] hover:bg-hover"
                            }`}
                          >
                            <span className={active ? "text-accent" : "fg-faint"}>
                              <LayoutWireframe layoutId={l.id} size={46} />
                            </span>
                            <span
                              className={`truncate w-full text-center leading-tight ${active ? "text-accent font-medium" : "fg-muted"}`}
                            >
                              {l.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {adding ? (
        <div className="border-t bd pt-2 mt-1">
          <div className="text-[9.5px] uppercase tracking-[0.16em] font-semibold fg-faint mb-1.5 px-1 ui-small">
            Pick a section to add
          </div>
          <div className="max-h-72 overflow-y-auto nice-scroll flex flex-col gap-1.5">
            {Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="py-0.5">
                <div className="text-[8.5px] uppercase tracking-[0.16em] font-semibold fg-faint mb-1 px-1 ui-small">
                  {group}
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {items.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => add(l.id)}
                      title={l.label}
                      className="group flex flex-col items-center gap-1 p-1 rounded-md text-[9.5px] ring-1 ring-[color:var(--border)] hover:ring-[color:var(--border-strong)] hover:bg-hover transition"
                    >
                      <span className="fg-faint group-hover:text-accent">
                        <LayoutWireframe layoutId={l.id} size={46} />
                      </span>
                      <span className="truncate w-full text-center fg-muted leading-tight">
                        {l.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="mt-1 w-full text-[10.5px] fg-faint py-1 hover:bg-hover rounded transition"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center justify-center gap-1.5 w-full px-2 py-1.5 rounded-md text-[11.5px] bd ring-1 ring-[color:var(--border)] hover:ring-[color:var(--border-strong)] hover:bg-hover transition fg-muted"
        >
          <Plus size={11} />
          Add section
        </button>
      )}
      {composition.length === 0 && (
        <div className="text-[10.5px] fg-faint italic px-1">
          No sections — preview shows the mock Acme landing.
        </div>
      )}
    </div>
  );
}

export function DesignPanel({ design, setDesign }: DesignPanelProps) {
  return (
    <div className="overflow-y-auto nice-scroll h-full">
      <DesignSection label="Composition" icon={Layers}>
        <CompositionEditor
          composition={design.composition}
          onChange={(next) => setDesign({ composition: next })}
        />
      </DesignSection>
      <DesignSection label="Background" icon={ImageIcon}>
        <div className="grid grid-cols-4 gap-1.5">
          {BG_PRESETS.map((b) => (
            <BgThumb
              key={b.id}
              id={b.id}
              label={b.label}
              hue={design.hue}
              active={design.bg === b.id}
              onClick={() => setDesign({ bg: b.id })}
            />
          ))}
        </div>
      </DesignSection>
      <DesignSection label="Palette" icon={PaletteIcon}>
        <div className="grid grid-cols-5 gap-1.5 mb-3">
          {PALETTES.map((p) => (
            <PaletteSwatch
              key={p.id}
              palette={p}
              active={design.paletteId === p.id}
              onClick={() => setDesign({ paletteId: p.id, hue: p.hue })}
            />
          ))}
        </div>
        <HslSlider hue={design.hue} onChange={(h) => setDesign({ hue: h })} />
      </DesignSection>
      <DesignSection label="Typography" icon={Type}>
        <div className="-mx-3 space-y-0.5">
          {TYPE_SYSTEMS.map((t) => (
            <TypeCard
              key={t.id}
              system={t}
              active={design.typeId === t.id}
              onClick={() => setDesign({ typeId: t.id })}
            />
          ))}
        </div>
      </DesignSection>
      <DesignSection label="Density" icon={Rows}>
        <SegmentedDiagram<DensityValue>
          value={design.density}
          onChange={(v) => setDesign({ density: v })}
          options={DENSITY_OPTS}
          getDiagram={(v) => <TickDiagram variant={v} />}
        />
      </DesignSection>
      <DesignSection label="Radius" icon={SquareDashed}>
        <SegmentedDiagram<RadiusValue>
          value={design.radius}
          onChange={(v) => setDesign({ radius: v })}
          options={RADIUS_OPTS}
          getDiagram={(v) => <RadiusDiagram variant={v} />}
        />
      </DesignSection>
      <DesignSection label="Decoration intensity" icon={Sparkles}>
        <DecorationSlider
          value={design.decoration}
          onChange={(v) => setDesign({ decoration: v })}
          options={DECORATION_OPTS}
        />
      </DesignSection>
    </div>
  );
}
