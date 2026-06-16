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
import { isTauri } from "@/lib/env";
import { API_BASE_URL, ApiError, ServerUnavailableError } from "./client";
import { logger } from "@/lib/logger";

/** 루트 업로드 요청 페이로드 */
export interface UploadPayload {
  uuid: string;
  patch_version: string;
  route: Omit<SharedRoute, "route_code" | "stats" | "uploaded_at" | "patch_version" | "uploader_uuid" | "uploader_nickname">;
}

/** 서버 응답(Route) 형태 — guida-server/src/types/index.ts 의 Route 와 일치 */
interface ServerRoute {
  route_code: string;
  name: string;
  patch_version: string;
  difficulty_tag: SharedRoute["difficulty_tag"];
  difficulty_mode: SharedRoute["difficulty_mode"];
  difficulty_switch_floor: number | null;
  target_rewards: string[];
  floors: number[];
  gift_order?: GiftOrderItem[];
  pack_order?: PackOrderItem[];
  memo: string | null;
  verified_method: SharedRoute["verified_method"];
  deck_code?: string | null;
  uploader_uuid: string;
  uploader_nickname: string;
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
  const method = init?.method ?? "GET";
  const startTime = Date.now();
  const fullUrl = new URL(url(path), window.location.origin).href;

  const headers = {
    "content-type": "application/json",
    ...(init?.headers ?? {}),
  };

  const requestDetails: Record<string, any> = {
    url: fullUrl,
    method,
    headers,
  };
  if (init?.body) {
    try {
      requestDetails.body = JSON.parse(init.body as string);
    } catch {
      requestDetails.body = init.body;
    }
  }

  await logger.info("HTTP", `Sending request: ${method} ${fullUrl}`, requestDetails);

  let res: Response;
  try {
    res = await fetch(url(path), {
      ...init,
      headers,
    });
  } catch (err) {
    const elapsed = Date.now() - startTime;
    await logger.error("HTTP", `Request failed: ${method} ${fullUrl} (${elapsed}ms) - Network Error`, {
      url: fullUrl,
      method,
      elapsedMs: elapsed,
      error: err instanceof Error ? `${err.name}: ${err.message}` : err,
    });
    throw new ServerUnavailableError();
  }

  const elapsed = Date.now() - startTime;
  const responseHeaders = Object.fromEntries(res.headers.entries());
  const responseDetails: Record<string, any> = {
    url: fullUrl,
    method,
    status: res.status,
    statusText: res.statusText,
    headers: responseHeaders,
    elapsedMs: elapsed,
  };

  if (!res.ok) {
    let message = `서버 오류가 발생했습니다 (HTTP ${res.status}).`;
    let errorBody: any = null;
    try {
      const clone = res.clone();
      const body = await clone.json();
      errorBody = body;
      if (body?.error) {
        message = body.error;
      }
    } catch {
      try {
        const clone = res.clone();
        errorBody = await clone.text();
      } catch {
        /* ignore */
      }
    }
    const code = STATUS_TO_CODE[res.status];

    responseDetails.error = errorBody || message;
    responseDetails.code = code;

    await logger.warn("HTTP", `Request unsuccessful: ${method} ${fullUrl} - Status ${res.status} (${elapsed}ms)`, responseDetails);

    if (code) throw new ApiError(message, code);
    throw new ServerUnavailableError(message);
  }

  let responseBody: any = null;
  if (res.status !== 204) {
    try {
      const clone = res.clone();
      responseBody = await clone.json();
    } catch {
      try {
        const clone = res.clone();
        responseBody = await clone.text();
      } catch {
        /* ignore */
      }
    }
  }
  responseDetails.body = responseBody;

  await logger.info("HTTP", `Request success: ${method} ${fullUrl} - Status ${res.status} (${elapsed}ms)`, responseDetails);

  if (res.status === 204) return undefined as T;
  return responseBody as T;
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
    difficulty_mode: r.difficulty_mode,
    difficulty_switch_floor: r.difficulty_switch_floor ?? null,
    target_rewards: r.target_rewards ?? [],
    floors: r.floors ?? [],
    memo: r.memo ?? "",
    gift_order: r.gift_order ?? [],
    pack_order: r.pack_order ?? [],
    verified_method: r.verified_method,
    deck_code: r.deck_code ?? null,
    uploader_uuid: r.uploader_uuid,
    uploader_nickname: r.uploader_nickname,
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

// ── 브라우저/개발 모드 폴백 키쌍 생성 및 서명 ───────────────────────────────
let cachedBrowserKeys: { publicKey: string; privateKey: CryptoKey } | null = null;

async function getBrowserKeys(): Promise<{ publicKey: string; privateKey: CryptoKey }> {
  if (cachedBrowserKeys) return cachedBrowserKeys;

  const storedPub = localStorage.getItem("guida:dev:pubkey");
  const storedPriv = localStorage.getItem("guida:dev:privkey");

  if (storedPub && storedPriv) {
    try {
      const pubkey = storedPub;
      const privJwk = JSON.parse(storedPriv);
      const privateKey = await window.crypto.subtle.importKey(
        "jwk",
        privJwk,
        { name: "Ed25519", namedCurve: "Ed25519" } as any,
        true,
        ["sign"]
      );
      cachedBrowserKeys = { publicKey: pubkey, privateKey };
      return cachedBrowserKeys;
    } catch (e) {
      console.warn("Failed to import stored dev key, generating new one", e);
    }
  }

  const keyPair = (await window.crypto.subtle.generateKey(
    { name: "Ed25519", namedCurve: "Ed25519" } as any,
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;

  const privJwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const pubRaw = await window.crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Array.from(new Uint8Array(pubRaw))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  localStorage.setItem("guida:dev:pubkey", pubHex);
  localStorage.setItem("guida:dev:privkey", JSON.stringify(privJwk));

  cachedBrowserKeys = { publicKey: pubHex, privateKey: keyPair.privateKey };
  return cachedBrowserKeys;
}

/** 요청 메시지에 대한 인증 헤더를 생성한다. */
async function getAuthHeaders(action: string, bodyString: string): Promise<Record<string, string>> {
  const timestamp = Date.now().toString();

  // SHA-256 해시 계산
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(bodyString));
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const message = `${action}:${timestamp}:${hashHex}`;
  let pubkey = "";
  let signature = "";

  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const keys = await invoke<[string, string]>("get_device_keys");
    pubkey = keys[0];
    signature = await invoke<string>("sign_api_request", { message });
  } else {
    const keys = await getBrowserKeys();
    pubkey = keys.publicKey;
    const signatureBuffer = await window.crypto.subtle.sign(
      { name: "Ed25519" } as any,
      keys.privateKey,
      new TextEncoder().encode(message)
    );
    signature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  return {
    "X-Guida-PubKey": pubkey,
    "X-Guida-Timestamp": timestamp,
    "X-Guida-Signature": signature,
  };
}

// ── 공개 API ───────────────────────────────────────────────────────

/** 루트 업로드 → 6자리 코드 발급 */
export async function uploadRoute(payload: UploadPayload): Promise<SharedRoute> {
  const { uuid, route } = payload;
  const bodyObj = {
    uuid,
    name: route.name,
    difficulty_tag: route.difficulty_tag,
    difficulty_mode: route.difficulty_mode,
    difficulty_switch_floor: route.difficulty_switch_floor,
    target_rewards: route.target_rewards,
    floors: route.floors,
    gift_order: route.gift_order,
    pack_order: route.pack_order,
    memo: route.memo,
    verified_method: route.verified_method,
    deck_code: route.deck_code,
  };
  const bodyString = JSON.stringify(bodyObj);
  const headers = await getAuthHeaders("upload", bodyString);

  const { route_code } = await request<{ route_code: string }>(
    "/api/routes/upload",
    {
      method: "POST",
      headers,
      body: bodyString,
    },
  );

  return getRouteByCode(route_code);
}

/**
 * 기존 공유 루트 수정 (작성자 본인만 가능).
 * 서버가 uploader_uuid 와 요청 uuid 불일치 시 403(FORBIDDEN) 으로 차단한다.
 */
export async function updateRoute(code: string, payload: UploadPayload): Promise<SharedRoute> {
  const { route, uuid } = payload;
  const bodyObj = {
    uuid,
    name: route.name,
    difficulty_tag: route.difficulty_tag,
    difficulty_mode: route.difficulty_mode,
    difficulty_switch_floor: route.difficulty_switch_floor,
    target_rewards: route.target_rewards,
    floors: route.floors,
    gift_order: route.gift_order,
    pack_order: route.pack_order,
    memo: route.memo,
    verified_method: route.verified_method,
    deck_code: route.deck_code,
  };
  const bodyString = JSON.stringify(bodyObj);
  const headers = await getAuthHeaders("update", bodyString);

  const r = await request<ServerRoute>(
    `/api/routes/${encodeURIComponent(code.toUpperCase())}`,
    {
      method: "PUT",
      headers,
      body: bodyString,
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

/** 백업 데이터 서버 업로드 */
export async function uploadBackup(recoveryCodeHash: string, encryptedBlob: string): Promise<void> {
  await request<void>("/api/backup", {
    method: "POST",
    body: JSON.stringify({
      recovery_code_hash: recoveryCodeHash,
      encrypted_blob: encryptedBlob,
    }),
  });
}

/** 백업 데이터 서버 복구 */
export async function restoreBackup(recoveryCodeHash: string): Promise<string> {
  const res = await request<{ encrypted_blob: string }>("/api/backup/restore", {
    method: "POST",
    body: JSON.stringify({
      recovery_code_hash: recoveryCodeHash,
    }),
  });
  return res.encrypted_blob;
}

export interface UserProfileResponse {
  uuid: string;
  nickname: string;
  description: string;
  likes_received: number;
  routes: SharedRoute[];
}

/** 본인 프로필 조회 (POST, signed) */
export async function getMyProfile(): Promise<UserProfileResponse> {
  const headers = await getAuthHeaders("get_my_profile", "");
  const res = await request<Omit<UserProfileResponse, "routes"> & { routes: ServerRoute[] }>(
    "/api/users/me",
    {
      method: "POST",
      headers,
    }
  );
  return {
    ...res,
    routes: res.routes.map(toShared),
  };
}

/** 타인 프로필 조회 (GET, unsigned) */
export async function getUserProfile(uuid: string): Promise<UserProfileResponse> {
  const res = await request<Omit<UserProfileResponse, "routes"> & { routes: ServerRoute[] }>(
    `/api/users/${encodeURIComponent(uuid)}`
  );
  return {
    ...res,
    routes: res.routes.map(toShared),
  };
}

/** 본인 프로필 수정 (PUT, signed) */
export async function updateUserProfile(nickname: string, description: string): Promise<{ success: boolean; nickname: string; description: string }> {
  const bodyString = JSON.stringify({ nickname, description });
  const headers = await getAuthHeaders("update_profile", bodyString);
  return request<{ success: boolean; nickname: string; description: string }>(
    "/api/users/profile",
    {
      method: "PUT",
      headers,
      body: bodyString,
    }
  );
}

/** 기존 공유 루트 삭제 (작성자 본인만 가능) */
export async function deleteRoute(code: string): Promise<void> {
  const headers = await getAuthHeaders("delete", "");
  await request<void>(
    `/api/routes/${encodeURIComponent(code.toUpperCase())}`,
    {
      method: "DELETE",
      headers,
    },
  );
}

