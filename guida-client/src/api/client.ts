/**
 * 서버 통신 기본 설정.
 *
 * MVP에서는 실제 백엔드 대신 로컬 Mock 서버(api/mockServer.ts)를 사용한다.
 * 여기서는 (1) 서버 베이스 URL 설정, (2) 온라인/오프라인 상태 판단,
 * (3) 향후 실 HTTP 전환 시의 단일 진입점만 정의한다.
 *
 * 컴포넌트에서 직접 fetch 하지 말 것 — 반드시 api/ 레이어를 경유한다.
 */

/** 향후 실 서버로 전환할 때 사용할 베이스 URL */
export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

/** MVP는 항상 Mock 서버를 사용한다 (백엔드 미구축). */
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
