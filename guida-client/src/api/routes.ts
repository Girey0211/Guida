/**
 * 루트 공유 허브 API.
 *
 * 컴포넌트/스토어는 이 모듈만 호출한다.
 * 실제 통신은 api/httpServer.ts(실 중앙 서버 HTTP)가 담당하며,
 * 베이스 URL 은 `VITE_API_BASE_URL` 로 설정한다.
 */

import type { SharedRoute } from "@/types/route";
import { withServer } from "./client";
import * as server from "./httpServer";
import type { UploadPayload } from "./httpServer";

export { ApiError } from "./client";

/** 루트 업로드 → 6자리 코드 발급 */
export function uploadRoute(payload: UploadPayload): Promise<SharedRoute> {
  return withServer(() => server.uploadRoute(payload));
}

/** 기존 공유 루트 수정 (작성자 본인만, 서버가 uuid 검증) */
export function updateRoute(code: string, payload: UploadPayload): Promise<SharedRoute> {
  return withServer(() => server.updateRoute(code, payload));
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

/** 백업 데이터 서버 업로드 */
export function uploadBackup(recoveryCodeHash: string, encryptedBlob: string): Promise<void> {
  return withServer(() => server.uploadBackup(recoveryCodeHash, encryptedBlob));
}

/** 백업 데이터 서버 복구 */
export function restoreBackup(recoveryCodeHash: string): Promise<string> {
  return withServer(() => server.restoreBackup(recoveryCodeHash));
}

export type { UserProfileResponse } from "./httpServer";

/** 본인 프로필 조회 */
export function getMyProfile() {
  return withServer(() => server.getMyProfile());
}

/** 타인 프로필 조회 */
export function getUserProfile(uuid: string) {
  return withServer(() => server.getUserProfile(uuid));
}

/** 본인 프로필 수정 */
export function updateUserProfile(nickname: string, description: string) {
  return withServer(() => server.updateUserProfile(nickname, description));
}

/** 기존 공유 루트 삭제 (작성자 본인만, 서버가 uuid 검증) */
export function deleteRoute(code: string): Promise<void> {
  return withServer(() => server.deleteRoute(code));
}

export type { MigrationRequest } from "./httpServer";

/** 신원 이관(B-1): 구/신 이중 서명으로 데이터 소유권을 신규 키로 이전 */
export function migrateIdentity(req: server.MigrationRequest) {
  return withServer(() => server.migrateIdentity(req));
}

