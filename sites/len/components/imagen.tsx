type Nombre = "primera" | "segunda" | "tercera";

const ANCHOS: Record<Nombre, [number, number]> = {
  primera: [1080, 2160],
  segunda: [1080, 2160],
  tercera: [1080, 1536],
};

export function Imagen({
  nombre,
  alt,
  className,
  prioridad = false,
}: {
  nombre: Nombre;
  alt: string;
  className?: string;
  prioridad?: boolean;
}) {
  const [a, b] = ANCHOS[nombre];
  const set = (ext: string) => `/img/${nombre}-${a}.${ext} 1x, /img/${nombre}-${b}.${ext} 2x`;
  return (
    <picture className={className}>
      <source type="image/avif" srcSet={set("avif")} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/img/${nombre}-${a}.webp`}
        srcSet={set("webp")}
        alt={alt}
        loading={prioridad ? "eager" : "lazy"}
        fetchPriority={prioridad ? "high" : "auto"}
        decoding="async"
      />
    </picture>
  );
}
