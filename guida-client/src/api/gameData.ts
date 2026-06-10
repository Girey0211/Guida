/**
 * 게임 데이터 동기화 API.
 *
 * 동작 (README 데이터 흐름도 7.1):
 *  1. CDN(여기서는 public/data, 추후 GitHub Raw → Cloudflare)에서 최신
 *     game_data.json + patch_version.json + dungeon_meta.json 을 가져온다.
 *  2. 성공 시 로컬에 캐시한다.
 *  3. 서버 다운/오프라인 시 마지막 로컬 캐시본으로 100% 동작한다.
 *
 * dungeon_meta.json 은 시즌 메타(시작 기프트 / 가호 / EXTREME 제약)로,
 * 패치마다 바뀌지 않고 시즌 교체 시에만 갱신되지만(README §8.5) 로딩/캐시
 * 흐름은 동일하게 다룬다. 없으면 null 로 폴백(루트 작성기에서 선택지 비표시).
 */

import type {
  DungeonMeta,
  GameData,
  Gift,
  GiftDependency,
  Pack,
  PatchInfo,
} from "@/types/gameData";
import { readJson, writeJson } from "@/lib/storage";

/** 추후 GitHub Raw / Cloudflare 로 교체될 데이터 베이스 경로 */
const DATA_BASE =
  (import.meta.env.VITE_DATA_BASE_URL as string | undefined) ?? "/data";

const GAME_DATA_CACHE = "game_data.cache.json";
const PATCH_CACHE = "patch_version.cache.json";
const DUNGEON_META_CACHE = "dungeon_meta.cache.json";
const GIFTS_CACHE = "gifts.cache.json";
const PACKS_CACHE = "packs.cache.json";
const DEPENDENCIES_CACHE = "dependencies.cache.json";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}/${path}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${path}`);
  return (await res.json()) as T;
}

/** 부가 데이터 fetch — 실패해도 전체 동기화를 막지 않고 폴백값을 반환한다. */
async function fetchOptional<T>(path: string, fallback: T): Promise<T> {
  try {
    return await fetchJson<T>(path);
  } catch (e) {
    console.warn(`[gameData] ${path} 로드 실패 — 폴백 사용`, e);
    return fallback;
  }
}

export interface SyncResult {
  /** 거던 이벤트/선택지 가이드 데이터. 데이터 미배포 시 null (오버레이 가이드 비활성) */
  gameData: GameData | null;
  patch: PatchInfo;
  /** 시즌 메타 (없으면 null) */
  dungeonMeta: DungeonMeta | null;
  /** 에고기프트 카탈로그 (루트 작성기용, 없으면 빈 배열) */
  gifts: Gift[];
  /** 팩 카탈로그 (루트 작성기용, 없으면 빈 배열) */
  packs: Pack[];
  /** 기프트 순서 의존성 (플레이화면 🔒 선행조건 판정용, 없으면 빈 배열) */
  dependencies: GiftDependency[];
  /** 서버에서 새로 받았는지(true) 캐시 폴백인지(false) */
  fromNetwork: boolean;
}

/**
 * 게임 데이터와 패치 정보, 시즌 메타, 기프트/팩 카탈로그를 동기화한다 (README §8.5).
 * 네트워크 실패 시 캐시 폴백, 핵심 데이터(게임 데이터/패치) 캐시도 없으면 throw.
 * 시즌 메타·카탈로그는 부가 데이터라 개별 실패 시 비어도 앱은 동작한다.
 */
export async function syncGameData(): Promise<SyncResult> {
  try {
    const [gameData, patch, dungeonMeta, gifts, packs, dependencies] = await Promise.all([
      // 이벤트/선택지 가이드 데이터는 아직 미배포 → 없으면 null 로 폴백 (앱 부팅 비차단)
      fetchOptional<GameData | null>("game_data.json", null),
      fetchJson<PatchInfo>("patch_version.json"),
      fetchOptional<DungeonMeta | null>("dungeon_meta.json", null),
      fetchOptional<Gift[]>("gifts.json", []),
      fetchOptional<Pack[]>("packs.json", []),
      fetchOptional<GiftDependency[]>("dependencies.json", []),
    ]);
    // 캐시 갱신
    await Promise.all([
      gameData ? writeJson(GAME_DATA_CACHE, gameData) : Promise.resolve(),
      writeJson(PATCH_CACHE, patch),
      dungeonMeta ? writeJson(DUNGEON_META_CACHE, dungeonMeta) : Promise.resolve(),
      writeJson(GIFTS_CACHE, gifts),
      writeJson(PACKS_CACHE, packs),
      writeJson(DEPENDENCIES_CACHE, dependencies),
    ]);
    return { gameData, patch, dungeonMeta, gifts, packs, dependencies, fromNetwork: true };
  } catch (err) {
    console.warn("[gameData] 네트워크 동기화 실패 — 로컬 캐시 폴백 시도", err);
    const gameData = await readJson<GameData | null>(GAME_DATA_CACHE, null);
    const patch = await readJson<PatchInfo | null>(PATCH_CACHE, null);
    const dungeonMeta = await readJson<DungeonMeta | null>(DUNGEON_META_CACHE, null);
    const gifts = await readJson<Gift[]>(GIFTS_CACHE, []);
    const packs = await readJson<Pack[]>(PACKS_CACHE, []);
    const dependencies = await readJson<GiftDependency[]>(DEPENDENCIES_CACHE, []);
    // 패치 정보만 있으면 부팅 가능 (gameData 는 선택적)
    if (patch) {
      return { gameData, patch, dungeonMeta, gifts, packs, dependencies, fromNetwork: false };
    }
    throw new Error("게임 데이터를 불러올 수 없습니다 (네트워크 실패 + 캐시 없음).");
  }
}
