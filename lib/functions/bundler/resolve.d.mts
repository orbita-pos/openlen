export declare const STD_HTTP_SERVER: "openlen:std-http-server";
export declare const TYPES_ONLY: "openlen:types-only";

export interface ResolveCatalog {
  readonly dependencies: readonly { readonly name: string; readonly version: string; readonly file: string; readonly subpaths?: Readonly<Record<string, string>> }[];
}

export type Resolution =
  | { readonly kind: "catalog"; readonly name: string; readonly file: string; readonly warning: string | null }
  | { readonly kind: "node"; readonly id: string }
  | { readonly kind: "runtime"; readonly id: string }
  | { readonly kind: "error"; readonly message: string };

export declare function applyImportMap(imports: Readonly<Record<string, string>> | null, specifier: string): string;
export declare function resolveSpecifier(catalog: ResolveCatalog, specifier: string): Resolution;
