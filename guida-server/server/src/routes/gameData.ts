import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * /api/game/* — CDN 게임 데이터 서빙 (README §7.1 / §8.5).
 *
 * 앱 시작 시 patch 버전을 확인하고, 변경된 데이터 파일만 병렬로 내려받는다.
 *
 * - GET /api/game/patch          : 현재 패치 버전 (config 테이블 기준, JSON 파일 폴백)
 * - GET /api/game/:resource      : 게임 데이터 파일 (gifts | packs | events | dependencies | dungeon_meta)
 */

/** 서빙 허용 리소스 → 실제 파일명. 화이트리스트로 경로 조작(traversal) 차단. */
const GAME_DATA_FILES: Record<string, string> = {
  gifts: 'gifts.json',
  packs: 'packs.json',
  events: 'events.json',
  dependencies: 'dependencies.json',
  // 시즌 메타: 시작 기프트 / 별의 가호 / EXTREME 제약 (README §8.5)
  dungeon_meta: 'dungeon_meta.json',
};

export default async function gameDataRoutes(fastify: FastifyInstance) {
  // 데이터 디렉터리. Docker 컨테이너에서는 /app/data 로 마운트된다.
  const dataDir = process.env.DATA_DIR ?? resolve(process.cwd(), '../data');

  fastify.get('/api/game/patch', async (_req, reply) => {
    // 1순위: config 테이블의 current_patch
    try {
      const { rows } = await fastify.pg.query<{ value: string }>(
        `SELECT value FROM config WHERE key = 'current_patch'`,
      );
      if (rows[0]) {
        return { patch_version: rows[0].value };
      }
    } catch (err) {
      fastify.log.warn({ err }, 'config 테이블 조회 실패, JSON 파일로 폴백');
    }

    // 2순위: data/patch_version.json
    try {
      const raw = await readFile(resolve(dataDir, 'patch_version.json'), 'utf-8');
      const parsed = JSON.parse(raw) as { patch_version?: string; current_patch?: string };
      const patchVersion = parsed.patch_version ?? parsed.current_patch;
      if (patchVersion) {
        return { patch_version: patchVersion };
      }
      throw new Error('patch_version.json 에 패치 버전 필드가 없습니다.');
    } catch (err) {
      fastify.log.error({ err }, '패치 버전을 확인할 수 없습니다.');
      return reply.code(500).send({ error: '패치 버전을 확인할 수 없습니다.' });
    }
  });

  // gifts / packs / events / dependencies 를 각각 정적 JSON 파일 그대로 내려준다.
  fastify.get<{ Params: { resource: string } }>('/api/game/:resource', async (req, reply) => {
    const fileName = GAME_DATA_FILES[req.params.resource];
    if (!fileName) {
      return reply.code(404).send({ error: '존재하지 않는 게임 데이터입니다.' });
    }

    try {
      const raw = await readFile(resolve(dataDir, fileName), 'utf-8');
      reply.header('content-type', 'application/json; charset=utf-8');
      return raw;
    } catch (err) {
      fastify.log.error({ err, resource: req.params.resource }, '게임 데이터를 불러올 수 없습니다.');
      return reply.code(500).send({ error: '게임 데이터를 불러올 수 없습니다.' });
    }
  });
}
