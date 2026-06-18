/**
 * 이미지 지연 로딩/캐싱 훅 (README 7.5).
 *
 * 동작:
 *  - 이미지 파일명(예: "gift_만년_화롯불.webp")을 받아 실제 표시할 URL을 해석한다.
 *  - 베이스 경로 우선순위:
 *      1) VITE_IMAGE_CDN_URL (Cloudflare 등 운영 CDN)
 *      2) 미설정 시 데이터 경로 하위의 image 폴더 (<VITE_DATA_BASE_URL ?? "/data">/image)
 *         → 로컬 개발 시 guida-client/public/data/image/ 에 넣으면 그대로 뜬다.
 *  - 브라우저 환경에서는 <img loading="lazy"> 로 지연 로딩하고,
 *    onError 시 내장 fallback 이미지로 우아하게 대체한다.
 *
 * 참고: 실제 디스크 캐시(%APPDATA%/LimbusGuide/cache)는 Tauri 환경에서
 * 추후 fs 플러그인으로 확장 가능하다. MVP에서는 브라우저 HTTP 캐시에 의존한다.
 */

import { useEffect, useState } from "react";
import { resolveGiftImageSrc } from "@/api/imageCache";

const DATA_BASE =
  (import.meta.env.VITE_DATA_BASE_URL as string | undefined) ?? "/data";

const CDN_BASE =
  (import.meta.env.VITE_IMAGE_CDN_URL as string | undefined) ??
  `${DATA_BASE}/image`;

/**
 * 파일명을 CDN URL로 해석. 이미 절대 URL이면 그대로 반환.
 *
 * 파일명에 한글 등 비ASCII가 들어갈 수 있으므로(예: "gift_만년_화롯불.webp"),
 * 경로 세그먼트 단위로 NFC 정규화 후 encodeURIComponent 한다.
 *  - NFC: macOS(NFD)에서 만든 파일명과의 정규화 불일치(404)를 방지.
 *  - encode: 공백/한글이 그대로 URL에 들어가 깨지는 것을 방지.
 * 슬래시(/)는 경로 구분자로 보존한다.
 */
export function resolveImageUrl(fileName: string | undefined): string | null {
  if (!fileName) return null;
  if (/^https?:\/\//.test(fileName)) return fileName;
  const encoded = fileName
    .split("/")
    .map((seg) => encodeURIComponent(seg.normalize("NFC")))
    .join("/");
  return `${CDN_BASE}/${encoded}`;
}

/**
 * 기프트 이미지 content-addressed lazy 캐싱 훅 (phase2 dev plan §4 S3).
 *
 * image_key(파일명)를 받아 매니페스트 해시 기반으로 로컬 캐시를 확인하고,
 * 미스 시 1회 다운로드·검증·저장한 뒤 표시용 src 를 반환한다.
 *  - `src`: 표시할 URL(data:/CDN). 표시 불가(폴백)면 null.
 *  - `loading`: 해석 진행 중 여부(완료 전 폴백 깜빡임 방지용).
 */
export function useCachedImage(imageKey: string | null | undefined): {
  src: string | null;
  loading: boolean;
} {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!imageKey);

  useEffect(() => {
    let alive = true;
    if (!imageKey) {
      setSrc(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSrc(null);
    resolveGiftImageSrc(imageKey)
      .then((resolved) => {
        if (!alive) return;
        setSrc(resolved);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [imageKey]);

  return { src, loading };
}
