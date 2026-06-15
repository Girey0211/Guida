import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { getSql } from '../db.js';
import { GAME_DATA, PATCH_VERSION_FILE } from '../data.js';

/**
 * /api/game/* — 게임 데이터 서빙 (기존 gameData.ts 포팅).
 *
 * - GET /api/game/patch     : 현재 패치 버전 (config 테이블 우선, JSON 폴백)
 * - GET /api/game/:resource : 게임 데이터 파일 (gifts | packs | events | dependencies | dungeon_meta | prisoners)
 */
const gameData = new Hono<AppEnv>();

gameData.get('/api/game/patch', async (c) => {
  const sql = getSql(c.env);

  // 최소 허용 앱 버전(강제 업데이트 차단선) — config 우선, 없으면 JSON 폴백
  let minAppVersion: string | undefined;
  try {
    const rows = (await sql(
      `SELECT value FROM config WHERE key = 'min_app_version'`,
    )) as { value: string }[];
    if (rows[0]) minAppVersion = rows[0].value;
  } catch {
    // config 조회 실패 시 JSON 폴백으로 진행
  }

  // 1순위: config 테이블의 current_patch
  try {
    const rows = (await sql(
      `SELECT value FROM config WHERE key = 'current_patch'`,
    )) as { value: string }[];
    if (rows[0]) {
      return c.json({ patch_version: rows[0].value, min_app_version: minAppVersion });
    }
  } catch {
    // 조회 실패 시 JSON 폴백
  }

  // 2순위: data/patch_version.json
  const parsed = PATCH_VERSION_FILE;
  const patchVersion = parsed.patch_version ?? parsed.current_patch;
  if (minAppVersion === undefined) minAppVersion = parsed.min_app_version;
  if (patchVersion) {
    return c.json({ patch_version: patchVersion, min_app_version: minAppVersion });
  }

  return c.json({ error: '패치 버전을 확인할 수 없습니다.' }, 500);
});

// gifts / packs / events / dependencies / dungeon_meta / prisoners 정적 서빙.
// 데이터는 번들에 포함돼 있어 미니파이 캐시가 필요 없다(이미 문자열로 보관).
gameData.get('/api/game/:resource', (c) => {
  const body = GAME_DATA[c.req.param('resource')];
  if (body === undefined) {
    return c.json({ error: '존재하지 않는 게임 데이터입니다.' }, 404);
  }
  return c.body(body, 200, { 'content-type': 'application/json; charset=utf-8' });
});

export default gameData;
