export function Marca({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="len-lens" x1="14" y1="11" x2="52" y2="55" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF7E55" />
          <stop offset="0.52" stopColor="#FF5A36" />
          <stop offset="1" stopColor="#E5391A" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="19.5" stroke="url(#len-lens)" strokeWidth="15" />
    </svg>
  );
}
