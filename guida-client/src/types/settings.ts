/** 앱 테마 — Guida는 다크 모드 전용이다 (README §12). */
export type Theme = "dark";

/**
 * 로컬 `user_settings.json` 스키마.
 * 디바이스 고유 UUID 및 앱 설정을 보관한다.
 */
export interface UserSettings {
  /** 디바이스 고유 UUID (추천 중복 방지의 익명 키) */
  uuid: string;
  /** 앱 버전 */
  app_version: string;
  /** 마지막으로 동기화한 현재 패치 버전 */
  current_patch: string;
  /** 테마 */
  theme: Theme;
  /** 오버레이 불투명도 (0.0 ~ 1.0) */
  overlay_opacity: number;
}

export const DEFAULT_SETTINGS: Omit<UserSettings, "uuid"> = {
  app_version: "1.0.0",
  current_patch: "0.0",
  theme: "dark",
  overlay_opacity: 0.85,
};
