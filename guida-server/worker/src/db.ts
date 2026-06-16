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

/**
 * 폐기된 공개키 조회기(B-1). verifyRequestSignature 에 주입해 폐기 키를 거부한다.
 * 단건 조회이므로 HTTP 드라이버(getSql)를 사용한다.
 */
export function revokedChecker(env: Env): (pubkey: string) => Promise<boolean> {
  const sql = getSql(env);
  return async (pubkey: string) => {
    const rows = (await sql('SELECT 1 FROM revoked_keys WHERE pubkey = $1', [pubkey])) as unknown[];
    return rows.length > 0;
  };
}

/**
 * nonce 소비기(A-4). verifyRequestSignature 에 주입해 리플레이를 차단한다.
 * 처음 보는 nonce 면 적재 후 true, 이미 쓰인 nonce 면 false 를 반환한다.
 * TTL 120초(타임스탬프 창 ±60초보다 약간 김). 만료 행은 1% 확률로 기회적 정리.
 * 단건 쓰기이므로 HTTP 드라이버(getSql)를 사용한다.
 */
export function nonceConsumer(env: Env): (nonce: string) => Promise<boolean> {
  const sql = getSql(env);
  return async (nonce: string) => {
    if (Math.random() < 0.01) {
      await sql('DELETE FROM used_nonces WHERE expires_at < now()', []);
    }
    const rows = (await sql(
      `INSERT INTO used_nonces (nonce, expires_at)
       VALUES ($1, now() + interval '120 seconds')
       ON CONFLICT (nonce) DO NOTHING
       RETURNING nonce`,
      [nonce],
    )) as unknown[];
    return rows.length > 0;
  };
}
