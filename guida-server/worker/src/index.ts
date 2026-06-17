import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv } from './types.js';
import { rateLimit } from './ratelimit.js';
import health from './routes/health.js';
import gameData from './routes/gameData.js';
import routeHub from './routes/routeHub.js';
import inquiries from './routes/inquiries.js';

const app = new Hono<AppEnv>();

// CORS — 기존 서버의 origin:true(모든 출처 허용)와 동일.
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'x-guida-pubkey',
      'x-guida-timestamp',
      'x-guida-nonce',
      'x-guida-signature',
      'x-guida-new-signature',
    ],
  }),
);

// 전역 레이트리밋(분당 60회) — 기존 @fastify/rate-limit 전역 설정과 동일.
app.use('/api/*', rateLimit((e) => e.RL_GLOBAL, '요청이 너무 많습니다. 잠시 후 다시 시도하세요.'));

// 라우트
app.route('/', health);
app.route('/', gameData);
app.route('/', routeHub);
app.route('/', inquiries);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: '서버 내부 오류가 발생했습니다.' }, 500);
});

export default app;
