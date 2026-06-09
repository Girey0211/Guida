/**
 * 서버 통신 기본 설정.
 *
 * 여기서는 (1) 서버 베이스 URL 설정, (2) 온라인/오프라인 상태 판단,
 * (3) Mock ↔ 실 서버 분기 플래그만 정의한다.
 *
 * `VITE_API_BASE_URL` 이 설정되면 실 중앙 서버(api/httpServer.ts)를,
 * 없으면 로컬 Mock 서버(api/mockServer.ts)를 사용한다.
 *
 * 컴포넌트에서 직접 fetch 하지 말 것 — 반드시 api/ 레이어를 경유한다.
 */

/** 실 중앙 서버(guida-server) 베이스 URL (예: http://localhost:3000) */
export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

/** 베이스 URL 미설정 시 로컬 Mock 서버로 폴백 */
export const USE_MOCK_SERVER = !API_BASE_URL;

/** 현재 네트워크 사용 가능 여부 */
export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/**
 * 서버 의존 작업의 표준 에러.
 * 오프라인이거나 서버가 다운된 경우 throw 되어 UI가 우아하게 처리한다.
 */
export class ServerUnavailableError extends Error {
  constructor(message = "중앙 서버에 연결할 수 없습니다. 로컬 기능만 사용할 수 있습니다.") {
    super(message);
    this.name = "ServerUnavailableError";
  }
}

/** 서버 의존 작업을 감싸 오프라인 시 ServerUnavailableError로 변환 */
export async function withServer<T>(op: () => Promise<T>): Promise<T> {
  if (!isOnline()) {
    throw new ServerUnavailableError();
  }
  return op();
}
