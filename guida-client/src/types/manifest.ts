/**
 * 콘텐츠 해시 매니페스트 타입 (phase2 dev plan §1).
 *
 * CDN(`manifest.json`)과 로컬(`manifest.local.json`)이 공유하는 한 겹의 인덱스.
 * 데이터(JSON)와 이미지(아이콘)의 파일별 sha256 해시를 담아, 동기화 판단을
 * "패치 버전 라벨"이 아니라 "파일별 콘텐츠 해시"로 수행한다.
 */

/** 매니페스트 항목 — 콘텐츠 해시와 (진행률 표시용) 바이트 크기. */
export interface ManifestEntry {
  /** `sha256:<hex>` 형식의 콘텐츠 해시. diff·무결성 검증의 단일 기준. */
  hash: string;
  /** 다운로드 진행률 표시용 바이트 크기. */
  size: number;
}

/** CDN `manifest.json` 전체 구조. */
export interface Manifest {
  schema_version: string;
  /** 표시용 패치 라벨. 동기화 판단에는 사용하지 않음. */
  patch_version: string;
  generated_at: string;
  /** JSON 파일명 → 콘텐츠 해시. */
  data: Record<string, ManifestEntry>;
  /** gift_id → 아이콘 콘텐츠 해시. */
  images: Record<string, ManifestEntry>;
}

/**
 * 로컬에 보관하는 "마지막으로 적용 성공한 매니페스트" 사본(`manifest.local.json`).
 * ETag 를 함께 보관해 다음 부팅 시 If-None-Match 로 304(본문 전송 0)를 노린다.
 */
export interface LocalManifestStore {
  manifest: Manifest;
  /** CDN 이 마지막으로 준 매니페스트 ETag (없으면 null). */
  etag: string | null;
  /** 마지막으로 적용에 성공한 시각(ISO). 진단용. */
  applied_at: string;
}
