import '@fastify/jwt';

declare module 'fastify' {
  interface FastifyRequest {
    jwtVerify(): Promise<void>;
    user: {
      id: string;
      name: string;
      email: string;
      role: 'ADMIN' | 'MANAGER' | 'EXECUTIVE';
    };
  }
}
