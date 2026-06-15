import type { MiddlewareHandler } from 'hono';
import type { AppEnv, Env, RateLimit } from './types.js';

/**
 * Cloudflare 네이티브 Rate Limiting 바인딩을 사용하는 Hono 미들웨어 팩토리.
 * 클라이언트 IP(CF-Connecting-IP) 기준으로 카운트한다.
 *
 * 참고: 네이티브 바인딩은 남은 대기시간(retry-after)을 제공하지 않으므로
 * 기존 메시지의 "N초 후" 부분은 생략한다.
 */
export function rateLimit(
  pick: (env: Env) => RateLimit,
  message: string,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Real-IP') ?? 'unknown';
    const { success } = await pick(c.env).limit({ key: ip });
    if (!success) {
      return c.json({ error: message }, 429);
    }
    await next();
  };
}
