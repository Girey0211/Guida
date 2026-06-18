/**
 * 게임 데이터 동기화 API (phase2 dev plan §3·§7 S1).
 *
 * 동작:
 *  1. patch_version.json 을 받아 패치 라벨/최소 앱 버전(업데이트 게이트)을 확정한다.
 *     (이 파일은 콘텐츠 해시 매니페스트 밖의 작은 신호라 매번 받는다.)
 *  2. CDN `manifest.json` 만 받아(ETag/304) `manifest.local.json` 과 항목별 해시를
 *     diff 하고, 변경된 JSON 만 다운로드 → 콘텐츠 해시 무결성 검증 후 캐시에 반영한다.
 *  3. 검증·적용이 끝나면 `manifest.local.json` 을 새 매니페스트로 교체한다.
 *  4. 어느 단계든 네트워크 실패 시 마지막 캐시 + 로컬 매니페스트로 100% 동작한다.
 *
 * 매니페스트 적용 실패(검증 실패/부분 전송)는 비치명적이다 — 이번 회차만 롤백하고
 * 기존 캐시로 계속 동작하며 다음 트리거에 재시도한다(phase2 dev plan §6).
 *
 * dungeon_meta.json 은 시즌 메타(시작 기프트 / 가호 / EXTREME 제약)로, 패치마다
 * 바뀌지 않고 시즌 교체 시에만 갱신되지만(README §8.5) 매니페스트 diff 로 동일하게
 * 다룬다. 없으면 null 로 폴백(루트 작성기에서 선택지 비표시).
 */

import type {
  DungeonMeta,
  GameData,
  Gift,
  GiftDependency,
  Pack,
  PatchInfo,
  Sinner,
} from "@/types/gameData";
import { readJson, writeFile, writeJson } from "@/lib/storage";
import { logger } from "@/lib/logger";
import {
  DATA_BASE,
  diffDataFiles,
  downloadAndVerify,
  fetchRemoteManifest,
  loadLocalManifest,
  saveLocalManifest,
} from "@/api/manifestSync";
import { runOrphanImageGc } from "@/api/imageCache";

const GAME_DATA_CACHE = "game_data.cache.json";
const PATCH_CACHE = "patch_version.cache.json";
const DUNGEON_META_CACHE = "dungeon_meta.cache.json";
const GIFTS_CACHE = "gifts.cache.json";
const PACKS_CACHE = "packs.cache.json";
const DEPENDENCIES_CACHE = "dependencies.cache.json";
const PRISONERS_CACHE = "prisoners.cache.json";

/** 매니페스트 data 파일명 → 로컬 캐시 파일명. */
const CACHE_NAME: Record<string, string> = {
  "gifts.json": GIFTS_CACHE,
  "packs.json": PACKS_CACHE,
  "dependencies.json": DEPENDENCIES_CACHE,
  "dungeon_meta.json": DUNGEON_META_CACHE,
  "prisoners.json": PRISONERS_CACHE,
  "events.json": "events.cache.json",
  "phash_index.json": "phash_index.cache.json",
};

/** 매니페스트 data 파일의 로컬 캐시 파일명을 해석한다(미지정 파일은 원래 이름). */
function cacheNameFor(file: string): string {
  return CACHE_NAME[file] ?? file;
}

async function fetchJson<T>(path: string): Promise<T> {
  const startTime = Date.now();
  const fullUrl = new URL(`${DATA_BASE}/${path}`, window.location.origin).href;
  const requestDetails = {
    url: fullUrl,
    method: "GET",
    cache: "no-cache",
  };

  await logger.info("CDN", `Fetching game data: ${fullUrl}`, requestDetails);
  try {
    const res = await fetch(`${DATA_BASE}/${path}`, { cache: "no-cache" });
    const elapsed = Date.now() - startTime;
    const responseHeaders = Object.fromEntries(res.headers.entries());
    const responseDetails: Record<string, any> = {
      url: fullUrl,
      method: "GET",
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
      elapsedMs: elapsed,
    };

    if (!res.ok) {
      let errorBody: any = null;
      try {
        const clone = res.clone();
        errorBody = await clone.json();
      } catch {
        try {
          const clone = res.clone();
          errorBody = await clone.text();
        } catch {}
      }
      responseDetails.error = errorBody || `HTTP ${res.status}`;
      await logger.error("CDN", `Fetch game data failed: ${fullUrl} - Status ${res.status} (${elapsed}ms)`, responseDetails);
      throw new Error(`HTTP ${res.status} — ${path}`);
    }

    let responseBody: any = null;
    try {
      const clone = res.clone();
      responseBody = await clone.json();
    } catch {
      try {
        const clone = res.clone();
        responseBody = await clone.text();
      } catch {}
    }
    responseDetails.body = responseBody;

    await logger.info("CDN", `Fetch game data success: ${fullUrl} - Status ${res.status} (${elapsed}ms)`, responseDetails);
    return responseBody as T;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    await logger.error("CDN", `Fetch game data failed: ${fullUrl} (${elapsed}ms)`, {
      url: fullUrl,
      method: "GET",
      elapsedMs: elapsed,
      error: err instanceof Error ? `${err.name}: ${err.message}` : err,
    });
    throw err;
  }
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
  /** 수감자 편성 데이터 */
  prisoners: Sinner[];
  /** 서버에서 새로 받았는지(true) 캐시 폴백인지(false) */
  fromNetwork: boolean;
}

/**
 * 메모리에 올릴 게임 데이터 묶음을 로컬 캐시에서 조립한다.
 * 매니페스트 diff 로 방금 갱신된 파일은 새 내용이, 나머지는 기존 캐시가 읽힌다.
 */
async function assembleFromCache(
  patch: PatchInfo,
  gameData: GameData | null,
  fromNetwork: boolean,
): Promise<SyncResult> {
  const [gifts, packs, dependencies, dungeonMeta, prisoners] = await Promise.all([
    readJson<Gift[]>(GIFTS_CACHE, []),
    readJson<Pack[]>(PACKS_CACHE, []),
    readJson<GiftDependency[]>(DEPENDENCIES_CACHE, []),
    readJson<DungeonMeta | null>(DUNGEON_META_CACHE, null),
    readJson<Sinner[]>(PRISONERS_CACHE, []),
  ]);
  return { gameData, patch, dungeonMeta, gifts, packs, dependencies, prisoners, fromNetwork };
}

/**
 * 매니페스트 한 회차를 적용한다(checking → diff → downloading → applying).
 * 실패는 throw 하여 호출자가 이번 회차만 롤백하도록 한다(기존 캐시·매니페스트 유지).
 */
async function applyManifestSync(): Promise<void> {
  const local = await loadLocalManifest();
  const mf = await fetchRemoteManifest(local?.etag ?? null);
  if (mf.status === "not-modified") return; // 변경 없음 — 본문 전송 0

  const changed = diffDataFiles(local?.manifest ?? null, mf.manifest);

  // 변경된 data 파일이 있으면 모두 다운로드·검증한 뒤에야 일괄 반영(부분 적용 방지).
  // (이미지만 바뀐 패치는 changed 가 비어도 매니페스트 자체는 갱신·적용된다.)
  if (changed.length > 0) {
    const downloaded = await Promise.all(
      changed.map(async (file) => ({
        name: cacheNameFor(file),
        text: await downloadAndVerify(file, mf.manifest.data[file].hash),
      })),
    );
    await Promise.all(downloaded.map((d) => writeFile(d.name, d.text)));
  }

  // applying: 매니페스트 교체가 성공해야 "적용됨"으로 간주.
  await saveLocalManifest(mf.manifest, mf.etag);
  if (changed.length > 0) {
    await logger.info("Sync", `Data sync applied: ${changed.length} file(s)`, { changed });
  }

  // orphan GC: 적용 성공 이후로만 게이팅(중단 시 캐시 무손상). 실패는 비치명적.
  await runOrphanImageGc(mf.manifest);
}

/**
 * 게임 데이터와 패치 정보, 시즌 메타, 기프트/팩 카탈로그를 동기화한다.
 * 네트워크 실패 시 캐시 폴백, 패치 캐시도 없으면 throw.
 */
export async function syncGameData(): Promise<SyncResult> {
  // 1. 패치/게임데이터(매니페스트 밖, 작은 신호) — 이 fetch 실패는 곧 오프라인 신호.
  let patch: PatchInfo;
  let gameData: GameData | null;
  try {
    [patch, gameData] = await Promise.all([
      fetchJson<PatchInfo>("patch_version.json"),
      // 이벤트/선택지 가이드 데이터는 아직 미배포 → 없으면 null 로 폴백 (앱 부팅 비차단)
      fetchOptional<GameData | null>("game_data.json", null),
    ]);
  } catch (err) {
    await logger.warn("CDN", "Network synchronization failed - attempting local cache fallback", err);
    const cachedPatch = await readJson<PatchInfo | null>(PATCH_CACHE, null);
    if (!cachedPatch) {
      throw new Error("게임 데이터를 불러올 수 없습니다 (네트워크 실패 + 캐시 없음).");
    }
    const cachedGameData = await readJson<GameData | null>(GAME_DATA_CACHE, null);
    return assembleFromCache(cachedPatch, cachedGameData, false);
  }

  // 여기까지 왔으면 네트워크 정상. patch/gameData 캐시 갱신.
  await writeJson(PATCH_CACHE, patch);
  if (gameData) await writeJson(GAME_DATA_CACHE, gameData);

  // 2. 매니페스트 동기화 — 적용 실패는 비치명적(이번 회차만 롤백, 기존 캐시 유지).
  try {
    await applyManifestSync();
  } catch (err) {
    await logger.warn("Sync", "Manifest application failed — rolled back this round, keeping caches", err);
  }

  // 3. (방금 갱신된 + 기존) 캐시로 메모리 데이터 조립.
  return assembleFromCache(patch, gameData, true);
}
