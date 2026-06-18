/**
 * 기프트 아이콘 content-addressed lazy 캐싱 (phase2 dev plan §4 S3).
 *
 * 해석 순서: gift_id → manifest.images[gift_id].hash → cache/images/<hash>.webp
 *   1. 로컬 매니페스트에서 gift_id 의 해시를 찾는다. 없으면(구버전/미배포) 폴백.
 *   2. 디스크 캐시 적중이면 즉시 로컬 로드(네트워크 0).
 *   3. 미스면 CDN 에서 파일명으로 1회 다운로드 → 해시 검증 → 캐시 저장 후 표시.
 *   4. 검증/다운로드 실패면 null 반환(호출 컴포넌트가 KeywordBadge 폴백).
 *
 * 표시는 `data:image/webp;base64,...` URL 로 한다(CSP 가 data: 를 허용).
 * 같은 세션 내 재사용을 위해 해시→dataURL 을 메모리 캐시한다.
 */

import { isTauri } from "@/lib/env";
import { logger } from "@/lib/logger";
import { loadLocalManifest, sha256OfBytes } from "@/api/manifestSync";
import { resolveImageUrl } from "@/hooks/useImageCache";
import type { Manifest } from "@/types/manifest";

/** 콘텐츠 해시(`sha256:<hex>` 또는 `<hex>`)에서 캐시 파일명 stem(hex 소문자)을 얻는다. */
function hashStem(hash: string): string {
  return hash.replace(/^sha256:/, "").toLowerCase();
}

/** 세션 메모리 캐시: 콘텐츠 해시 → data URL. 재방문 시 Rust IPC·네트워크 모두 생략. */
const memCache = new Map<string, string>();
/** 진행 중인 동일 해시 요청을 합쳐 중복 다운로드를 막는다. */
const inflight = new Map<string, Promise<string | null>>();

/** Tauri invoke 핸들을 동적으로 가져온다(브라우저 번들에서 안전). */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** ArrayBuffer → base64 (청크 단위로 처리해 큰 스택 인자 폭발을 피한다). */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** image_key(파일명) → gift_id (확장자 제거). */
function giftIdFromImageKey(imageKey: string): string {
  return imageKey.replace(/\.webp$/i, "");
}

/**
 * 기프트 이미지의 표시용 src 를 해석한다.
 * @param imageKey gifts.json 의 image_key (= `<gift_id>.webp`)
 * @returns data URL 또는 직접 CDN URL, 표시 불가 시 null(폴백)
 */
export async function resolveGiftImageSrc(
  imageKey: string | null | undefined,
): Promise<string | null> {
  if (!imageKey) return null;

  // 브라우저(개발) 환경: 디스크 캐시가 없으므로 직접 CDN URL 로 폴백(HTTP 캐시 의존).
  if (!isTauri()) {
    return resolveImageUrl(imageKey);
  }

  const giftId = giftIdFromImageKey(imageKey);
  const local = await loadLocalManifest();
  const hash = local?.manifest?.images?.[giftId]?.hash;
  // 매니페스트에 없는 이미지(구버전 데이터) → 폴백.
  if (!hash) return null;

  if (memCache.has(hash)) return memCache.get(hash)!;
  const pending = inflight.get(hash);
  if (pending) return pending;

  const job = (async (): Promise<string | null> => {
    try {
      const hex = hash.replace(/^sha256:/, "");

      // 1. 디스크 캐시 적중 판정.
      const cached = await invoke<string | null>("read_cached_image", { hash: hex });
      if (cached) {
        const url = `data:image/webp;base64,${cached}`;
        memCache.set(hash, url);
        return url;
      }

      // 2. 미스 → CDN 에서 파일명으로 1회 다운로드.
      const cdnUrl = resolveImageUrl(imageKey);
      if (!cdnUrl) return null;
      const res = await fetch(cdnUrl, { cache: "no-cache" });
      if (!res.ok) {
        await logger.warn("ImageCache", `이미지 다운로드 실패 ${imageKey}: HTTP ${res.status}`);
        return null;
      }
      const buf = await res.arrayBuffer();

      // 3. 콘텐츠 해시 무결성 검증(변조/부분 전송 차단).
      const actual = await sha256OfBytes(buf);
      if (actual !== hash) {
        await logger.warn("ImageCache", `이미지 해시 불일치 ${imageKey} (expected ${hash}, got ${actual})`);
        return null;
      }

      // 4. 캐시 저장 후 표시.
      const b64 = toBase64(buf);
      try {
        await invoke<void>("write_cached_image", { hash: hex, base64: b64 });
      } catch (e) {
        // 캐시 쓰기 실패는 비치명적 — 이번엔 메모리로만 표시한다.
        await logger.warn("ImageCache", `이미지 캐시 저장 실패 ${imageKey}`, e);
      }
      const url = `data:image/webp;base64,${b64}`;
      memCache.set(hash, url);
      return url;
    } catch (e) {
      await logger.warn("ImageCache", `이미지 해석 실패 ${imageKey}`, e);
      return null;
    } finally {
      inflight.delete(hash);
    }
  })();

  inflight.set(hash, job);
  return job;
}

/**
 * orphan-only 이미지 GC (phase2 dev plan §5 S4).
 *
 * 새 매니페스트의 어떤 이미지 해시와도 일치하지 않는 캐시 파일(orphan)만 삭제한다.
 * 아이콘이 패치로 바뀌어 옛 해시가 떠버린 경우를 정리한다. 유효 이미지는 보존.
 *
 * **반드시 매니페스트 적용(applying) 성공 후에만 호출한다.** 다운로드 도중 죽으면
 * 옛 캐시·옛 매니페스트가 남아 폴백 가능해야 하기 때문이다.
 * 삭제 실패(파일 잠금 등)는 비치명적이며 다음 부팅/동기화에 재시도된다.
 */
export async function runOrphanImageGc(manifest: Manifest): Promise<void> {
  if (!isTauri()) return; // 디스크 캐시는 Tauri 전용
  try {
    const valid = new Set(
      Object.values(manifest.images ?? {}).map((e) => hashStem(e.hash)),
    );
    const cached = await invoke<string[]>("list_cached_image_hashes");
    const orphans = cached.filter((h) => !valid.has(h.toLowerCase()));
    if (orphans.length === 0) return;

    const deleted = await invoke<string[]>("delete_cached_images", { hashes: orphans });
    // 삭제된 해시는 메모리 캐시에서도 비운다(혹시 모를 stale 참조 방지).
    for (const stem of deleted) memCache.delete(`sha256:${stem}`);
    await logger.info(
      "Sync",
      `Orphan image GC: ${deleted.length}/${orphans.length} removed`,
    );
  } catch (e) {
    await logger.warn("Sync", "Orphan image GC failed (non-fatal, will retry)", e);
  }
}
