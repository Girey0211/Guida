/**
 * 실 중앙 서버(guida-server) HTTP 클라이언트.
 *
 * `VITE_API_BASE_URL` 이 설정되면 api/routes.ts 가 mockServer 대신 이 모듈을
 * 사용한다. mockServer 와 동일한 함수 시그니처를 노출하므로 상위 레이어
 * (api/routes.ts → store → UI)는 전혀 수정할 필요가 없다.
 *
 * 이 모듈은 서버 ↔ 클라이언트 사이의 표현 차이를 경계에서 흡수한다:
 *  - 서버 `difficulty`           ↔ 클라이언트 `difficulty_tag`
 *  - 서버 평탄한 likes/play_count ↔ 클라이언트 패치별 `stats` 맵
 *  - 서버 HTTP status            ↔ MockServerError(code) / ServerUnavailableError
 *
 * 서버는 "내가 추천한 코드" 조회 API가 없으므로, likedCodes() 동기 조회를
 * 지원하기 위해 추천 성공 시 로컬(localStorage)에 코드를 함께 기록한다.
 */

import type { RouteStep, SharedRoute, RouteStat } from "@/types/route";
import { API_BASE_URL, ServerUnavailableError } from "./client";
import { MockServerError, type UploadPayload } from "./mockServer";

/** 서버 응답(Route) 형태 — guida-server/src/types/index.ts 의 Route 와 일치 */
interface ServerRoute {
  route_code: string;
  name: string;
  patch_version: string;
  difficulty: SharedRoute["difficulty_tag"];
  route_type: SharedRoute["route_type"];
  target_rewards: string[];
  floors: number[];
  steps?: RouteStep[];
  memo: string | null;
  verified_method: SharedRoute["verified_method"];
  uploaded_at: string;
  likes: number;
  play_count: number;
}

const LIKES_KEY = "guida:server:likes"; // `${uuid}|${code}|${patch}` 집합

/** HTTP status → MockServerError code 매핑 (UI 에러 분기 호환 유지) */
const STATUS_TO_CODE: Record<number, MockServerError["code"]> = {
  400: "INVALID",
  404: "NOT_FOUND",
  409: "DUPLICATE",
  429: "RATE_LIMIT",
};

function url(path: string): string {
  return `${API_BASE_URL.replace(/\/+$/, "")}${path}`;
}

/**
 * 공통 fetch 래퍼.
 * - 네트워크 실패(서버 다운/오프라인) → ServerUnavailableError
 * - 4xx → MockServerError(매핑된 code) 로 UI 가 기존처럼 분기
 * - 그 외 5xx → ServerUnavailableError
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url(path), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    // fetch 자체가 throw → 서버에 도달 불가
    throw new ServerUnavailableError();
  }

  if (!res.ok) {
    let message = `서버 오류가 발생했습니다 (HTTP ${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* 본문이 JSON 이 아니면 기본 메시지 사용 */
    }
    const code = STATUS_TO_CODE[res.status];
    if (code) throw new MockServerError(message, code);
    throw new ServerUnavailableError(message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** 서버 Route → 클라이언트 SharedRoute 변환 */
function toShared(r: ServerRoute): SharedRoute {
  // 서버는 해당 루트 패치의 통계만 평탄하게 주므로, 그 패치를 키로 stats 맵 구성
  const stats: Record<string, RouteStat> = {
    [r.patch_version]: { likes: r.likes ?? 0, play_count: r.play_count ?? 0 },
  };
  return {
    route_code: r.route_code,
    patch_version: r.patch_version,
    name: r.name,
    difficulty_tag: r.difficulty,
    route_type: r.route_type,
    target_rewards: r.target_rewards ?? [],
    floors: r.floors ?? [],
    steps: r.steps ?? [],
    memo: r.memo ?? "",
    verified_method: r.verified_method,
    stats,
    uploaded_at: r.uploaded_at,
  };
}

// ── 로컬 추천 기록 (likedCodes 동기 조회 지원용) ────────────────────
function loadLikes(): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(LIKES_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function rememberLike(uuid: string, code: string, patch: string): void {
  const likes = loadLikes();
  likes.add(`${uuid}|${code}|${patch}`);
  localStorage.setItem(LIKES_KEY, JSON.stringify([...likes]));
}

// ── 공개 API (mockServer 와 동일한 시그니처) ───────────────────────

/** 루트 업로드 → 6자리 코드 발급 */
export async function uploadRoute(payload: UploadPayload): Promise<SharedRoute> {
  const { uuid, patch_version, route } = payload;
  const { route_code } = await request<{ route_code: string }>(
    "/api/routes/upload",
    {
      method: "POST",
      body: JSON.stringify({
        uuid,
        name: route.name,
        difficulty: route.difficulty_tag,
        route_type: route.route_type,
        target_rewards: route.target_rewards,
        floors: route.floors,
        steps: route.steps,
        memo: route.memo,
        verified_method: route.verified_method,
      }),
    },
  );

  // 업로드 응답은 코드만 주므로 갓 만든 루트를 그대로 재구성해 반환
  // (mock.uploadRoute 와 동일하게 통계 0 초기값)
  return {
    ...route,
    route_code,
    patch_version,
    stats: { [patch_version]: { likes: 0, play_count: 0 } },
    uploaded_at: new Date().toISOString(),
  };
}

/** 6자리 코드로 단건 조회 */
export async function getRouteByCode(code: string): Promise<SharedRoute> {
  const r = await request<ServerRoute>(
    `/api/routes/${encodeURIComponent(code.toUpperCase())}`,
  );
  return toShared(r);
}

/** 전체 공유 루트 목록 (필터는 클라이언트에서 수행) */
export async function listRoutes(): Promise<SharedRoute[]> {
  // 서버는 { routes, total } 페이지네이션 응답. 허브는 전체를 받아 클라에서 필터.
  const { routes } = await request<{ routes: ServerRoute[]; total: number }>(
    "/api/routes?limit=100",
  );
  return routes.map(toShared);
}

/** 추천 — 서버가 (uuid, code, patch) 중복을 409 로 차단 */
export async function likeRoute(
  uuid: string,
  code: string,
  patch: string,
): Promise<SharedRoute> {
  const upper = code.toUpperCase();
  await request(`/api/routes/${encodeURIComponent(upper)}/like`, {
    method: "POST",
    body: JSON.stringify({ uuid, patch_version: patch }),
  });
  rememberLike(uuid, upper, patch);
  // like 응답은 { success } 뿐이므로 갱신된 통계를 위해 재조회
  return getRouteByCode(upper);
}

/** 플레이 기록 (거던 클리어 시) */
export async function recordPlay(
  _uuid: string,
  code: string,
  patch: string,
): Promise<SharedRoute> {
  const upper = code.toUpperCase();
  await request(`/api/routes/${encodeURIComponent(upper)}/play`, {
    method: "POST",
    body: JSON.stringify({ patch_version: patch }),
  });
  return getRouteByCode(upper);
}

/** 이 디바이스가 추천한 코드 집합 (현재 패치 기준, 로컬 기록 기반 동기 조회) */
export function likedCodes(uuid: string, patch: string): Set<string> {
  const result = new Set<string>();
  for (const key of loadLikes()) {
    const [u, code, p] = key.split("|");
    if (u === uuid && p === patch) result.add(code);
  }
  return result;
}
