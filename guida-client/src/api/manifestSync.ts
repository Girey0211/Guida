/**
 * 매니페스트 동기화 코어 (phase2 dev plan §1·§3·§7 S1).
 *
 * 부팅/설정 트리거가 호출하는 동기화의 하부 메커니즘:
 *  1. CDN `manifest.json` 만 fetch (ETag/If-None-Match → 변경 없으면 304, 본문 0).
 *  2. `manifest.local.json`(마지막 적용본)과 항목별 해시 diff.
 *  3. 변경된 JSON 만 다운로드 → 콘텐츠 해시 무결성 검증.
 *  4. 검증 통과분만 캐시에 반영하고 `manifest.local.json` 교체(applying).
 *
 * 이미지(content-addressed lazy 캐싱)는 S3 에서 이 모듈의 로컬 매니페스트를
 * 재사용한다(gift_id → manifest.images[gift_id].hash).
 */

import type { LocalManifestStore, Manifest } from "@/types/manifest";
import { readJson, writeJson } from "@/lib/storage";
import { logger } from "@/lib/logger";

/** CDN(정적) 데이터 베이스 경로. 운영은 Cloudflare(cdn.girey.org), 로컬은 /data. */
export const DATA_BASE =
  (import.meta.env.VITE_DATA_BASE_URL as string | undefined) ?? "/data";

/** 로컬에 보관하는 "마지막 적용 매니페스트" 파일명. */
export const LOCAL_MANIFEST_FILE = "manifest.local.json";

/** 매니페스트 fetch 결과. */
export type ManifestFetch =
  | { status: "not-modified" }
  | { status: "ok"; manifest: Manifest; etag: string | null };

/** 바이트 버퍼의 sha256 을 `sha256:<hex>` 형식으로 계산한다. */
export async function sha256OfBytes(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

/** 로컬 적용 매니페스트를 읽는다. 최초 실행이면 null. */
export async function loadLocalManifest(): Promise<LocalManifestStore | null> {
  return readJson<LocalManifestStore | null>(LOCAL_MANIFEST_FILE, null);
}

/** 로컬 적용 매니페스트를 교체한다(applying 단계). */
export async function saveLocalManifest(
  manifest: Manifest,
  etag: string | null,
): Promise<void> {
  const store: LocalManifestStore = {
    manifest,
    etag,
    applied_at: new Date().toISOString(),
  };
  await writeJson(LOCAL_MANIFEST_FILE, store);
}

/**
 * CDN `manifest.json` 을 가져온다. 이전 ETag 가 있으면 If-None-Match 로 보내
 * 변경이 없으면 304(본문 전송 0)로 빠르게 끝낸다.
 *
 * 네트워크 실패는 throw 한다 — 호출자는 Offline-First 로 로컬 매니페스트 폴백한다.
 */
export async function fetchRemoteManifest(
  prevEtag: string | null,
): Promise<ManifestFetch> {
  const url = `${DATA_BASE}/manifest.json`;
  const headers: Record<string, string> = {};
  if (prevEtag) headers["If-None-Match"] = prevEtag;

  // cache: "no-cache" — 항상 서버 재검증(브라우저 HTTP 캐시가 304 를 가로채
  // 200 으로 둔갑시키지 않도록 명시적으로 조건부 요청을 보낸다).
  const res = await fetch(url, { headers, cache: "no-cache" });

  if (res.status === 304) {
    await logger.info("Sync", "Manifest unchanged (304) — body skipped");
    return { status: "not-modified" };
  }
  if (!res.ok) {
    throw new Error(`매니페스트 fetch 실패: HTTP ${res.status}`);
  }

  const manifest = (await res.json()) as Manifest;
  const etag = res.headers.get("etag");
  await logger.info("Sync", `Manifest fetched (patch=${manifest.patch_version})`, {
    etag,
    dataFiles: Object.keys(manifest.data ?? {}).length,
    images: Object.keys(manifest.images ?? {}).length,
  });
  return { status: "ok", manifest, etag };
}

/**
 * 변경된 data 파일 목록을 산출한다.
 * remote 에만 있거나 해시가 다른 파일이 대상. (삭제분은 JSON 캐시 GC 불필요로 무시)
 */
export function diffDataFiles(
  local: Manifest | null,
  remote: Manifest,
): string[] {
  const changed: string[] = [];
  for (const [file, entry] of Object.entries(remote.data ?? {})) {
    const prev = local?.data?.[file]?.hash;
    if (prev !== entry.hash) changed.push(file);
  }
  return changed;
}

/**
 * data 파일 하나를 다운로드하고 콘텐츠 해시로 무결성을 검증한다.
 * 검증 실패(변조/부분 전송)나 네트워크 실패 시 throw — 호출자가 해당 동기화를
 * 롤백(매니페스트 미적용)한다.
 *
 * @returns 검증을 통과한 원본 텍스트(파싱은 호출자 몫).
 */
export async function downloadAndVerify(
  file: string,
  expectedHash: string,
): Promise<string> {
  const url = `${DATA_BASE}/${file}`;
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`${file} 다운로드 실패: HTTP ${res.status}`);
  }
  // 전송된 바이트 그대로 해시(서버 매니페스트가 원본 바이트를 해시했으므로 일치).
  const buf = await res.arrayBuffer();
  const actual = await sha256OfBytes(buf);
  if (actual !== expectedHash) {
    throw new Error(
      `${file} 무결성 검증 실패 (expected ${expectedHash}, got ${actual})`,
    );
  }
  return new TextDecoder().decode(buf);
}
