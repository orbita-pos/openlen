// Tiny SVG sparkline used by the Insights tab — top-links rows and the
// visits-over-time chart. Pure path math, no dependencies.

"use client";

interface SparklineProps {
  data: number[];
  /** Width of the rendered SVG in CSS px. Aspect ratio is fixed; height
   *  scales internally. */
  width?: number;
  height?: number;
  /** Stroke color. Defaults to the page accent. */
  stroke?: string;
  /** Whether to area-fill under the line at low alpha. */
  fill?: boolean;
  /** className passed through to the wrapping <svg>. */
  className?: string;
}

export function Sparkline({
  data,
  width = 64,
  height = 20,
  stroke = "var(--accent)",
  fill = false,
  className = "",
}: SparklineProps) {
  if (data.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 100 100`}
        preserveAspectRatio="none"
        className={className}
      >
        <line
          x1="0"
          y1="50"
          x2="100"
          y2="50"
          stroke={stroke}
          strokeWidth="2"
          strokeOpacity="0.3"
          strokeDasharray="4 4"
        />
      </svg>
    );
  }

  const max = Math.max(...data, 1);
  const min = 0;
  const xStep = 100 / (data.length - 1);
  const points = data
    .map(
      (v, i) =>
        `${(i * xStep).toFixed(2)},${(100 - ((v - min) / (max - min)) * 92 - 4).toFixed(2)}`,
    )
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={className}
    >
      {fill && (
        <polyline
          points={`0,100 ${points} 100,100`}
          fill={stroke}
          fillOpacity="0.12"
          stroke="none"
        />
      )}
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
