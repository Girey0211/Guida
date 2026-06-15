// 게임 데이터 JSON 을 번들에 포함시킨다.
// 기존 서버는 디스크에서 readFile 했지만 Workers 에는 파일시스템이 없으므로
// 빌드 타임에 import 하여 번들에 박는다. (단일 소스: guida-server/data/*.json)
//
// 나중에 데이터를 자주 갱신하려면 docs/cdn-data-plan.md 대로
// Static Assets / R2 / 별도 CDN 으로 분리하는 것을 고려한다.
import gifts from '../../data/gifts.json';
import packs from '../../data/packs.json';
import events from '../../data/events.json';
import dependencies from '../../data/dependencies.json';
import dungeonMeta from '../../data/dungeon_meta.json';
import prisoners from '../../data/prisoners.json';
import patchVersion from '../../data/patch_version.json';

/** 서빙 허용 리소스(화이트리스트) → 미니파이된 JSON 문자열. */
export const GAME_DATA: Record<string, string> = {
  gifts: JSON.stringify(gifts),
  packs: JSON.stringify(packs),
  events: JSON.stringify(events),
  dependencies: JSON.stringify(dependencies),
  dungeon_meta: JSON.stringify(dungeonMeta),
  prisoners: JSON.stringify(prisoners),
};

/** patch_version.json 폴백 값 (DB config 가 없을 때 사용). */
export const PATCH_VERSION_FILE = patchVersion as {
  patch_version?: string;
  current_patch?: string;
  min_app_version?: string;
};

/**
 * 정적 CDN 서빙용 매핑: 클라(guida-client/src/api/gameData.ts)가 요청하는
 * `.json` 파일명을 그대로 키로 둔다. (`/data/<파일명>` 으로 노출)
 *
 * 데이터는 빌드 타임에 번들로 박히므로 git push → Workers 자동 재배포 시
 * 최신 JSON 이 그대로 반영된다. (docs/cdn-data-plan.md Phase 2)
 *
 * game_data.json 은 현재 미배포(번들에 없음)라 의도적으로 제외 — 클라는
 * 해당 파일을 fetchOptional 로 받아 404 시 null 폴백한다.
 */
export const DATA_FILES: Record<string, string> = {
  'gifts.json': GAME_DATA.gifts,
  'packs.json': GAME_DATA.packs,
  'events.json': GAME_DATA.events,
  'dependencies.json': GAME_DATA.dependencies,
  'dungeon_meta.json': GAME_DATA.dungeon_meta,
  'prisoners.json': GAME_DATA.prisoners,
  'patch_version.json': JSON.stringify(patchVersion),
};
