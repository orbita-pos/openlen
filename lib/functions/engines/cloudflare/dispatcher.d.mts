// Los tipos del despachador (dispatcher.mjs), para el motor y las pruebas.

export interface DispatchLimits {
  readonly cpuMs: number;
  readonly subRequests: number;
}

export interface DispatchNamespace {
  get(name: string, args: object, options: { readonly limits: DispatchLimits }): { fetch(input: string, init?: RequestInit): Promise<Response> };
}

export interface DispatcherEnv {
  readonly DISPATCH_KEY?: string;
  readonly DISPATCHER: DispatchNamespace;
}

declare const dispatcher: { fetch(request: Request, env: DispatcherEnv): Promise<Response> };
export default dispatcher;
