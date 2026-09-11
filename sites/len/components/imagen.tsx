type Nombre = "primera" | "segunda" | "tercera";

const ANCHOS: Record<Nombre, [number, number]> = {
  primera: [1080, 2160],
  segunda: [1080, 2160],
  tercera: [1080, 1536],
};

// El hueco real: todo el ancho en móvil, y 1000px dentro del .wrap de 1080.
// Con descriptores 1x/2x un móvil de 390px y DPR 2 se bajaba SIEMPRE la de
// 2160px para pintarla a 350: medido, era el recurso más caro de la página.
// Con descriptores de ancho + sizes el navegador elige el que le sirve.
const SIZES = "(max-width: 760px) 100vw, 1000px";

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
  const set = (ext: string) => `/img/${nombre}-${a}.${ext} ${a}w, /img/${nombre}-${b}.${ext} ${b}w`;
  return (
    <picture className={className}>
      <source type="image/avif" srcSet={set("avif")} sizes={SIZES} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/img/${nombre}-${a}.webp`}
        srcSet={set("webp")}
        sizes={SIZES}
        alt={alt}
        loading={prioridad ? "eager" : "lazy"}
        fetchPriority={prioridad ? "high" : "auto"}
        decoding="async"
      />
    </picture>
  );
}
