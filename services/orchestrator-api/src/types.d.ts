import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
    user?: {
      sub?: string;
      scopes?: string[];
      tid?: string;
      role?: string;
      impersonatedSub?: string;
      impersonatedTid?: string;
    };
  }
}
