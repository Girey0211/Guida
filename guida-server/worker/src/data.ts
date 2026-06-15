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
