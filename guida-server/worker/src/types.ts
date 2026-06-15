/** Cloudflare 네이티브 Rate Limiting 바인딩 형태. */
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Worker 환경 바인딩 (wrangler.toml 과 일치). */
export interface Env {
  /** Neon Postgres 연결 문자열 (시크릿). */
  DATABASE_URL: string;
  RL_GLOBAL: RateLimit;
  RL_INQUIRY: RateLimit;
  RL_UPLOAD: RateLimit;
  RL_UPDATE: RateLimit;
  RL_LIKE: RateLimit;
  RL_BACKUP: RateLimit;
  RL_RESTORE: RateLimit;
}

/** Hono 제네릭 (모든 라우트에서 동일하게 사용). */
export type AppEnv = { Bindings: Env };
