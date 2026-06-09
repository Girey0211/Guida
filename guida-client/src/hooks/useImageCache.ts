/**
 * 이미지 지연 로딩/캐싱 훅 (README 7.5).
 *
 * 동작:
 *  - 이미지 파일명(예: "greg_01.webp")을 받아 실제 표시할 URL을 해석한다.
 *  - 1차: CDN(GitHub Raw → Cloudflare 전환 예정) 경로.
 *  - 브라우저 환경에서는 <img loading="lazy"> 로 지연 로딩하고,
 *    onError 시 내장 fallback 이미지로 우아하게 대체한다.
 *
 * 참고: 실제 디스크 캐시(%APPDATA%/LimbusGuide/cache)는 Tauri 환경에서
 * 추후 fs 플러그인으로 확장 가능하다. MVP에서는 브라우저 HTTP 캐시에 의존한다.
 */

const CDN_BASE =
  (import.meta.env.VITE_IMAGE_CDN_URL as string | undefined) ??
  "https://raw.githubusercontent.com/guida-app/assets/main/images";

/** 파일명을 CDN URL로 해석. 이미 절대 URL이면 그대로 반환. */
export function resolveImageUrl(fileName: string | undefined): string | null {
  if (!fileName) return null;
  if (/^https?:\/\//.test(fileName)) return fileName;
  return `${CDN_BASE}/${fileName}`;
}
