import crypto, { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const NAMESPACE_DNS = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');

function uuidv5(name: string | Buffer): string {
  const nameBuf = typeof name === 'string' ? Buffer.from(name) : name;
  const hash = crypto.createHash('sha1')
    .update(Buffer.concat([NAMESPACE_DNS, nameBuf]))
    .digest();

  // Set version to 5
  hash[6] = (hash[6] & 0x0f) | 0x50;
  // Set variant to RFC 4122
  hash[8] = (hash[8] & 0x3f) | 0x80;

  const hex = hash.toString('hex', 0, 16);
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32)
  ].join('-');
}

/** 최소 DB 인터페이스 (revoked_keys / used_nonces 조회용). fastify.pg 가 이를 만족한다. */
type PgLike = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

/** 서명 타임스탬프 허용 창(±60초). 리플레이 가능 구간을 좁힌다(A-4). */
const SIGNATURE_WINDOW_MS = 60 * 1000;

/**
 * nonce 소비(A-4). 처음 보는 nonce 면 적재 후 true, 이미 쓰인 nonce 면 false.
 * TTL 120초(타임스탬프 창보다 약간 김). 만료 행은 1% 확률로 기회적 정리한다.
 */
async function consumeNonce(pg: PgLike, nonce: string): Promise<boolean> {
  if (Math.random() < 0.01) {
    await pg.query(`DELETE FROM used_nonces WHERE expires_at < now()`);
  }
  const res = await pg.query(
    `INSERT INTO used_nonces (nonce, expires_at)
     VALUES ($1, now() + interval '120 seconds')
     ON CONFLICT (nonce) DO NOTHING`,
    [nonce],
  );
  return (res.rowCount ?? 0) > 0;
}

/** raw Ed25519 공개키(hex) 로 메시지/서명(hex)을 검증한다. 잘못된 키/서명은 false 또는 throw. */
function ed25519Verify(pubkeyHex: string, message: string, signatureHex: string): boolean {
  // 32바이트 raw 공개키에 12바이트 SPKI DER 헤더를 붙여 DER(spki) 키로 재구성한다.
  const rawKeyBuffer = Buffer.from(pubkeyHex, 'hex');
  const derHeader = Buffer.from('302a300506032b6570032100', 'hex');
  const publicKeyDer = Buffer.concat([derHeader, rawKeyBuffer]);
  const publicKeyObject = crypto.createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
  return crypto.verify(null, Buffer.from(message), publicKeyObject, Buffer.from(signatureHex, 'hex'));
}

/** 공개키가 폐기 목록에 있으면 throw (B-1). */
async function assertNotRevoked(pg: PgLike, pubkeyHex: string): Promise<void> {
  const { rows } = await pg.query(`SELECT 1 FROM revoked_keys WHERE pubkey = $1`, [pubkeyHex]);
  if (rows[0]) {
    throw new Error('폐기된 보안 키입니다. 키 갱신(이관) 후 다시 시도하세요.');
  }
}

/**
 * 표준 서명 헤더(x-guida-pubkey/-timestamp/-nonce/-signature)를 검증하고 uploader_uuid 를 반환한다.
 * 폐기된 공개키(B-1)·중복 nonce(A-4 리플레이)는 거부한다. 타임스탬프 허용 창은 ±60초.
 * revoked_keys / used_nonces 조회가 필요하므로 async.
 */
async function verifyRequestSignature(pg: PgLike, req: any, action: string): Promise<string> {
  const pubkey = req.headers['x-guida-pubkey'];
  const timestampStr = req.headers['x-guida-timestamp'];
  const nonce = req.headers['x-guida-nonce'];
  const signature = req.headers['x-guida-signature'];

  if (!pubkey || !timestampStr || !nonce || !signature) {
    throw new Error('보안 서명 헤더가 누락되었습니다.');
  }

  const timestamp = parseInt(timestampStr, 10);
  const now = Date.now();
  if (isNaN(timestamp) || Math.abs(now - timestamp) > SIGNATURE_WINDOW_MS) {
    throw new Error('요청이 만료되었거나 타임스탬프가 유효하지 않습니다.');
  }

  const rawBody = req.rawBody || '';
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const message = `${action}:${timestampStr}:${nonce}:${bodyHash}`;

  let isValid = false;
  try {
    isValid = ed25519Verify(pubkey, message, signature);
  } catch (e) {
    throw new Error(`보안 검증 오류: ${(e as Error).message}`);
  }
  if (!isValid) {
    throw new Error('서명 검증에 실패했습니다.');
  }

  await assertNotRevoked(pg, pubkey);

  // 서명 유효성 확인 후에 nonce 를 소비한다(유효하지 않은 요청으로 nonce 가 소모되지 않게).
  if (!(await consumeNonce(pg, nonce))) {
    throw new Error('이미 처리된 요청입니다(리플레이가 감지되었습니다).');
  }

  return uuidv5(pubkey);
}
import type {
  Route,
  UploadBody,
  LikeBody,
  PlayBody,
  ListRoutesQuery,
  DifficultyTag,
  DifficultyMode,
  VerifiedMethod,
} from '../types/index.js';

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// 추천 Sybil 이상탐지(A-2) 파라미터. 동일 (ip, route_code) 기준.
const LIKE_GUARD_WINDOW_SECS = 600; // 집계 창 10분
const LIKE_GUARD_THRESHOLD = 15; // 창 내 허용 추천 횟수(초과 시 락)
const LIKE_GUARD_LOCK_SECS = 1200; // 초과 시 해당 (ip, route) 추천 락 지속 20분

const VALID_DIFFICULTY_TAG: DifficultyTag[] = ['쉬움', '보통', '어려움'];
const VALID_DIFFICULTY_MODE: DifficultyMode[] = ['normal', 'hard', 'extreme'];
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

export default async function routeHubRoutes(fastify: FastifyInstance) {
  // ──────────────────────────────────────────────
  // GET /api/routes — 목록 조회 (필터 + 정렬 + 페이지네이션)
  // ──────────────────────────────────────────────
  fastify.get<{ Querystring: ListRoutesQuery }>('/api/routes', async (req) => {
    const { patch, sort = 'likes', difficulty_tag, difficulty_mode, min_likes } =
      req.query;

    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (patch) {
      params.push(patch);
      conditions.push(`r.patch_version = $${params.length}`);
    }
    if (difficulty_tag) {
      params.push(difficulty_tag);
      conditions.push(`r.difficulty_tag = $${params.length}`);
    }
    if (difficulty_mode) {
      params.push(difficulty_mode);
      conditions.push(`r.difficulty_mode = $${params.length}`);
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
  fastify.post<{ Body: UploadBody }>('/api/routes/upload', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        errorResponseBuilder: (_req, context) => ({
          error: `루트 업로드는 1분에 최대 10회만 가능합니다. ${context.after} 후에 다시 시도하세요.`,
        }),
      },
    },
  }, async (req, reply) => {
    const body = req.body ?? ({} as UploadBody);
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

    // 필수 필드 검증
    if (
      !name ||
      !VALID_DIFFICULTY_TAG.includes(difficulty_tag) ||
      !VALID_DIFFICULTY_MODE.includes(difficulty_mode) ||
      (difficulty_switch_floor !== null && typeof difficulty_switch_floor !== 'number') ||
      !Array.isArray(target_rewards) ||
      !Array.isArray(floors) ||
      !Array.isArray(gift_order) ||
      !Array.isArray(pack_order) ||
      !VALID_VERIFIED.includes(verified_method) ||
      (deck_code !== undefined && deck_code !== null && typeof deck_code !== 'string')
    ) {
      return reply.code(400).send({ error: '필수 필드가 누락되었거나 형식이 올바르지 않습니다.' });
    }

    let uploaderUuid: string;
    try {
      uploaderUuid = await verifyRequestSignature(fastify.pg, req, 'upload');
    } catch (err) {
      return reply.code(401).send({ error: (err as Error).message });
    }

    // 멱등 키가 있으면 동일 키의 이전 업로드 결과를 그대로 반환(서명 리플레이 무시).
    const idemKey =
      typeof body.idempotency_key === 'string' && body.idempotency_key ? body.idempotency_key : null;
    if (idemKey) {
      const { rows } = await fastify.pg.query<{ route_code: string }>(
        `SELECT route_code FROM upload_idempotency WHERE idempotency_key = $1 AND uploader_uuid = $2`,
        [idemKey, uploaderUuid],
      );
      if (rows[0]) {
        return reply.code(201).send({ route_code: rows[0].route_code });
      }
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
          // 초기 통계 행 생성
          await client.query(
            `INSERT INTO route_stats (route_code, patch_version, likes, play_count)
             VALUES ($1, $2, 0, 0)
             ON CONFLICT (route_code, patch_version) DO NOTHING`,
            [code, patchVersion],
          );
          // 멱등 키 기록. 동시 요청이 먼저 같은 키를 선점했다면 rowCount === 0 →
          // 방금 만든 행을 롤백하고 선점된 기존 코드를 반환한다(코드 충돌 23505 와 구분).
          if (idemKey) {
            const idem = await client.query(
              `INSERT INTO upload_idempotency (idempotency_key, uploader_uuid, route_code)
               VALUES ($1, $2, $3)
               ON CONFLICT (idempotency_key) DO NOTHING`,
              [idemKey, uploaderUuid, code],
            );
            if (idem.rowCount === 0) {
              await client.query('ROLLBACK');
              const { rows } = await fastify.pg.query<{ route_code: string }>(
                `SELECT route_code FROM upload_idempotency WHERE idempotency_key = $1`,
                [idemKey],
              );
              return reply.code(201).send({ route_code: rows[0]?.route_code ?? code });
            }
          }
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
  // PUT /api/routes/:code — 루트 수정 (작성자 UUID 일치 시에만 허용)
  // 업로드한 디바이스(uploader_uuid)와 요청 uuid 가 다르면 403.
  // ──────────────────────────────────────────────
  fastify.put<{ Params: { code: string }; Body: UploadBody }>(
    '/api/routes/:code',
    {
      config: {
        rateLimit: {
          max: 15,
          timeWindow: '1 minute',
          errorResponseBuilder: (_req, context) => ({
            error: `루트 수정은 1분에 최대 15회만 가능합니다. ${context.after} 후에 다시 시도하세요.`,
          }),
        },
      },
    },
    async (req, reply) => {
      const code = req.params.code.toUpperCase();
      const body = req.body ?? ({} as UploadBody);
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

      // 필수 필드 검증 (업로드와 동일 규칙)
      if (
        !name ||
        !VALID_DIFFICULTY_TAG.includes(difficulty_tag) ||
        !VALID_DIFFICULTY_MODE.includes(difficulty_mode) ||
        (difficulty_switch_floor !== null && typeof difficulty_switch_floor !== 'number') ||
        !Array.isArray(target_rewards) ||
        !Array.isArray(floors) ||
        !Array.isArray(gift_order) ||
        !Array.isArray(pack_order) ||
        !VALID_VERIFIED.includes(verified_method) ||
        (deck_code !== undefined && deck_code !== null && typeof deck_code !== 'string')
      ) {
        return reply.code(400).send({ error: '필수 필드가 누락되었거나 형식이 올바르지 않습니다.' });
      }

      let uploaderUuid: string;
      try {
        uploaderUuid = await verifyRequestSignature(fastify.pg, req, 'update');
      } catch (err) {
        return reply.code(401).send({ error: (err as Error).message });
      }

      // 루트 존재 + 작성자 확인
      const { rows: owner } = await fastify.pg.query<{ uploader_uuid: string }>(
        `SELECT uploader_uuid FROM routes WHERE route_code = $1`,
        [code],
      );
      if (!owner[0]) {
        return reply.code(404).send({ error: '루트를 찾을 수 없습니다.' });
      }
      if (owner[0].uploader_uuid !== uploaderUuid) {
        return reply.code(403).send({ error: '본인이 업로드한 루트만 수정할 수 있습니다.' });
      }

      // 통계(route_stats)는 그대로 유지하고 루트 내용만 갱신한다.
      const { rows } = await fastify.pg.query<{ route_code: string }>(
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
      if (!rows[0]) {
        return reply.code(404).send({ error: '루트를 찾을 수 없습니다.' });
      }

      // 갱신된 루트를 통계와 합쳐 반환
      const { rows: full } = await fastify.pg.query<Route>(
        `${ROUTE_SELECT} WHERE r.route_code = $1`,
        [code],
      );
      return full[0];
    },
  );

  // ──────────────────────────────────────────────
  // DELETE /api/routes/:code — 루트 삭제 (작성자 UUID 일치 시에만 허용)
  // ──────────────────────────────────────────────
  fastify.delete<{ Params: { code: string } }>(
    '/api/routes/:code',
    async (req, reply) => {
      const code = req.params.code.toUpperCase();

      let uploaderUuid: string;
      try {
        uploaderUuid = await verifyRequestSignature(fastify.pg, req, 'delete');
      } catch (err) {
        return reply.code(401).send({ error: (err as Error).message });
      }

      // 루트 존재 + 작성자 확인
      const { rows: owner } = await fastify.pg.query<{ uploader_uuid: string }>(
        `SELECT uploader_uuid FROM routes WHERE route_code = $1`,
        [code],
      );
      if (!owner[0]) {
        return reply.code(404).send({ error: '루트를 찾을 수 없습니다.' });
      }
      if (owner[0].uploader_uuid !== uploaderUuid) {
        return reply.code(403).send({ error: '본인이 업로드한 루트만 삭제할 수 있습니다.' });
      }

      await fastify.pg.query(
        `DELETE FROM routes WHERE route_code = $1`,
        [code],
      );

      return { success: true };
    },
  );

  // ──────────────────────────────────────────────
  // POST /api/routes/:code/like — 추천 (패치 버전당 UUID 1회)
  // ──────────────────────────────────────────────
  fastify.post<{ Params: { code: string }; Body: LikeBody }>(
    '/api/routes/:code/like',
    {
      config: {
        rateLimit: {
          max: 15,
          timeWindow: '1 minute',
          errorResponseBuilder: (_req, context) => ({
            error: `추천은 1분에 최대 15회만 가능합니다. ${context.after} 후에 다시 시도하세요.`,
          }),
        },
      },
    },
    async (req, reply) => {
      const code = req.params.code.toUpperCase();
      const { patch_version } = req.body ?? ({} as LikeBody);

      if (!patch_version) {
        return reply.code(400).send({ error: '필수 필드가 누락되었습니다.' });
      }

      // 추천 주체는 서명에서 파생한 uploader_uuid 로 식별한다. raw device_uuid
      // 를 받지 않으므로 route_likes 에 사칭 시드(서명 시드)가 적재되지 않는다.
      let uploaderUuid: string;
      try {
        uploaderUuid = await verifyRequestSignature(fastify.pg, req, 'like');
      } catch (err) {
        return reply.code(401).send({ error: (err as Error).message });
      }

      // A-2 Sybil 이상탐지(광역화): 먼저 IP 전역 락을 확인한다. 한 루트에서 임계 초과로
      // 락이 걸리면 해당 IP 의 모든 /like 가 막혀 다른 루트로의 즉시 피벗을 차단한다.
      const ip = req.ip || 'unknown';
      const { rows: locked } = await fastify.pg.query(
        `SELECT 1 FROM ip_lock WHERE ip = $1 AND locked_until > now()`,
        [ip],
      );
      if (locked[0]) {
        return reply
          .code(429)
          .send({ error: '비정상적인 추천 활동이 감지되어 잠시 추천이 제한됩니다.' });
      }

      // (ip, route_code) 단위 추천 횟수를 집계 창 내에서 누적한다(카운터 전용).
      const { rows: guard } = await fastify.pg.query<{ attempts: number }>(
        `INSERT INTO like_guard (ip, route_code, window_start, attempts)
         VALUES ($1, $2, now(), 1)
         ON CONFLICT (ip, route_code) DO UPDATE SET
           attempts = CASE
             WHEN like_guard.window_start < now() - make_interval(secs => $3) THEN 1
             ELSE like_guard.attempts + 1
           END,
           window_start = CASE
             WHEN like_guard.window_start < now() - make_interval(secs => $3) THEN now()
             ELSE like_guard.window_start
           END
         RETURNING attempts`,
        [ip, code, LIKE_GUARD_WINDOW_SECS],
      );
      // 임계 초과 시 해당 IP 의 전체 /like 를 광역 락하고 이번 요청도 거부한다.
      if ((guard[0]?.attempts ?? 0) > LIKE_GUARD_THRESHOLD) {
        await fastify.pg.query(
          `INSERT INTO ip_lock (ip, locked_until)
           VALUES ($1, now() + make_interval(secs => $2))
           ON CONFLICT (ip) DO UPDATE SET locked_until = now() + make_interval(secs => $2)`,
          [ip, LIKE_GUARD_LOCK_SECS],
        );
        return reply
          .code(429)
          .send({ error: '비정상적인 추천 활동이 감지되어 잠시 추천이 제한됩니다.' });
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
          [uploaderUuid, code, patch_version],
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

      // 플레이 집계 주체는 서명에서 파생한 uploader_uuid 로 식별한다(무인증 → 서명).
      // raw device_uuid 는 받지 않으므로 route_plays 에 사칭 시드가 적재되지 않는다.
      let uploaderUuid: string;
      try {
        uploaderUuid = await verifyRequestSignature(fastify.pg, req, 'play');
      } catch (err) {
        return reply.code(401).send({ error: (err as Error).message });
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

        // 계정별 5분 쿨다운: 신규 행이면 삽입, 기존 행은 5분이 지난 경우에만 갱신.
        // 쿨다운 내 재요청이면 어떤 행도 영향받지 않아 rowCount === 0 → 429.
        const cooldown = await client.query(
          `INSERT INTO route_plays (uuid, route_code, last_played_at)
           VALUES ($1, $2, now())
           ON CONFLICT (uuid, route_code)
           DO UPDATE SET last_played_at = now()
           WHERE route_plays.last_played_at < now() - interval '5 minutes'`,
          [uploaderUuid, code],
        );

        if (cooldown.rowCount === 0) {
          await client.query('ROLLBACK');
          return reply
            .code(429)
            .send({ error: '같은 루트는 5분에 한 번만 플레이로 집계됩니다.' });
        }

        // 해당 패치 통계 행에 플레이 수 +1 (행이 없으면 생성)
        const { rows } = await client.query<{ play_count: number }>(
          `INSERT INTO route_stats (route_code, patch_version, likes, play_count)
           VALUES ($1, $2, 0, 1)
           ON CONFLICT (route_code, patch_version)
           DO UPDATE SET play_count = route_stats.play_count + 1
           RETURNING play_count`,
          [code, patch_version],
        );

        await client.query('COMMIT');
        return { success: true, play_count: rows[0]?.play_count ?? 1 };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // ──────────────────────────────────────────────
  // POST /api/backup — 백업 데이터 저장 (UPSERT)
  // ──────────────────────────────────────────────
  fastify.post<{ Body: { recovery_code_hash: string; encrypted_blob: string } }>(
    '/api/backup',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          errorResponseBuilder: (_req, context) => ({
            error: `백업 저장은 1분에 최대 10회만 가능합니다. ${context.after} 후에 다시 시도하세요.`,
          }),
        },
      },
    },
    async (req, reply) => {
      const { recovery_code_hash, encrypted_blob } = req.body ?? {};
      if (!recovery_code_hash || !encrypted_blob) {
        return reply.code(400).send({ error: '필수 필드가 누락되었습니다.' });
      }

      // 백업 쓰기는 항상 device 키를 가진 본인 기기에서 일어난다(blob 안에 device_uuid 포함).
      // 서명으로 소유자(uploader_uuid)를 파생해 타인의 백업 파괴/덮어쓰기(DoS)를 막는다.
      let ownerUuid: string;
      try {
        ownerUuid = await verifyRequestSignature(fastify.pg, req, 'backup');
      } catch (err) {
        return reply.code(401).send({ error: (err as Error).message });
      }

      // 신규 행이면 owner_uuid 기록, 기존 행은 소유자 일치(또는 미소유 claim) 시에만 덮어쓰기.
      // 불일치 시 WHERE 가 거짓이라 어떤 행도 갱신되지 않아 rowCount === 0 → 403.
      const result = await fastify.pg.query(
        `INSERT INTO backups (recovery_code_hash, encrypted_blob, owner_uuid, uploaded_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (recovery_code_hash)
         DO UPDATE SET encrypted_blob = EXCLUDED.encrypted_blob,
                       owner_uuid = EXCLUDED.owner_uuid,
                       uploaded_at = now()
         WHERE backups.owner_uuid IS NULL OR backups.owner_uuid = EXCLUDED.owner_uuid`,
        [recovery_code_hash, encrypted_blob, ownerUuid],
      );

      if (result.rowCount === 0) {
        return reply
          .code(403)
          .send({ error: '이 백업을 덮어쓸 권한이 없습니다.' });
      }

      return { success: true };
    },
  );

  // ──────────────────────────────────────────────
  // POST /api/backup/restore — 백업 데이터 복구
  // ──────────────────────────────────────────────
  fastify.post<{ Body: { recovery_code_hash: string } }>(
    '/api/backup/restore',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          errorResponseBuilder: (_req, context) => ({
            error: `백업 복구는 1분에 최대 20회만 가능합니다. ${context.after} 후에 다시 시도하세요.`,
          }),
        },
      },
    },
    async (req, reply) => {
      const { recovery_code_hash } = req.body ?? {};
      if (!recovery_code_hash) {
        return reply.code(400).send({ error: '복구 코드가 누락되었습니다.' });
      }

      const { rows } = await fastify.pg.query<{ encrypted_blob: string }>(
        `SELECT encrypted_blob FROM backups WHERE recovery_code_hash = $1`,
        [recovery_code_hash],
      );

      if (!rows[0]) {
        return reply.code(404).send({ error: '백업 데이터를 찾을 수 없습니다.' });
      }

      return { encrypted_blob: rows[0].encrypted_blob };
    },
  );

  // ──────────────────────────────────────────────
  // POST /api/users/me — 본인 프로필 조회 (가입/동기화용)
  // ──────────────────────────────────────────────
  fastify.post('/api/users/me', async (req, reply) => {
    let uploaderUuid: string;
    try {
      uploaderUuid = await verifyRequestSignature(fastify.pg, req, 'get_my_profile');
    } catch (err) {
      return reply.code(401).send({ error: (err as Error).message });
    }

    // 사용자 정보 조회
    const { rows } = await fastify.pg.query<{ uuid: string; nickname: string; description: string }>(
      `SELECT uuid, nickname, description FROM users WHERE uuid = $1`,
      [uploaderUuid]
    );

    const defaultNickname = `user_${uploaderUuid.replace(/-/g, '').substring(0, 6).toUpperCase()}`;
    const user = rows[0] || {
      uuid: uploaderUuid,
      nickname: defaultNickname,
      description: ''
    };

    // 총 추천수 조회
    const { rows: likesRows } = await fastify.pg.query<{ total_likes: string }>(
      `SELECT COALESCE(SUM(rs.likes), 0) AS total_likes
       FROM routes r
       LEFT JOIN route_stats rs ON r.route_code = rs.route_code
       WHERE r.uploader_uuid = $1`,
      [uploaderUuid]
    );
    const likesReceived = Number(likesRows[0]?.total_likes ?? 0);

    // 만든 루트 목록 조회
    const { rows: routes } = await fastify.pg.query<Route>(
      `${ROUTE_SELECT} WHERE r.uploader_uuid = $1 ORDER BY r.uploaded_at DESC`,
      [uploaderUuid]
    );

    return {
      uuid: user.uuid,
      nickname: user.nickname,
      description: user.description,
      likes_received: likesReceived,
      routes
    };
  });

  // ──────────────────────────────────────────────
  // GET /api/users/:uuid — 타인 프로필 조회
  // ──────────────────────────────────────────────
  fastify.get<{ Params: { uuid: string } }>('/api/users/:uuid', async (req, reply) => {
    const { uuid } = req.params;

    // UUID 포맷 검증
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(uuid)) {
      return reply.code(400).send({ error: '올바르지 않은 사용자 식별자(UUID) 형식입니다.' });
    }

    const { rows } = await fastify.pg.query<{ uuid: string; nickname: string; description: string }>(
      `SELECT uuid, nickname, description FROM users WHERE uuid = $1`,
      [uuid]
    );

    const defaultNickname = `user_${uuid.replace(/-/g, '').substring(0, 6).toUpperCase()}`;
    const user = rows[0] || {
      uuid,
      nickname: defaultNickname,
      description: ''
    };

    // 총 추천수 조회
    const { rows: likesRows } = await fastify.pg.query<{ total_likes: string }>(
      `SELECT COALESCE(SUM(rs.likes), 0) AS total_likes
       FROM routes r
       LEFT JOIN route_stats rs ON r.route_code = rs.route_code
       WHERE r.uploader_uuid = $1`,
      [uuid]
    );
    const likesReceived = Number(likesRows[0]?.total_likes ?? 0);

    // 만든 루트 목록 조회
    const { rows: routes } = await fastify.pg.query<Route>(
      `${ROUTE_SELECT} WHERE r.uploader_uuid = $1 ORDER BY r.uploaded_at DESC`,
      [uuid]
    );

    return {
      uuid: user.uuid,
      nickname: user.nickname,
      description: user.description,
      likes_received: likesReceived,
      routes
    };
  });

  // ──────────────────────────────────────────────
  // PUT /api/users/profile — 본인 프로필 수정
  // ──────────────────────────────────────────────
  fastify.put<{ Body: { nickname: string; description?: string } }>('/api/users/profile', async (req, reply) => {
    const { nickname, description = '' } = req.body ?? {};

    if (!nickname || typeof nickname !== 'string' || nickname.trim().length === 0) {
      return reply.code(400).send({ error: '닉네임은 필수이며 빈 칸일 수 없습니다.' });
    }
    if (nickname.length > 50) {
      return reply.code(400).send({ error: '닉네임은 최대 50자까지 입력 가능합니다.' });
    }
    if (description && description.length > 500) {
      return reply.code(400).send({ error: '소개 글은 최대 500자까지 입력 가능합니다.' });
    }

    let uploaderUuid: string;
    try {
      uploaderUuid = await verifyRequestSignature(fastify.pg, req, 'update_profile');
    } catch (err) {
      return reply.code(401).send({ error: (err as Error).message });
    }

    await fastify.pg.query(
      `INSERT INTO users (uuid, nickname, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (uuid)
       DO UPDATE SET nickname = EXCLUDED.nickname, description = EXCLUDED.description`,
      [uploaderUuid, nickname.trim(), description.trim()]
    );

    return { success: true, nickname: nickname.trim(), description: description.trim() };
  });

  // ──────────────────────────────────────────────
  // POST /api/users/migrate — 신원 이관 (B-1)
  // 이중 서명(구 키 + 신규 키)으로 무결성 검사 후, 구 UUID 의 데이터를 신규 UUID 로
  // 옮기고 구 공개키를 폐기 목록에 추가한다. body: { new_pubkey }.
  //   - 구 키 서명: 표준 헤더(x-guida-pubkey/-timestamp/-signature), action 'migrate'.
  //   - 신규 키 서명: x-guida-new-signature (구 키와 동일 메시지 서명 → 구↔신 바인딩).
  //   body 에 new_pubkey 가 포함되므로 두 서명 모두 new_pubkey 에 묶여 리플레이/치환 불가.
  // ──────────────────────────────────────────────
  fastify.post<{ Body: { new_pubkey?: string } }>(
    '/api/users/migrate',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          errorResponseBuilder: (_req, context) => ({
            error: `키 이관은 1분에 최대 5회만 가능합니다. ${context.after} 후에 다시 시도하세요.`,
          }),
        },
      },
    },
    async (req, reply) => {
      const newPubkey = req.body?.new_pubkey;
      if (!newPubkey || typeof newPubkey !== 'string') {
        return reply.code(400).send({ error: 'new_pubkey 가 필요합니다.' });
      }

      const oldPubkey = req.headers['x-guida-pubkey'] as string | undefined;
      const timestampStr = req.headers['x-guida-timestamp'] as string | undefined;
      const nonce = req.headers['x-guida-nonce'] as string | undefined;
      const newSignature = req.headers['x-guida-new-signature'] as string | undefined;

      // 1) 구 키 서명 검증(+폐기 검사 + nonce 소비) → oldUuid.
      //    nonce 는 이 1회만 소비되고, 아래 신규 키 검증은 동일 메시지를 재검증한다.
      let oldUuid: string;
      try {
        oldUuid = await verifyRequestSignature(fastify.pg, req, 'migrate');
      } catch (err) {
        return reply.code(401).send({ error: (err as Error).message });
      }

      // 2) 신규 키 서명 검증 (구 키와 동일 메시지: nonce 포함)
      if (!newSignature || !timestampStr || !nonce) {
        return reply.code(400).send({ error: '신규 키 서명 헤더가 누락되었습니다.' });
      }
      const bodyHash = crypto.createHash('sha256').update(req.rawBody || '').digest('hex');
      const message = `migrate:${timestampStr}:${nonce}:${bodyHash}`;
      let newValid = false;
      try {
        newValid = ed25519Verify(newPubkey, message, newSignature);
      } catch (e) {
        return reply.code(401).send({ error: `신규 키 검증 오류: ${(e as Error).message}` });
      }
      if (!newValid) {
        return reply.code(401).send({ error: '신규 키 서명 검증에 실패했습니다.' });
      }
      try {
        await assertNotRevoked(fastify.pg, newPubkey);
      } catch (err) {
        return reply.code(401).send({ error: (err as Error).message });
      }

      const newUuid = uuidv5(newPubkey);
      if (oldPubkey === newPubkey || oldUuid === newUuid) {
        return reply.code(400).send({ error: '신규 키가 기존 키와 동일합니다.' });
      }

      // 3) 트랜잭션: 데이터 이관 + 구 키 폐기
      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');
        // 루트 소유권 이전
        await client.query(`UPDATE routes SET uploader_uuid = $1 WHERE uploader_uuid = $2`, [
          newUuid,
          oldUuid,
        ]);
        // 추천 원장: 신규가 이미 추천한 (route, patch) 와 충돌하지 않는 것만 이전, 나머지 폐기
        await client.query(
          `UPDATE route_likes SET uuid = $1
           WHERE uuid = $2 AND NOT EXISTS (
             SELECT 1 FROM route_likes rl2
             WHERE rl2.uuid = $1
               AND rl2.route_code = route_likes.route_code
               AND rl2.patch_version = route_likes.patch_version
           )`,
          [newUuid, oldUuid],
        );
        await client.query(`DELETE FROM route_likes WHERE uuid = $1`, [oldUuid]);
        // 프로필 이전 (신규 UUID 행이 없을 때만)
        await client.query(
          `UPDATE users SET uuid = $1
           WHERE uuid = $2 AND NOT EXISTS (SELECT 1 FROM users WHERE uuid = $1)`,
          [newUuid, oldUuid],
        );
        // 구 공개키 폐기
        await client.query(
          `INSERT INTO revoked_keys (pubkey) VALUES ($1) ON CONFLICT (pubkey) DO NOTHING`,
          [oldPubkey],
        );
        await client.query('COMMIT');
        return { success: true, new_uuid: newUuid };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );
}

