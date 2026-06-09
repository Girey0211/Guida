/**
 * 루트 공유 허브 API.
 *
 * 컴포넌트/스토어는 이 모듈만 호출한다. 내부적으로 Mock 서버를 사용하지만,
 * 실 백엔드 전환 시 시그니처를 유지한 채 구현만 교체하면 된다.
 */

import type { SharedRoute } from "@/types/route";
import { withServer } from "./client";
import * as mock from "./mockServer";

export { MockServerError } from "./mockServer";

/** 루트 업로드 → 6자리 코드 발급 */
export function uploadRoute(payload: mock.UploadPayload): Promise<SharedRoute> {
  return withServer(() => mock.uploadRoute(payload));
}

/** 6자리 코드로 단건 조회 */
export function getRouteByCode(code: string): Promise<SharedRoute> {
  return withServer(() => mock.getRouteByCode(code));
}

/** 전체 공유 루트 목록 (탐색용, 필터는 클라이언트에서) */
export function listRoutes(): Promise<SharedRoute[]> {
  return withServer(() => mock.listRoutes());
}

/** 추천 (디바이스당 1회, 패치 단위) */
export function likeRoute(uuid: string, code: string, patch: string): Promise<SharedRoute> {
  return withServer(() => mock.likeRoute(uuid, code, patch));
}

/** 플레이 기록 (디바이스당 1회, 패치 단위) */
export function recordPlay(uuid: string, code: string, patch: string): Promise<SharedRoute> {
  return withServer(() => mock.recordPlay(uuid, code, patch));
}

/** 이 디바이스가 추천한 코드 집합 (UI 표시용, 로컬 판단이라 동기) */
export function likedCodes(uuid: string, patch: string): Set<string> {
  return mock.likedCodes(uuid, patch);
}
