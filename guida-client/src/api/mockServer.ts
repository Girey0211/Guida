/**
 * 로컬 Mock 중앙 서버.
 *
 * README의 3-Tier 구조에서 "Server & Data Layer"를 localStorage 기반으로
 * 시뮬레이션한다. 실제 백엔드가 준비되면 이 모듈을 실 HTTP 호출로 교체하면
 * 된다(인터페이스는 api/routes.ts가 고정).
 *
 * 관리 항목:
 *  - 공유된 루트 (SharedRoute[])
 *  - 패치 버전 단위 추천/플레이 통계
 *  - (uuid, route_code, patch) 조합 기반 중복 추천 방지
 *  - 간단한 Rate Limit (도배 방지)
 */

import type { SharedRoute } from "@/types/route";
import { generateShareCode } from "@/lib/utils";
import { SEED_SHARED_ROUTES } from "@/data/seedRoutes";

const DB_KEY = "guida:mock-server:routes";
const LIKES_KEY = "guida:mock-server:likes"; // `${uuid}|${code}|${patch}` set
const PLAYS_KEY = "guida:mock-server:plays";
const UPLOAD_LOG_KEY = "guida:mock-server:upload-log"; // rate limit

/** 인위적 네트워크 지연 (체감용) */
function delay(ms = 180): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function loadDb(): SharedRoute[] {
  const raw = localStorage.getItem(DB_KEY);
  if (raw == null) {
    // 최초 1회 시드 주입
    localStorage.setItem(DB_KEY, JSON.stringify(SEED_SHARED_ROUTES));
    return structuredClone(SEED_SHARED_ROUTES);
  }
  try {
    return JSON.parse(raw) as SharedRoute[];
  } catch {
    return [];
  }
}

function saveDb(routes: SharedRoute[]): void {
  localStorage.setItem(DB_KEY, JSON.stringify(routes));
}

function loadSet(key: string): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(key) ?? "[]"));
  } catch {
    return new Set();
  }
}

function saveSet(key: string, set: Set<string>): void {
  localStorage.setItem(key, JSON.stringify([...set]));
}

export class MockServerError extends Error {
  constructor(
    message: string,
    public code: "DUPLICATE" | "NOT_FOUND" | "RATE_LIMIT" | "INVALID",
  ) {
    super(message);
    this.name = "MockServerError";
  }
}

/** Rate limit: 동일 UUID가 60초 내 5건 초과 업로드 시 차단 */
function checkRateLimit(uuid: string): void {
  const now = Date.now();
  let log: Record<string, number[]> = {};
  try {
    log = JSON.parse(localStorage.getItem(UPLOAD_LOG_KEY) ?? "{}");
  } catch {
    log = {};
  }
  const recent = (log[uuid] ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 5) {
    throw new MockServerError("업로드 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.", "RATE_LIMIT");
  }
  recent.push(now);
  log[uuid] = recent;
  localStorage.setItem(UPLOAD_LOG_KEY, JSON.stringify(log));
}

export interface UploadPayload {
  uuid: string;
  patch_version: string;
  route: Omit<SharedRoute, "route_code" | "stats" | "uploaded_at" | "patch_version">;
}

/** 루트 업로드 → 6자리 코드 발급 */
export async function uploadRoute(payload: UploadPayload): Promise<SharedRoute> {
  await delay();
  checkRateLimit(payload.uuid);

  const db = loadDb();
  // 코드 충돌 회피
  let code = generateShareCode();
  while (db.some((r) => r.route_code === code)) code = generateShareCode();

  const shared: SharedRoute = {
    ...payload.route,
    route_code: code,
    patch_version: payload.patch_version,
    stats: { [payload.patch_version]: { likes: 0, play_count: 0 } },
    uploaded_at: new Date().toISOString(),
  };
  db.push(shared);
  saveDb(db);
  return structuredClone(shared);
}

/** 6자리 코드로 단건 조회 */
export async function getRouteByCode(code: string): Promise<SharedRoute> {
  await delay(120);
  const db = loadDb();
  const found = db.find((r) => r.route_code === code.toUpperCase());
  if (!found) {
    throw new MockServerError(`코드 '${code}'에 해당하는 루트를 찾을 수 없습니다.`, "NOT_FOUND");
  }
  return structuredClone(found);
}

/** 전체 공유 루트 반환 (필터링은 클라이언트에서 수행) */
export async function listRoutes(): Promise<SharedRoute[]> {
  await delay();
  return loadDb().map((r) => structuredClone(r));
}

/** 추천 — (uuid, code, patch) 중복 방지 */
export async function likeRoute(
  uuid: string,
  code: string,
  patch: string,
): Promise<SharedRoute> {
  await delay(120);
  const key = `${uuid}|${code}|${patch}`;
  const likes = loadSet(LIKES_KEY);
  if (likes.has(key)) {
    throw new MockServerError("이미 추천한 루트입니다.", "DUPLICATE");
  }

  const db = loadDb();
  const route = db.find((r) => r.route_code === code);
  if (!route) throw new MockServerError("루트를 찾을 수 없습니다.", "NOT_FOUND");

  const stat = (route.stats[patch] ??= { likes: 0, play_count: 0 });
  stat.likes += 1;
  saveDb(db);

  likes.add(key);
  saveSet(LIKES_KEY, likes);
  return structuredClone(route);
}

/** 플레이 기록 — (uuid, code, patch) 중복 방지 */
export async function recordPlay(
  uuid: string,
  code: string,
  patch: string,
): Promise<SharedRoute> {
  await delay(80);
  const key = `${uuid}|${code}|${patch}`;
  const plays = loadSet(PLAYS_KEY);

  const db = loadDb();
  const route = db.find((r) => r.route_code === code);
  if (!route) throw new MockServerError("루트를 찾을 수 없습니다.", "NOT_FOUND");

  if (!plays.has(key)) {
    const stat = (route.stats[patch] ??= { likes: 0, play_count: 0 });
    stat.play_count += 1;
    saveDb(db);
    plays.add(key);
    saveSet(PLAYS_KEY, plays);
  }
  return structuredClone(route);
}

/** 이 디바이스가 추천한 코드 집합 (현재 패치 기준 UI 표시용) */
export function likedCodes(uuid: string, patch: string): Set<string> {
  const likes = loadSet(LIKES_KEY);
  const result = new Set<string>();
  for (const k of likes) {
    const [u, code, p] = k.split("|");
    if (u === uuid && p === patch) result.add(code);
  }
  return result;
}
