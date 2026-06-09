/**
 * 게임 데이터 동기화 API.
 *
 * 동작 (README 데이터 흐름도 7.1):
 *  1. CDN(여기서는 public/data, 추후 GitHub Raw → Cloudflare)에서 최신
 *     game_data.json + patch_version.json 을 가져온다.
 *  2. 성공 시 로컬에 캐시(game_data.cache.json)한다.
 *  3. 서버 다운/오프라인 시 마지막 로컬 캐시본으로 100% 동작한다.
 */

import type { GameData, PatchInfo } from "@/types/gameData";
import { readJson, writeJson } from "@/lib/storage";

/** 추후 GitHub Raw / Cloudflare 로 교체될 데이터 베이스 경로 */
const DATA_BASE =
  (import.meta.env.VITE_DATA_BASE_URL as string | undefined) ?? "/data";

const GAME_DATA_CACHE = "game_data.cache.json";
const PATCH_CACHE = "patch_version.cache.json";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}/${path}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${path}`);
  return (await res.json()) as T;
}

export interface SyncResult {
  gameData: GameData;
  patch: PatchInfo;
  /** 서버에서 새로 받았는지(true) 캐시 폴백인지(false) */
  fromNetwork: boolean;
}

/**
 * 게임 데이터와 패치 정보를 동기화한다.
 * 네트워크 실패 시 캐시 폴백, 캐시도 없으면 throw.
 */
export async function syncGameData(): Promise<SyncResult> {
  try {
    const [gameData, patch] = await Promise.all([
      fetchJson<GameData>("game_data.json"),
      fetchJson<PatchInfo>("patch_version.json"),
    ]);
    // 캐시 갱신
    await Promise.all([
      writeJson(GAME_DATA_CACHE, gameData),
      writeJson(PATCH_CACHE, patch),
    ]);
    return { gameData, patch, fromNetwork: true };
  } catch (err) {
    console.warn("[gameData] 네트워크 동기화 실패 — 로컬 캐시 폴백 시도", err);
    const gameData = await readJson<GameData | null>(GAME_DATA_CACHE, null);
    const patch = await readJson<PatchInfo | null>(PATCH_CACHE, null);
    if (gameData && patch) {
      return { gameData, patch, fromNetwork: false };
    }
    throw new Error("게임 데이터를 불러올 수 없습니다 (네트워크 실패 + 캐시 없음).");
  }
}
