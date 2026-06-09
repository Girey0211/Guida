/**
 * 루트(Route) 관련 타입.
 * 거울 던전 파밍 루트를 표현하며, 로컬 저장본과 서버 공개본 두 형태가 있다.
 */

/** 검증 방식 */
export type VerifiedMethod = "self_report" | "ocr";

/** 난이도 태그 */
export type DifficultyTag = "쉬움" | "보통" | "어려움";

/** 루트 유형 */
export type RouteType = "파밍 효율 중심" | "특정 목표 중심";

/** 루트 단계(층별 권장 행동) — MVP에서 간단한 메모형 단계 */
export interface RouteStep {
  /** 층수 */
  floor: number;
  /** 해당 층에서의 권장 행동/선택지 메모 */
  note: string;
}

/**
 * 로컬 `my_routes.json`에 저장되는 루트 1건.
 */
export interface LocalRoute {
  /** 로컬 고유 ID */
  local_id: string;
  /** 루트 이름 */
  name: string;
  /** 생성 일시 (ISO) */
  created_at: string;
  /** 작성 기준 패치 버전 */
  patch_version: string;
  /** 검증 여부 (Phase 1: 자기 신고) */
  verified: boolean;
  /** 검증 방식 */
  verified_method: VerifiedMethod;
  /** 검증 일시 (ISO, 검증된 경우) */
  verified_at?: string;
  /** 공유 시 발급받은 6자리 코드 (공유 전에는 없음) */
  shared_code?: string;
  /** 목표 재화 목록 */
  target_rewards: string[];
  /** 거던 층수 목록 */
  floors: number[];
  /** 난이도 태그 */
  difficulty_tag: DifficultyTag;
  /** 루트 유형 */
  route_type: RouteType;
  /** 층별 단계 메모 */
  steps: RouteStep[];
  /** 자유 메모 */
  memo: string;
}

/** 패치 버전별 통계 */
export interface RouteStat {
  likes: number;
  play_count: number;
}

/**
 * 서버에 공개되는 루트 데이터 구조.
 * 6자리 코드로 식별되며, 통계는 패치 버전을 키로 독립 관리한다.
 */
export interface SharedRoute {
  route_code: string;
  patch_version: string;
  name: string;
  difficulty_tag: DifficultyTag;
  route_type: RouteType;
  target_rewards: string[];
  floors: number[];
  steps: RouteStep[];
  memo: string;
  verified_method: VerifiedMethod;
  /** 패치 버전을 키로 하는 통계 맵 (예: { "2.4": { likes, play_count } }) */
  stats: Record<string, RouteStat>;
  uploaded_at: string;
}

/** 새 루트 작성 폼 입력값 */
export interface RouteDraft {
  name: string;
  target_rewards: string[];
  floors: number[];
  difficulty_tag: DifficultyTag;
  route_type: RouteType;
  steps: RouteStep[];
  memo: string;
}
