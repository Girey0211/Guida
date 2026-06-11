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

function verifyRequestSignature(req: any, action: string): string {
  const pubkey = req.headers['x-guida-pubkey'];
  const timestampStr = req.headers['x-guida-timestamp'];
  const signature = req.headers['x-guida-signature'];

  if (!pubkey || !timestampStr || !signature) {
    throw new Error('보안 서명 헤더가 누락되었습니다.');
  }

  const timestamp = parseInt(timestampStr, 10);
  const now = Date.now();
  if (isNaN(timestamp) || Math.abs(now - timestamp) > 5 * 60 * 1000) {
    throw new Error('요청이 만료되었거나 타임스탬프가 유효하지 않습니다.');
  }

  const rawBody = req.rawBody || '';
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const message = `${action}:${timestampStr}:${bodyHash}`;

  try {
    // 32바이트 raw Ed25519 공개키에 12바이트 SPKI DER 헤더를 접두사로 추가하여 DER 포맷 키 객체를 재구성합니다.
    const rawKeyBuffer = Buffer.from(pubkey, 'hex');
    const derHeader = Buffer.from('302a300506032b6570032100', 'hex');
    const publicKeyDer = Buffer.concat([derHeader, rawKeyBuffer]);

    const publicKeyObject = crypto.createPublicKey({
      key: publicKeyDer,
      format: 'der',
      type: 'spki'
    });

    const isValid = crypto.verify(
      null,
      Buffer.from(message),
      publicKeyObject,
      Buffer.from(signature, 'hex')
    );

    if (!isValid) {
      throw new Error('서명 검증에 실패했습니다.');
    }
  } catch (e) {
    throw new Error(`보안 검증 오류: ${(e as Error).message}`);
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
  RouteType,
  VerifiedMethod,
} from '../types/index.js';

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const VALID_DIFFICULTY_TAG: DifficultyTag[] = ['쉬움', '보통', '어려움'];
const VALID_DIFFICULTY_MODE: DifficultyMode[] = ['normal', 'hard', 'extreme'];
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
    r.difficulty_tag,
    r.route_type,
    r.difficulty_mode,
    r.difficulty_switch_floor,
    r.target_rewards,
    r.floors,
    r.gift_order,
    r.pack_order,
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
    const { patch, sort = 'likes', difficulty_tag, difficulty_mode, route_type, min_likes } =
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
      uuid,
      name,
      difficulty_tag,
      route_type,
      difficulty_mode,
      difficulty_switch_floor = null,
      target_rewards,
      floors,
      gift_order = [],
      pack_order = [],
      memo = null,
      verified_method,
    } = body;

    // 필수 필드 검증
    if (
      !uuid ||
      !name ||
      !VALID_DIFFICULTY_TAG.includes(difficulty_tag) ||
      !VALID_ROUTE_TYPE.includes(route_type) ||
      !VALID_DIFFICULTY_MODE.includes(difficulty_mode) ||
      (difficulty_switch_floor !== null && typeof difficulty_switch_floor !== 'number') ||
      !Array.isArray(target_rewards) ||
      !Array.isArray(floors) ||
      !Array.isArray(gift_order) ||
      !Array.isArray(pack_order) ||
      !VALID_VERIFIED.includes(verified_method)
    ) {
      return reply.code(400).send({ error: '필수 필드가 누락되었거나 형식이 올바르지 않습니다.' });
    }

    let uploaderUuid: string;
    try {
      uploaderUuid = verifyRequestSignature(req, 'upload');
    } catch (err) {
      return reply.code(401).send({ error: (err as Error).message });
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
               (route_code, name, patch_version, difficulty_tag, route_type,
                difficulty_mode, difficulty_switch_floor, target_rewards, floors,
                gift_order, pack_order, memo, verified_method, uploader_uuid)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              code,
              name,
              patchVersion,
              difficulty_tag,
              route_type,
              difficulty_mode,
              difficulty_switch_floor,
              target_rewards,
              floors,
              JSON.stringify(gift_order), // JSONB 컬럼: 배열을 문자열로 직렬화해 전달
              JSON.stringify(pack_order),
              memo,
              verified_method,
              uploaderUuid,
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
        uuid,
        name,
        difficulty_tag,
        route_type,
        difficulty_mode,
        difficulty_switch_floor = null,
        target_rewards,
        floors,
        gift_order = [],
        pack_order = [],
        memo = null,
        verified_method,
      } = body;

      // 필수 필드 검증 (업로드와 동일 규칙)
      if (
        !uuid ||
        !name ||
        !VALID_DIFFICULTY_TAG.includes(difficulty_tag) ||
        !VALID_ROUTE_TYPE.includes(route_type) ||
        !VALID_DIFFICULTY_MODE.includes(difficulty_mode) ||
        (difficulty_switch_floor !== null && typeof difficulty_switch_floor !== 'number') ||
        !Array.isArray(target_rewards) ||
        !Array.isArray(floors) ||
        !Array.isArray(gift_order) ||
        !Array.isArray(pack_order) ||
        !VALID_VERIFIED.includes(verified_method)
      ) {
        return reply.code(400).send({ error: '필수 필드가 누락되었거나 형식이 올바르지 않습니다.' });
      }

      let uploaderUuid: string;
      try {
        uploaderUuid = verifyRequestSignature(req, 'update');
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
           route_type = $4,
           difficulty_mode = $5,
           difficulty_switch_floor = $6,
           target_rewards = $7,
           floors = $8,
           gift_order = $9,
           pack_order = $10,
           memo = $11,
           verified_method = $12,
           uploaded_at = now()
         WHERE route_code = $1
         RETURNING route_code`,
        [
          code,
          name,
          difficulty_tag,
          route_type,
          difficulty_mode,
          difficulty_switch_floor,
          target_rewards,
          floors,
          JSON.stringify(gift_order),
          JSON.stringify(pack_order),
          memo,
          verified_method,
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

      await fastify.pg.query(
        `INSERT INTO backups (recovery_code_hash, encrypted_blob, uploaded_at)
         VALUES ($1, $2, now())
         ON CONFLICT (recovery_code_hash)
         DO UPDATE SET encrypted_blob = EXCLUDED.encrypted_blob, uploaded_at = now()`,
        [recovery_code_hash, encrypted_blob],
      );

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
}
