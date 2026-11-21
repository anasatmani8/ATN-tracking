// Minimal Deno globals for type-checking Edge Functions with Node's tsc. Not used at runtime.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};
