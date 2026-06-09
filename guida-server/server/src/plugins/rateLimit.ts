import fp from 'fastify-plugin';
import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

/**
 * @fastify/rate-limit 설정.
 * 모든 엔드포인트에 분당 60회 제한을 적용한다.
 * 초과 시 429 Too Many Requests 응답.
 */
export default fp(async function rateLimitPlugin(fastify: FastifyInstance) {
  await fastify.register(fastifyRateLimit, {
    max: 60,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, context) => ({
      error: `요청이 너무 많습니다. ${context.after} 후에 다시 시도하세요.`,
    }),
  });
});
