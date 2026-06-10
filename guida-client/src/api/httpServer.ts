/**
 * 실 중앙 서버(guida-server) HTTP 클라이언트.
 *
 * api/routes.ts 가 이 모듈을 통해 중앙 서버와 통신한다.
 *
 * 이 모듈은 서버 ↔ 클라이언트 사이의 표현 차이를 경계에서 흡수한다:
 *  - 서버 평탄한 likes/play_count ↔ 클라이언트 패치별 `stats` 맵
 *  - 서버 HTTP status            ↔ ApiError(code) / ServerUnavailableError
 *
 * 서버는 "내가 추천한 코드" 조회 API가 없으므로, likedCodes() 동기 조회를
 * 지원하기 위해 추천 성공 시 로컬(localStorage)에 코드를 함께 기록한다.
 */

import type {
  GiftOrderItem,
  PackOrderItem,
  SharedRoute,
  RouteStat,
} from "@/types/route";
import { API_BASE_URL, ApiError, ServerUnavailableError } from "./client";

/** 루트 업로드 요청 페이로드 */
export interface UploadPayload {
  uuid: string;
  patch_version: string;
  route: Omit<SharedRoute, "route_code" | "stats" | "uploaded_at" | "patch_version">;
}

/** 서버 응답(Route) 형태 — guida-server/src/types/index.ts 의 Route 와 일치 */
interface ServerRoute {
  route_code: string;
  name: string;
  patch_version: string;
  difficulty_tag: SharedRoute["difficulty_tag"];
  route_type: SharedRoute["route_type"];
  difficulty_mode: SharedRoute["difficulty_mode"];
  difficulty_switch_floor: number | null;
  target_rewards: string[];
  floors: number[];
  gift_order?: GiftOrderItem[];
  pack_order?: PackOrderItem[];
  memo: string | null;
  verified_method: SharedRoute["verified_method"];
  uploaded_at: string;
  likes: number;
  play_count: number;
}

const LIKES_KEY = "guida:server:likes"; // `${uuid}|${code}|${patch}` 집합

/** HTTP status → ApiError code 매핑 (UI 에러 분기용) */
const STATUS_TO_CODE: Record<number, ApiError["code"]> = {
  400: "INVALID",
  403: "FORBIDDEN",
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
 * - 4xx → ApiError(매핑된 code) 로 UI 가 상황별 분기
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
    if (code) throw new ApiError(message, code);
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
    difficulty_tag: r.difficulty_tag,
    route_type: r.route_type,
    difficulty_mode: r.difficulty_mode,
    difficulty_switch_floor: r.difficulty_switch_floor ?? null,
    target_rewards: r.target_rewards ?? [],
    floors: r.floors ?? [],
    memo: r.memo ?? "",
    gift_order: r.gift_order ?? [],
    pack_order: r.pack_order ?? [],
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

// ── 공개 API ───────────────────────────────────────────────────────

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
        difficulty_tag: route.difficulty_tag,
        route_type: route.route_type,
        difficulty_mode: route.difficulty_mode,
        difficulty_switch_floor: route.difficulty_switch_floor,
        target_rewards: route.target_rewards,
        floors: route.floors,
        gift_order: route.gift_order,
        pack_order: route.pack_order,
        memo: route.memo,
        verified_method: route.verified_method,
      }),
    },
  );

  // 업로드 응답은 코드만 주므로 갓 만든 루트를 그대로 재구성해 반환 (통계 0 초기값)
  return {
    ...route,
    route_code,
    patch_version,
    stats: { [patch_version]: { likes: 0, play_count: 0 } },
    uploaded_at: new Date().toISOString(),
  };
}

/**
 * 기존 공유 루트 수정 (작성자 본인만 가능).
 * 서버가 uploader_uuid 와 요청 uuid 불일치 시 403(FORBIDDEN) 으로 차단한다.
 */
export async function updateRoute(code: string, payload: UploadPayload): Promise<SharedRoute> {
  const { route, uuid } = payload;
  const r = await request<ServerRoute>(
    `/api/routes/${encodeURIComponent(code.toUpperCase())}`,
    {
      method: "PUT",
      body: JSON.stringify({
        uuid,
        name: route.name,
        difficulty_tag: route.difficulty_tag,
        route_type: route.route_type,
        difficulty_mode: route.difficulty_mode,
        difficulty_switch_floor: route.difficulty_switch_floor,
        target_rewards: route.target_rewards,
        floors: route.floors,
        gift_order: route.gift_order,
        pack_order: route.pack_order,
        memo: route.memo,
        verified_method: route.verified_method,
      }),
    },
  );
  return toShared(r);
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
