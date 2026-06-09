/**
 * 루트 공유 허브 API.
 *
 * 컴포넌트/스토어는 이 모듈만 호출한다.
 * `VITE_API_BASE_URL` 설정 여부에 따라 백엔드 구현이 결정된다:
 *  - 미설정 → 로컬 Mock 서버(api/mockServer.ts, localStorage)
 *  - 설정   → 실 중앙 서버(api/httpServer.ts, HTTP)
 * 두 구현은 동일한 시그니처를 노출하므로 이 레이어 위로는 차이가 드러나지 않는다.
 */

import type { SharedRoute } from "@/types/route";
import { withServer, USE_MOCK_SERVER } from "./client";
import * as mock from "./mockServer";
import * as http from "./httpServer";

export { MockServerError } from "./mockServer";

/** 활성 백엔드 구현 (Mock 또는 실 HTTP 서버) */
const server = USE_MOCK_SERVER ? mock : http;

/** 루트 업로드 → 6자리 코드 발급 */
export function uploadRoute(payload: mock.UploadPayload): Promise<SharedRoute> {
  return withServer(() => server.uploadRoute(payload));
}

/** 6자리 코드로 단건 조회 */
export function getRouteByCode(code: string): Promise<SharedRoute> {
  return withServer(() => server.getRouteByCode(code));
}

/** 전체 공유 루트 목록 (탐색용, 필터는 클라이언트에서) */
export function listRoutes(): Promise<SharedRoute[]> {
  return withServer(() => server.listRoutes());
}

/** 추천 (디바이스당 1회, 패치 단위) */
export function likeRoute(uuid: string, code: string, patch: string): Promise<SharedRoute> {
  return withServer(() => server.likeRoute(uuid, code, patch));
}

/** 플레이 기록 (디바이스당 1회, 패치 단위) */
export function recordPlay(uuid: string, code: string, patch: string): Promise<SharedRoute> {
  return withServer(() => server.recordPlay(uuid, code, patch));
}

/** 이 디바이스가 추천한 코드 집합 (UI 표시용, 로컬 판단이라 동기) */
export function likedCodes(uuid: string, patch: string): Set<string> {
  return server.likedCodes(uuid, patch);
}
