import { neon, Pool } from '@neondatabase/serverless';
import type { Env } from './types.js';

/**
 * Neon serverless 드라이버.
 *
 * - 단순 조회/단일 쓰기: `getSql(env)` (HTTP, 연결 셋업 없이 빠름).
 *     사용법: `const rows = await sql(text, params)` → 행 배열 반환(함수를 직접 호출).
 * - 트랜잭션(BEGIN/COMMIT) 필요: `getPool(env)` (WebSocket, node-postgres 호환).
 *     사용 후 반드시 `ctx.waitUntil(pool.end())` 로 정리한다.
 */
export function getSql(env: Env) {
  return neon(env.DATABASE_URL);
}

export function getPool(env: Env) {
  return new Pool({ connectionString: env.DATABASE_URL });
}
