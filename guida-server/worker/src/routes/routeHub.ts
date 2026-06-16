import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { getSql, getPool } from '../db.js';
import { rateLimit } from '../ratelimit.js';
import { generateCode, verifyRequestSignature, type SignatureHeaders } from '../crypto.js';
import type {
  Route,
  UploadBody,
  LikeBody,
  PlayBody,
  DifficultyTag,
  DifficultyMode,
  VerifiedMethod,
} from '../domain.js';

const VALID_DIFFICULTY_TAG: DifficultyTag[] = ['쉬움', '보통', '어려움'];
const VALID_DIFFICULTY_MODE: DifficultyMode[] = ['normal', 'hard', 'extreme'];
const VALID_VERIFIED: VerifiedMethod[] = ['self_report', 'ocr'];

/**
 * routes 행 + 해당 패치 통계를 합쳐 API 응답 형태로 반환하는 SELECT.
 * 통계는 (route_code, routes.patch_version) 기준으로 매칭하고 없으면 0으로 채운다.
 */
const ROUTE_SELECT = `
  SELECT
    r.route_code,
    r.name,
    r.patch_version,
    r.difficulty_tag,
    r.difficulty_mode,
    r.difficulty_switch_floor,
    r.target_rewards,
    r.floors,
    r.gift_order,
    r.pack_order,
    r.memo,
    r.verified_method,
    r.deck_code,
    r.uploaded_at,
    COALESCE(rs.likes, 0)      AS likes,
    COALESCE(rs.play_count, 0) AS play_count,
    r.uploader_uuid,
    COALESCE(u.nickname, 'user_' || UPPER(SUBSTRING(REPLACE(r.uploader_uuid::text, '-', ''), 1, 6))) AS uploader_nickname
  FROM routes r
  LEFT JOIN route_stats rs
    ON rs.route_code = r.route_code
   AND rs.patch_version = r.patch_version
  LEFT JOIN users u
    ON u.uuid = r.uploader_uuid
`;

/** UploadBody 필수 필드 검증 (upload / update 공통). */
function isValidRouteBody(body: UploadBody): boolean {
  return !(
    !body.uuid ||
    !body.name ||
    !VALID_DIFFICULTY_TAG.includes(body.difficulty_tag) ||
    !VALID_DIFFICULTY_MODE.includes(body.difficulty_mode) ||
    (body.difficulty_switch_floor != null && typeof body.difficulty_switch_floor !== 'number') ||
    !Array.isArray(body.target_rewards) ||
    !Array.isArray(body.floors) ||
    !Array.isArray(body.gift_order ?? []) ||
    !Array.isArray(body.pack_order ?? []) ||
    !VALID_VERIFIED.includes(body.verified_method) ||
    (body.deck_code != null && typeof body.deck_code !== 'string')
  );
}

function sigHeaders(c: { req: { header: (n: string) => string | undefined } }): SignatureHeaders {
  return {
    pubkey: c.req.header('x-guida-pubkey'),
    timestamp: c.req.header('x-guida-timestamp'),
    signature: c.req.header('x-guida-signature'),
  };
}

const routeHub = new Hono<AppEnv>();

// ──────────────────────────────────────────────
// GET /api/routes — 목록 조회 (필터 + 정렬 + 페이지네이션)
// ──────────────────────────────────────────────
routeHub.get('/api/routes', async (c) => {
  const q = c.req.query();
  const sort = q.sort ?? 'likes';

  const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 100);
  const offset = Math.max(Number(q.offset) || 0, 0);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (q.patch) {
    params.push(q.patch);
    conditions.push(`r.patch_version = $${params.length}`);
  }
  if (q.difficulty_tag) {
    params.push(q.difficulty_tag);
    conditions.push(`r.difficulty_tag = $${params.length}`);
  }
  if (q.difficulty_mode) {
    params.push(q.difficulty_mode);
    conditions.push(`r.difficulty_mode = $${params.length}`);
  }
  if (q.min_likes !== undefined && q.min_likes !== null && `${q.min_likes}` !== '') {
    params.push(Number(q.min_likes));
    conditions.push(`COALESCE(rs.likes, 0) >= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const orderBy =
    sort === 'latest'
      ? 'r.uploaded_at DESC'
      : sort === 'play_count'
        ? 'COALESCE(rs.play_count, 0) DESC, r.uploaded_at DESC'
        : 'COALESCE(rs.likes, 0) DESC, r.uploaded_at DESC';

  const sql = getSql(c.env);

  const countSql = `SELECT COUNT(*)::int AS total FROM routes r
    LEFT JOIN route_stats rs ON rs.route_code = r.route_code AND rs.patch_version = r.patch_version
    ${where}`;
  const countRows = (await sql(countSql, params)) as { total: number }[];
  const total = countRows[0]?.total ?? 0;

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const listSql = `${ROUTE_SELECT} ${where} ORDER BY ${orderBy} LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
  const rows = (await sql(listSql, params)) as Route[];

  return c.json({ routes: rows, total });
});

// ──────────────────────────────────────────────
// GET /api/routes/:code — 단일 루트 조회 (대소문자 무관)
// ──────────────────────────────────────────────
routeHub.get('/api/routes/:code', async (c) => {
  const code = c.req.param('code').toUpperCase();
  const sql = getSql(c.env);
  const rows = (await sql(`${ROUTE_SELECT} WHERE r.route_code = $1`, [code])) as Route[];

  if (!rows[0]) {
    return c.json({ error: '루트를 찾을 수 없습니다.' }, 404);
  }
  return c.json(rows[0]);
});

// ──────────────────────────────────────────────
// POST /api/routes/upload — 루트 업로드 및 코드 발급
// ──────────────────────────────────────────────
routeHub.post(
  '/api/routes/upload',
  rateLimit((e) => e.RL_UPLOAD, '루트 업로드는 1분에 최대 10회만 가능합니다.'),
  async (c) => {
    const rawBody = await c.req.text();
    let body: UploadBody;
    try {
      body = JSON.parse(rawBody) as UploadBody;
    } catch {
      return c.json({ error: '필수 필드가 누락되었거나 형식이 올바르지 않습니다.' }, 400);
    }

    const {
      name,
      difficulty_tag,
      difficulty_mode,
      difficulty_switch_floor = null,
      target_rewards,
      floors,
      gift_order = [],
      pack_order = [],
      memo = null,
      verified_method,
      deck_code = null,
    } = body;

    if (!isValidRouteBody(body)) {
      return c.json({ error: '필수 필드가 누락되었거나 형식이 올바르지 않습니다.' }, 400);
    }

    let uploaderUuid: string;
    try {
      uploaderUuid = await verifyRequestSignature(sigHeaders(c), rawBody, 'upload');
    } catch (err) {
      return c.json({ error: (err as Error).message }, 401);
    }

    const pool = getPool(c.env);
    try {
      const cfg = await pool.query<{ value: string }>(
        `SELECT value FROM config WHERE key = 'current_patch'`,
      );
      const patchVersion = cfg.rows[0]?.value ?? '0.0';

      const client = await pool.connect();
      try {
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = generateCode();
          try {
            await client.query('BEGIN');
            await client.query(
              `INSERT INTO routes
                 (route_code, name, patch_version, difficulty_tag,
                  difficulty_mode, difficulty_switch_floor, target_rewards, floors,
                  gift_order, pack_order, memo, verified_method, uploader_uuid, deck_code)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
              [
                code,
                name,
                patchVersion,
                difficulty_tag,
                difficulty_mode,
                difficulty_switch_floor,
                target_rewards,
                floors,
                JSON.stringify(gift_order), // JSONB 컬럼: 배열을 문자열로 직렬화해 전달
                JSON.stringify(pack_order),
                memo,
                verified_method,
                uploaderUuid,
                deck_code,
              ],
            );
            await client.query(
              `INSERT INTO route_stats (route_code, patch_version, likes, play_count)
               VALUES ($1, $2, 0, 0)
               ON CONFLICT (route_code, patch_version) DO NOTHING`,
              [code, patchVersion],
            );
            await client.query('COMMIT');
            return c.json({ route_code: code }, 201);
          } catch (err) {
            await client.query('ROLLBACK');
            // 23505 = unique_violation (코드 충돌) → 재시도
            if ((err as { code?: string }).code === '23505') continue;
            throw err;
          }
        }
        return c.json({ error: '루트 코드 발급에 실패했습니다. 다시 시도해주세요.' }, 500);
      } finally {
        client.release();
      }
    } finally {
      c.executionCtx.waitUntil(pool.end());
    }
  },
);

// ──────────────────────────────────────────────
// PUT /api/routes/:code — 루트 수정 (작성자 UUID 일치 시에만 허용)
// ──────────────────────────────────────────────
routeHub.put(
  '/api/routes/:code',
  rateLimit((e) => e.RL_UPDATE, '루트 수정은 1분에 최대 15회만 가능합니다.'),
  async (c) => {
    const code = c.req.param('code').toUpperCase();
    const rawBody = await c.req.text();
    let body: UploadBody;
    try {
      body = JSON.parse(rawBody) as UploadBody;
    } catch {
      return c.json({ error: '필수 필드가 누락되었거나 형식이 올바르지 않습니다.' }, 400);
    }

    const {
      name,
      difficulty_tag,
      difficulty_mode,
      difficulty_switch_floor = null,
      target_rewards,
      floors,
      gift_order = [],
      pack_order = [],
      memo = null,
      verified_method,
      deck_code = null,
    } = body;

    if (!isValidRouteBody(body)) {
      return c.json({ error: '필수 필드가 누락되었거나 형식이 올바르지 않습니다.' }, 400);
    }

    let uploaderUuid: string;
    try {
      uploaderUuid = await verifyRequestSignature(sigHeaders(c), rawBody, 'update');
    } catch (err) {
      return c.json({ error: (err as Error).message }, 401);
    }

    const pool = getPool(c.env);
    try {
      const owner = await pool.query<{ uploader_uuid: string }>(
        `SELECT uploader_uuid FROM routes WHERE route_code = $1`,
        [code],
      );
      if (!owner.rows[0]) {
        return c.json({ error: '루트를 찾을 수 없습니다.' }, 404);
      }
      if (owner.rows[0].uploader_uuid !== uploaderUuid) {
        return c.json({ error: '본인이 업로드한 루트만 수정할 수 있습니다.' }, 403);
      }

      const updated = await pool.query<{ route_code: string }>(
        `UPDATE routes SET
           name = $2,
           difficulty_tag = $3,
           difficulty_mode = $4,
           difficulty_switch_floor = $5,
           target_rewards = $6,
           floors = $7,
           gift_order = $8,
           pack_order = $9,
           memo = $10,
           verified_method = $11,
           deck_code = $12,
           uploaded_at = now()
         WHERE route_code = $1
         RETURNING route_code`,
        [
          code,
          name,
          difficulty_tag,
          difficulty_mode,
          difficulty_switch_floor,
          target_rewards,
          floors,
          JSON.stringify(gift_order),
          JSON.stringify(pack_order),
          memo,
          verified_method,
          deck_code,
        ],
      );
      if (!updated.rows[0]) {
        return c.json({ error: '루트를 찾을 수 없습니다.' }, 404);
      }

      const full = await pool.query<Route>(`${ROUTE_SELECT} WHERE r.route_code = $1`, [code]);
      return c.json(full.rows[0]);
    } finally {
      c.executionCtx.waitUntil(pool.end());
    }
  },
);

// ──────────────────────────────────────────────
// DELETE /api/routes/:code — 루트 삭제 (작성자 UUID 일치 시에만 허용)
// ──────────────────────────────────────────────
routeHub.delete(
  '/api/routes/:code',
  async (c) => {
    const code = c.req.param('code').toUpperCase();
    const rawBody = await c.req.text();

    let uploaderUuid: string;
    try {
      uploaderUuid = await verifyRequestSignature(sigHeaders(c), rawBody, 'delete');
    } catch (err) {
      return c.json({ error: (err as Error).message }, 401);
    }

    const pool = getPool(c.env);
    try {
      const owner = await pool.query<{ uploader_uuid: string }>(
        `SELECT uploader_uuid FROM routes WHERE route_code = $1`,
        [code],
      );
      if (!owner.rows[0]) {
        return c.json({ error: '루트를 찾을 수 없습니다.' }, 404);
      }
      if (owner.rows[0].uploader_uuid !== uploaderUuid) {
        return c.json({ error: '본인이 업로드한 루트만 삭제할 수 있습니다.' }, 403);
      }

      await pool.query(
        `DELETE FROM routes WHERE route_code = $1`,
        [code],
      );

      return c.json({ success: true });
    } finally {
      c.executionCtx.waitUntil(pool.end());
    }
  },
);

// ──────────────────────────────────────────────
// POST /api/routes/:code/like — 추천 (패치 버전당 UUID 1회)
// ──────────────────────────────────────────────
routeHub.post(
  '/api/routes/:code/like',
  rateLimit((e) => e.RL_LIKE, '추천은 1분에 최대 15회만 가능합니다.'),
  async (c) => {
    const code = c.req.param('code').toUpperCase();
    const { uuid, patch_version } = await c.req
      .json<LikeBody>()
      .catch(() => ({}) as LikeBody);

    if (!uuid || !patch_version) {
      return c.json({ error: '필수 필드가 누락되었습니다.' }, 400);
    }

    const pool = getPool(c.env);
    try {
      const exists = await pool.query(`SELECT 1 FROM routes WHERE route_code = $1`, [code]);
      if (!exists.rows[0]) {
        return c.json({ error: '루트를 찾을 수 없습니다.' }, 404);
      }

      const client = await pool.connect();
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
          return c.json({ error: '이미 추천한 루트입니다.' }, 409);
        }

        await client.query(
          `INSERT INTO route_stats (route_code, patch_version, likes, play_count)
           VALUES ($1, $2, 1, 0)
           ON CONFLICT (route_code, patch_version)
           DO UPDATE SET likes = route_stats.likes + 1`,
          [code, patch_version],
        );

        await client.query('COMMIT');
        return c.json({ success: true });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } finally {
      c.executionCtx.waitUntil(pool.end());
    }
  },
);

// ──────────────────────────────────────────────
// POST /api/routes/:code/play — 거던 클리어 시 플레이 수 +1
// ──────────────────────────────────────────────
routeHub.post('/api/routes/:code/play', async (c) => {
  const code = c.req.param('code').toUpperCase();
  const { patch_version } = await c.req.json<PlayBody>().catch(() => ({}) as PlayBody);

  if (!patch_version) {
    return c.json({ error: '필수 필드가 누락되었습니다.' }, 400);
  }

  const sql = getSql(c.env);
  const exists = (await sql(`SELECT 1 FROM routes WHERE route_code = $1`, [code])) as
    unknown[];
  if (!exists[0]) {
    return c.json({ error: '루트를 찾을 수 없습니다.' }, 404);
  }

  const rows = (await sql(
    `INSERT INTO route_stats (route_code, patch_version, likes, play_count)
     VALUES ($1, $2, 0, 1)
     ON CONFLICT (route_code, patch_version)
     DO UPDATE SET play_count = route_stats.play_count + 1
     RETURNING play_count`,
    [code, patch_version],
  )) as { play_count: number }[];

  return c.json({ success: true, play_count: rows[0]?.play_count ?? 1 });
});

// ──────────────────────────────────────────────
// POST /api/backup — 백업 데이터 저장 (UPSERT)
// ──────────────────────────────────────────────
routeHub.post(
  '/api/backup',
  rateLimit((e) => e.RL_BACKUP, '백업 저장은 1분에 최대 10회만 가능합니다.'),
  async (c) => {
    const { recovery_code_hash, encrypted_blob } = await c.req
      .json<{ recovery_code_hash?: string; encrypted_blob?: string }>()
      .catch(() => ({}) as { recovery_code_hash?: string; encrypted_blob?: string });
    if (!recovery_code_hash || !encrypted_blob) {
      return c.json({ error: '필수 필드가 누락되었습니다.' }, 400);
    }

    const sql = getSql(c.env);
    await sql(
      `INSERT INTO backups (recovery_code_hash, encrypted_blob, uploaded_at)
       VALUES ($1, $2, now())
       ON CONFLICT (recovery_code_hash)
       DO UPDATE SET encrypted_blob = EXCLUDED.encrypted_blob, uploaded_at = now()`,
      [recovery_code_hash, encrypted_blob],
    );

    return c.json({ success: true });
  },
);

// ──────────────────────────────────────────────
// POST /api/backup/restore — 백업 데이터 복구
// ──────────────────────────────────────────────
routeHub.post(
  '/api/backup/restore',
  rateLimit((e) => e.RL_RESTORE, '백업 복구는 1분에 최대 20회만 가능합니다.'),
  async (c) => {
    const { recovery_code_hash } = await c.req
      .json<{ recovery_code_hash?: string }>()
      .catch(() => ({}) as { recovery_code_hash?: string });
    if (!recovery_code_hash) {
      return c.json({ error: '복구 코드가 누락되었습니다.' }, 400);
    }

    const sql = getSql(c.env);
    const rows = (await sql(
      `SELECT encrypted_blob FROM backups WHERE recovery_code_hash = $1`,
      [recovery_code_hash],
    )) as { encrypted_blob: string }[];

    if (!rows[0]) {
      return c.json({ error: '백업 데이터를 찾을 수 없습니다.' }, 404);
    }

    return c.json({ encrypted_blob: rows[0].encrypted_blob });
  },
);

// ──────────────────────────────────────────────
// POST /api/users/me — 본인 프로필 조회 (가입/동기화용)
// ──────────────────────────────────────────────
routeHub.post('/api/users/me', async (c) => {
  const rawBody = await c.req.text();
  let uploaderUuid: string;
  try {
    uploaderUuid = await verifyRequestSignature(sigHeaders(c), rawBody, 'get_my_profile');
  } catch (err) {
    return c.json({ error: (err as Error).message }, 401);
  }

  const sql = getSql(c.env);
  // 사용자 정보 조회
  const usersRows = (await sql(
    `SELECT uuid, nickname, description FROM users WHERE uuid = $1`,
    [uploaderUuid]
  )) as { uuid: string; nickname: string; description: string }[];

  const defaultNickname = `user_${uploaderUuid.replace(/-/g, '').substring(0, 6).toUpperCase()}`;
  const user = usersRows[0] || {
    uuid: uploaderUuid,
    nickname: defaultNickname,
    description: ''
  };

  // 총 추천수 조회
  const likesRows = (await sql(
    `SELECT COALESCE(SUM(rs.likes), 0) AS total_likes
     FROM routes r
     LEFT JOIN route_stats rs ON r.route_code = rs.route_code
     WHERE r.uploader_uuid = $1`,
    [uploaderUuid]
  )) as { total_likes: string | number }[];
  const likesReceived = Number(likesRows[0]?.total_likes ?? 0);

  // 만든 루트 목록 조회
  const routes = (await sql(
    `${ROUTE_SELECT} WHERE r.uploader_uuid = $1 ORDER BY r.uploaded_at DESC`,
    [uploaderUuid]
  )) as Route[];

  return c.json({
    uuid: user.uuid,
    nickname: user.nickname,
    description: user.description,
    likes_received: likesReceived,
    routes
  });
});

// ──────────────────────────────────────────────
// GET /api/users/:uuid — 타인 프로필 조회
// ──────────────────────────────────────────────
routeHub.get('/api/users/:uuid', async (c) => {
  const uuid = c.req.param('uuid');

  // UUID 포맷 검증
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(uuid)) {
    return c.json({ error: '올바르지 않은 사용자 식별자(UUID) 형식입니다.' }, 400);
  }

  const sql = getSql(c.env);
  // 사용자 정보 조회
  const usersRows = (await sql(
    `SELECT uuid, nickname, description FROM users WHERE uuid = $1`,
    [uuid]
  )) as { uuid: string; nickname: string; description: string }[];

  const defaultNickname = `user_${uuid.replace(/-/g, '').substring(0, 6).toUpperCase()}`;
  const user = usersRows[0] || {
    uuid,
    nickname: defaultNickname,
    description: ''
  };

  // 총 추천수 조회
  const likesRows = (await sql(
    `SELECT COALESCE(SUM(rs.likes), 0) AS total_likes
     FROM routes r
     LEFT JOIN route_stats rs ON r.route_code = rs.route_code
     WHERE r.uploader_uuid = $1`,
    [uuid]
  )) as { total_likes: string | number }[];
  const likesReceived = Number(likesRows[0]?.total_likes ?? 0);

  // 만든 루트 목록 조회
  const routes = (await sql(
    `${ROUTE_SELECT} WHERE r.uploader_uuid = $1 ORDER BY r.uploaded_at DESC`,
    [uuid]
  )) as Route[];

  return c.json({
    uuid: user.uuid,
    nickname: user.nickname,
    description: user.description,
    likes_received: likesReceived,
    routes
  });
});

// ──────────────────────────────────────────────
// PUT /api/users/profile — 본인 프로필 수정
// ──────────────────────────────────────────────
routeHub.put('/api/users/profile', async (c) => {
  const rawBody = await c.req.text();
  let body: { nickname?: string; description?: string } = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: '요청 바디의 형식이 올바르지 않습니다.' }, 400);
  }

  const { nickname, description = '' } = body;

  if (!nickname || typeof nickname !== 'string' || nickname.trim().length === 0) {
    return c.json({ error: '닉네임은 필수이며 빈 칸일 수 없습니다.' }, 400);
  }
  if (nickname.length > 50) {
    return c.json({ error: '닉네임은 최대 50자까지 입력 가능합니다.' }, 400);
  }
  if (description && description.length > 500) {
    return c.json({ error: '소개 글은 최대 500자까지 입력 가능합니다.' }, 400);
  }

  let uploaderUuid: string;
  try {
    uploaderUuid = await verifyRequestSignature(sigHeaders(c), rawBody, 'update_profile');
  } catch (err) {
    return c.json({ error: (err as Error).message }, 401);
  }

  const sql = getSql(c.env);
  await sql(
    `INSERT INTO users (uuid, nickname, description)
     VALUES ($1, $2, $3)
     ON CONFLICT (uuid)
     DO UPDATE SET nickname = EXCLUDED.nickname, description = EXCLUDED.description`,
    [uploaderUuid, nickname.trim(), description.trim()]
  );

  return c.json({ success: true, nickname: nickname.trim(), description: description.trim() });
});

export default routeHub;

