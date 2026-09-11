declare module "*.mdx" {
  import type { ComponentType } from "react";
  import type { MetaArticulo } from "@/content/tipos";
  export const meta: MetaArticulo;
  const Cuerpo: ComponentType;
  export default Cuerpo;
}
