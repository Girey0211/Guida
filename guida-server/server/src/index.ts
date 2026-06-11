import Fastify from 'fastify';
import cors from '@fastify/cors';

import dbPlugin from './plugins/db.js';
import rateLimitPlugin from './plugins/rateLimit.js';
import healthRoutes from './routes/health.js';
import gameDataRoutes from './routes/gameData.js';
import routeHubRoutes from './routes/routes.js';

const PORT = Number(process.env.SERVER_PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV ?? 'development';

async function main() {
  const fastify = Fastify({
    logger:
      NODE_ENV === 'production'
        ? true
        : {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          },
    trustProxy: true, // Nginx / Cloudflare Tunnel 뒤에서 실제 클라이언트 IP 인식
    pluginTimeout: 60000, // 원격 DB(Tailscale 등) 연결 및 마이그레이션 시간 고려하여 플러그인 타임아웃을 60초로 상향
  });

  // application/json content parser to capture raw body string for signatures
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      const bodyStr = body as string;
      const json = JSON.parse(bodyStr);
      (req as any).rawBody = bodyStr;
      done(null, json);
    } catch (err) {
      done(err as Error);
    }
  });

  // 플러그인
  await fastify.register(cors, { origin: true });
  await fastify.register(dbPlugin);
  await fastify.register(rateLimitPlugin);

  // 라우트
  await fastify.register(healthRoutes);
  await fastify.register(gameDataRoutes);
  await fastify.register(routeHubRoutes);

  try {
    // 127.0.0.1 외부 직접 접근 차단은 docker-compose 포트 바인딩에서 처리.
    // 컨테이너 내부에서는 0.0.0.0 으로 리슨해야 Nginx가 접근 가능하다.
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`🖥️  guida-server 실행 중 (포트 ${PORT}, ${NODE_ENV})`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
