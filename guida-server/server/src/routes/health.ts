import type { FastifyInstance } from 'fastify';

/** GET /health — 서버 정상 동작 여부 확인 */
export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));
}
