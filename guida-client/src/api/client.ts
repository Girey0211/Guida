/**
 * 서버 통신 기본 설정.
 *
 * 여기서는 (1) 서버 베이스 URL 설정, (2) 온라인/오프라인 상태 판단,
 * (3) 서버 통신 공통 에러 타입만 정의한다.
 *
 * 컴포넌트에서 직접 fetch 하지 말 것 — 반드시 api/ 레이어를 경유한다.
 */

/** 실 중앙 서버(guida-server) 베이스 URL (예: http://localhost:3000) */
export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

/** 현재 네트워크 사용 가능 여부 */
export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/**
 * 서버가 요청을 거부했을 때의 에러 (4xx 류).
 * `code` 로 UI 가 상황별 분기를 한다.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public code: "DUPLICATE" | "NOT_FOUND" | "RATE_LIMIT" | "INVALID" | "FORBIDDEN",
  ) {
    super(message);
    this.name = "ApiError";
  }
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
