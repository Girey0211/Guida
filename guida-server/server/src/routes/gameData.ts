import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/**
 * /api/game/* — CDN 게임 데이터 서빙 (README §7.1 / §8.5, phase2 dev plan §1·§7).
 *
 * 앱 시작 시 manifest.json 으로 파일별 콘텐츠 해시를 비교하고, 변경된 데이터
 * 파일만 내려받는다. 이미지는 content-addressed(<hash>) 로 lazy 서빙한다.
 *
 * - GET /api/game/patch          : 현재 패치 버전 (config 테이블 기준, JSON 파일 폴백)
 * - GET /api/game/manifest       : 파일별 해시 매니페스트 (ETag/304 지원)
 * - GET /api/game/image/:hash    : content-addressed 기프트 아이콘 (immutable 캐시)
 * - GET /api/game/:resource      : 게임 데이터 파일 (gifts | packs | events | dependencies | dungeon_meta)
 */

interface ManifestEntry {
  hash: string;
  size: number;
}
interface Manifest {
  schema_version: string;
  patch_version: string;
  generated_at: string;
  data: Record<string, ManifestEntry>;
  images: Record<string, ManifestEntry>;
}

/** 서빙 허용 리소스 → 실제 파일명. 화이트리스트로 경로 조작(traversal) 차단. */
const GAME_DATA_FILES: Record<string, string> = {
  gifts: 'gifts.json',
  packs: 'packs.json',
  events: 'events.json',
  dependencies: 'dependencies.json',
  // 시즌 메타: 시작 기프트 / 별의 가호 / EXTREME 제약 (README §8.5)
  dungeon_meta: 'dungeon_meta.json',
  // 수감자 편성 데이터 (README §8.5)
  prisoners: 'prisoners.json',
};

export default async function gameDataRoutes(fastify: FastifyInstance) {
  // 데이터 디렉터리. Docker 컨테이너에서는 /app/data 로 마운트된다.
  const dataDir = process.env.DATA_DIR ?? resolve(process.cwd(), '../data');
  const imagesDir = join(dataDir, 'images');
  const manifestPath = join(dataDir, 'manifest.json');

  /**
   * 매니페스트 + content-addressed 역인덱스 캐시.
   * 매니페스트 파일의 mtime 이 바뀌면(재생성) 자동으로 다시 로드한다.
   *  - etag      : 매니페스트 본문 해시 (If-None-Match 비교용)
   *  - body      : 매니페스트 원본 문자열
   *  - hashToFile: 이미지 콘텐츠 해시 → 원본 파일명 (gift_id + .webp)
   */
  let manifestCache:
    | { mtimeMs: number; etag: string; body: string; hashToFile: Map<string, string> }
    | null = null;

  async function loadManifest() {
    const st = await stat(manifestPath);
    if (manifestCache && manifestCache.mtimeMs === st.mtimeMs) {
      return manifestCache;
    }
    const body = await readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(body) as Manifest;
    const etag = '"' + createHash('sha256').update(body).digest('hex') + '"';
    const hashToFile = new Map<string, string>();
    for (const [giftId, entry] of Object.entries(parsed.images ?? {})) {
      // 이미지 파일명 = gift_id + .webp (generate-manifest.mjs 와 동일 규약)
      hashToFile.set(entry.hash, `${giftId}.webp`);
    }
    manifestCache = { mtimeMs: st.mtimeMs, etag, body, hashToFile };
    return manifestCache;
  }

  // GET /api/game/manifest — 파일별 해시 매니페스트. ETag/If-None-Match 로 304 지원.
  fastify.get('/api/game/manifest', async (req, reply) => {
    let cache;
    try {
      cache = await loadManifest();
    } catch (err) {
      fastify.log.error({ err }, 'manifest.json 을 불러올 수 없습니다.');
      return reply.code(500).send({ error: '매니페스트를 불러올 수 없습니다.' });
    }

    // 클라이언트가 보유한 ETag 와 동일하면 본문 전송 생략(304).
    const inm = req.headers['if-none-match'];
    if (inm && inm === cache.etag) {
      return reply.code(304).header('etag', cache.etag).send();
    }

    reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('etag', cache.etag)
      // 매니페스트는 항상 최신을 확인해야 하므로 재검증 강제(본문은 304로 절약).
      .header('cache-control', 'no-cache');
    return cache.body;
  });

  // GET /api/game/image/:hash — content-addressed 아이콘 서빙.
  // 파일명이 곧 콘텐츠 해시라 불변이므로 장기 immutable 캐시를 건다.
  fastify.get<{ Params: { hash: string } }>('/api/game/image/:hash', async (req, reply) => {
    // :hash 는 "sha256:<hex>" 또는 "<hex>" 둘 다 허용. 매니페스트 키는 "sha256:" 접두.
    const raw = decodeURIComponent(req.params.hash).replace(/\.webp$/i, '');
    const hash = raw.startsWith('sha256:') ? raw : `sha256:${raw}`;

    let cache;
    try {
      cache = await loadManifest();
    } catch (err) {
      fastify.log.error({ err }, '이미지 서빙용 매니페스트 로드 실패');
      return reply.code(500).send({ error: '매니페스트를 불러올 수 없습니다.' });
    }

    const fileName = cache.hashToFile.get(hash);
    if (!fileName) {
      return reply.code(404).send({ error: '해당 해시의 이미지를 찾을 수 없습니다.' });
    }

    try {
      const buf = await readFile(join(imagesDir, fileName));
      return reply
        .header('content-type', 'image/webp')
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('etag', `"${hash}"`)
        .send(buf);
    } catch (err) {
      fastify.log.error({ err, hash }, '이미지 파일 읽기 실패');
      return reply.code(404).send({ error: '이미지 파일을 찾을 수 없습니다.' });
    }
  });

  fastify.get('/api/game/patch', async (_req, reply) => {
    // 최소 허용 앱 버전(강제 업데이트 비상 차단선)을 config 에서 우선 조회한다.
    // 없으면 JSON 파일의 min_app_version 으로 폴백한다.
    let minAppVersion: string | undefined;
    try {
      const { rows } = await fastify.pg.query<{ value: string }>(
        `SELECT value FROM config WHERE key = 'min_app_version'`,
      );
      if (rows[0]) minAppVersion = rows[0].value;
    } catch (err) {
      fastify.log.warn({ err }, 'config(min_app_version) 조회 실패, JSON 파일로 폴백');
    }

    // 1순위: config 테이블의 current_patch
    try {
      const { rows } = await fastify.pg.query<{ value: string }>(
        `SELECT value FROM config WHERE key = 'current_patch'`,
      );
      if (rows[0]) {
        return { patch_version: rows[0].value, min_app_version: minAppVersion };
      }
    } catch (err) {
      fastify.log.warn({ err }, 'config 테이블 조회 실패, JSON 파일로 폴백');
    }

    // 2순위: data/patch_version.json
    try {
      const raw = await readFile(resolve(dataDir, 'patch_version.json'), 'utf-8');
      const parsed = JSON.parse(raw) as {
        patch_version?: string;
        current_patch?: string;
        min_app_version?: string;
      };
      const patchVersion = parsed.patch_version ?? parsed.current_patch;
      // config 값이 없으면 JSON 의 min_app_version 사용
      if (minAppVersion === undefined) minAppVersion = parsed.min_app_version;
      if (patchVersion) {
        return { patch_version: patchVersion, min_app_version: minAppVersion };
      }
      throw new Error('patch_version.json 에 패치 버전 필드가 없습니다.');
    } catch (err) {
      fastify.log.error({ err }, '패치 버전을 확인할 수 없습니다.');
      return reply.code(500).send({ error: '패치 버전을 확인할 수 없습니다.' });
    }
  });

  // 인메모리 캐시 (파일명 -> 미니파이된 JSON 문자열)
  const minifiedCache = new Map<string, string>();

  // gifts / packs / events / dependencies 를 각각 정적 JSON 파일 그대로 내려준다.
  fastify.get<{ Params: { resource: string } }>('/api/game/:resource', async (req, reply) => {
    const fileName = GAME_DATA_FILES[req.params.resource];
    if (!fileName) {
      return reply.code(404).send({ error: '존재하지 않는 게임 데이터입니다.' });
    }

    const isProd = process.env.NODE_ENV === 'production';

    // 프로덕션 환경인 경우 캐시 확인 및 즉시 반환
    if (isProd && minifiedCache.has(fileName)) {
      reply.header('content-type', 'application/json; charset=utf-8');
      return minifiedCache.get(fileName);
    }

    try {
      const raw = await readFile(resolve(dataDir, fileName), 'utf-8');
      
      // JSON 파싱 후 공백 없이 문자열화 (Minify)
      const minified = JSON.stringify(JSON.parse(raw));
      
      if (isProd) {
        minifiedCache.set(fileName, minified);
      }

      reply.header('content-type', 'application/json; charset=utf-8');
      return minified;
    } catch (err) {
      fastify.log.error({ err, resource: req.params.resource }, '게임 데이터를 불러올 수 없습니다.');
      return reply.code(500).send({ error: '게임 데이터를 불러올 수 없습니다.' });
    }
  });
}
