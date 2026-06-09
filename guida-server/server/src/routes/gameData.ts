import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * /api/game/* — 게임 데이터 서빙.
 *
 * - GET /api/game/patch : 현재 패치 버전 (config 테이블 기준, JSON 파일 폴백)
 * - GET /api/game/data  : 거던 이벤트/선택지/보상 전체 데이터 (data/game_data.json)
 */
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
      const parsed = JSON.parse(raw) as { patch_version: string };
      return { patch_version: parsed.patch_version };
    } catch (err) {
      fastify.log.error({ err }, '패치 버전을 확인할 수 없습니다.');
      return reply.code(500).send({ error: '패치 버전을 확인할 수 없습니다.' });
    }
  });

  fastify.get('/api/game/data', async (_req, reply) => {
    try {
      const raw = await readFile(resolve(dataDir, 'game_data.json'), 'utf-8');
      reply.header('content-type', 'application/json; charset=utf-8');
      return raw;
    } catch (err) {
      fastify.log.error({ err }, '게임 데이터를 불러올 수 없습니다.');
      return reply.code(500).send({ error: '게임 데이터를 불러올 수 없습니다.' });
    }
  });
}
