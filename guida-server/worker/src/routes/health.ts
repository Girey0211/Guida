import { Hono } from 'hono';
import type { AppEnv } from '../types.js';

/** GET /health — 서버 정상 동작 여부 확인 */
const health = new Hono<AppEnv>();

health.get('/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() }),
);

export default health;
