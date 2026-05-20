// OpenLen brand mark — a lens ring with a warm-glass gradient. Pure SVG, no
// hooks, safe in both server and client components. The favicon tile lives
// in app/icon.svg.

export function OpenLenMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id="openlen-lens-grad"
          x1="14"
          y1="11"
          x2="52"
          y2="55"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FF7E55" />
          <stop offset="0.52" stopColor="#FF5A36" />
          <stop offset="1" stopColor="#E5391A" />
        </linearGradient>
      </defs>
      <circle
        cx="32"
        cy="32"
        r="19.5"
        stroke="url(#openlen-lens-grad)"
        strokeWidth="15"
      />
    </svg>
  );
}
