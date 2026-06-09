import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  Route,
  UploadBody,
  LikeBody,
  PlayBody,
  ListRoutesQuery,
  Difficulty,
  RouteType,
  VerifiedMethod,
} from '../types/index.js';

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const VALID_DIFFICULTY: Difficulty[] = ['쉬움', '보통', '어려움'];
const VALID_ROUTE_TYPE: RouteType[] = ['파밍 효율 중심', '특정 목표 중심'];
const VALID_VERIFIED: VerifiedMethod[] = ['self_report', 'ocr'];

/** 6자리 대문자 영숫자 코드 생성 (예: X7R2B9) */
function generateCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  }
  return code;
}

/**
 * routes 행 + 해당 패치 통계를 합쳐 API 응답 형태로 반환하는 SELECT.
 * 통계는 (route_code, routes.patch_version) 기준으로 매칭하고 없으면 0으로 채운다.
 */
const ROUTE_SELECT = `
  SELECT
    r.route_code,
    r.name,
    r.patch_version,
    r.difficulty,
    r.route_type,
    r.target_rewards,
    r.floors,
    r.steps,
    r.memo,
    r.verified_method,
    r.uploaded_at,
    COALESCE(rs.likes, 0)      AS likes,
    COALESCE(rs.play_count, 0) AS play_count
  FROM routes r
  LEFT JOIN route_stats rs
    ON rs.route_code = r.route_code
   AND rs.patch_version = r.patch_version
`;

export default async function routeHubRoutes(fastify: FastifyInstance) {
  // ──────────────────────────────────────────────
  // GET /api/routes — 목록 조회 (필터 + 정렬 + 페이지네이션)
  // ──────────────────────────────────────────────
  fastify.get<{ Querystring: ListRoutesQuery }>('/api/routes', async (req) => {
    const { patch, sort = 'likes', difficulty, route_type, min_likes } = req.query;

    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (patch) {
      params.push(patch);
      conditions.push(`r.patch_version = $${params.length}`);
    }
    if (difficulty) {
      params.push(difficulty);
      conditions.push(`r.difficulty = $${params.length}`);
    }
    if (route_type) {
      params.push(route_type);
      conditions.push(`r.route_type = $${params.length}`);
    }
    if (min_likes !== undefined && min_likes !== null && `${min_likes}` !== '') {
      params.push(Number(min_likes));
      conditions.push(`COALESCE(rs.likes, 0) >= $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const orderBy =
      sort === 'latest'
        ? 'r.uploaded_at DESC'
        : sort === 'play_count'
          ? 'COALESCE(rs.play_count, 0) DESC, r.uploaded_at DESC'
          : 'COALESCE(rs.likes, 0) DESC, r.uploaded_at DESC';

    // 총 개수 (limit/offset 미적용)
    const countSql = `SELECT COUNT(*)::int AS total FROM routes r
      LEFT JOIN route_stats rs ON rs.route_code = r.route_code AND rs.patch_version = r.patch_version
      ${where}`;
    const { rows: countRows } = await fastify.pg.query<{ total: number }>(countSql, params);
    const total = countRows[0]?.total ?? 0;

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const listSql = `${ROUTE_SELECT} ${where} ORDER BY ${orderBy} LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    const { rows } = await fastify.pg.query<Route>(listSql, params);

    return { routes: rows, total };
  });

  // ──────────────────────────────────────────────
  // GET /api/routes/:code — 단일 루트 조회 (대소문자 무관)
  // ──────────────────────────────────────────────
  fastify.get<{ Params: { code: string } }>('/api/routes/:code', async (req, reply) => {
    const code = req.params.code.toUpperCase();
    const { rows } = await fastify.pg.query<Route>(
      `${ROUTE_SELECT} WHERE r.route_code = $1`,
      [code],
    );

    if (!rows[0]) {
      return reply.code(404).send({ error: '루트를 찾을 수 없습니다.' });
    }
    return rows[0];
  });

  // ──────────────────────────────────────────────
  // POST /api/routes/upload — 루트 업로드 및 코드 발급
  // ──────────────────────────────────────────────
  fastify.post<{ Body: UploadBody }>('/api/routes/upload', async (req, reply) => {
    const body = req.body ?? ({} as UploadBody);
    const {
      uuid,
      name,
      difficulty,
      route_type,
      target_rewards,
      floors,
      steps = [],
      memo = null,
      verified_method,
    } = body;

    // 필수 필드 검증
    if (
      !uuid ||
      !name ||
      !VALID_DIFFICULTY.includes(difficulty) ||
      !VALID_ROUTE_TYPE.includes(route_type) ||
      !Array.isArray(target_rewards) ||
      !Array.isArray(floors) ||
      !Array.isArray(steps) ||
      !VALID_VERIFIED.includes(verified_method)
    ) {
      return reply.code(400).send({ error: '필수 필드가 누락되었거나 형식이 올바르지 않습니다.' });
    }

    // 현재 패치 버전
    const { rows: cfg } = await fastify.pg.query<{ value: string }>(
      `SELECT value FROM config WHERE key = 'current_patch'`,
    );
    const patchVersion = cfg[0]?.value ?? '0.0';

    const client = await fastify.pg.connect();
    try {
      // 코드 충돌 시 재시도
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateCode();
        try {
          await client.query('BEGIN');
          await client.query(
            `INSERT INTO routes
               (route_code, name, patch_version, difficulty, route_type,
                target_rewards, floors, steps, memo, verified_method, uploader_uuid)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              code,
              name,
              patchVersion,
              difficulty,
              route_type,
              target_rewards,
              floors,
              JSON.stringify(steps), // JSONB 컬럼: 배열을 문자열로 직렬화해 전달
              memo,
              verified_method,
              uuid,
            ],
          );
          // 초기 통계 행 생성
          await client.query(
            `INSERT INTO route_stats (route_code, patch_version, likes, play_count)
             VALUES ($1, $2, 0, 0)
             ON CONFLICT (route_code, patch_version) DO NOTHING`,
            [code, patchVersion],
          );
          await client.query('COMMIT');
          return reply.code(201).send({ route_code: code });
        } catch (err) {
          await client.query('ROLLBACK');
          // 23505 = unique_violation (코드 충돌) → 재시도
          if ((err as { code?: string }).code === '23505') continue;
          throw err;
        }
      }
      return reply.code(500).send({ error: '루트 코드 발급에 실패했습니다. 다시 시도해주세요.' });
    } finally {
      client.release();
    }
  });

  // ──────────────────────────────────────────────
  // POST /api/routes/:code/like — 추천 (패치 버전당 UUID 1회)
  // ──────────────────────────────────────────────
  fastify.post<{ Params: { code: string }; Body: LikeBody }>(
    '/api/routes/:code/like',
    async (req, reply) => {
      const code = req.params.code.toUpperCase();
      const { uuid, patch_version } = req.body ?? ({} as LikeBody);

      if (!uuid || !patch_version) {
        return reply.code(400).send({ error: '필수 필드가 누락되었습니다.' });
      }

      // 루트 존재 확인
      const { rows: exists } = await fastify.pg.query(
        `SELECT 1 FROM routes WHERE route_code = $1`,
        [code],
      );
      if (!exists[0]) {
        return reply.code(404).send({ error: '루트를 찾을 수 없습니다.' });
      }

      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        // 중복 추천 차단: 복합 PK 충돌 시 아무 행도 삽입되지 않음
        const inserted = await client.query(
          `INSERT INTO route_likes (uuid, route_code, patch_version)
           VALUES ($1, $2, $3)
           ON CONFLICT (uuid, route_code, patch_version) DO NOTHING`,
          [uuid, code, patch_version],
        );

        if (inserted.rowCount === 0) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: '이미 추천한 루트입니다.' });
        }

        // 해당 패치 통계 행에 추천수 +1 (행이 없으면 생성)
        await client.query(
          `INSERT INTO route_stats (route_code, patch_version, likes, play_count)
           VALUES ($1, $2, 1, 0)
           ON CONFLICT (route_code, patch_version)
           DO UPDATE SET likes = route_stats.likes + 1`,
          [code, patch_version],
        );

        await client.query('COMMIT');
        return { success: true };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // ──────────────────────────────────────────────
  // POST /api/routes/:code/play — 거던 클리어 시 플레이 수 +1
  // 추천과 달리 중복 제한 없이 클리어할 때마다 누적된다.
  // ──────────────────────────────────────────────
  fastify.post<{ Params: { code: string }; Body: PlayBody }>(
    '/api/routes/:code/play',
    async (req, reply) => {
      const code = req.params.code.toUpperCase();
      const { patch_version } = req.body ?? ({} as PlayBody);

      if (!patch_version) {
        return reply.code(400).send({ error: '필수 필드가 누락되었습니다.' });
      }

      // 루트 존재 확인
      const { rows: exists } = await fastify.pg.query(
        `SELECT 1 FROM routes WHERE route_code = $1`,
        [code],
      );
      if (!exists[0]) {
        return reply.code(404).send({ error: '루트를 찾을 수 없습니다.' });
      }

      // 해당 패치 통계 행에 플레이 수 +1 (행이 없으면 생성)
      const { rows } = await fastify.pg.query<{ play_count: number }>(
        `INSERT INTO route_stats (route_code, patch_version, likes, play_count)
         VALUES ($1, $2, 0, 1)
         ON CONFLICT (route_code, patch_version)
         DO UPDATE SET play_count = route_stats.play_count + 1
         RETURNING play_count`,
        [code, patch_version],
      );

      return { success: true, play_count: rows[0]?.play_count ?? 1 };
    },
  );
}
