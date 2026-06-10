/**
 * 루트(Route) 관련 타입.
 * 거울 던전 파밍 루트를 표현하며, 로컬 저장본과 서버 공개본 두 형태가 있다.
 * 스키마는 README §8.2(로컬 my_routes.json) / §8.4(서버 공개 데이터)를 단일 소스로 따른다.
 */

/** 검증 방식 */
export type VerifiedMethod = "self_report" | "ocr";

/** 난이도 태그 — 체감 난이도 라벨 (README §6.2) */
export type DifficultyTag = "쉬움" | "보통" | "어려움";

/** 난이도 모드 — 거던 실제 난이도. gift_order / pack_order 항목과 연동 */
export type DifficultyMode = "normal" | "hard" | "extreme";

/** 루트 유형 */
export type RouteType = "파밍 효율 중심" | "특정 목표 중심";

/**
 * 기프트 획득 순서 한 항목 (README §8.2 `gift_order[]`).
 * `gifts.json` 의 id 를 참조한다.
 */
export interface GiftOrderItem {
  gift_id: string;
  /** 획득 우선순위(1부터) */
  priority: number;
  /** 획득 목표 층 */
  floor_target: number;
  /** 획득 시점의 난이도 (팩 방문 계획과 연동) */
  difficulty: DifficultyMode;
  /** 핵심 기프트 여부. false면 "있으면 좋은" 옵션 */
  required: boolean;
}

/**
 * 팩 방문 순서 한 항목 (README §8.2 `pack_order[]`).
 * `packs.json` 의 id 를 참조한다.
 */
export interface PackOrderItem {
  pack_id: string;
  /** 방문 목표 층 */
  floor: number;
  /** 방문 시점의 난이도 */
  difficulty: DifficultyMode;
  /** 방문 우선순위(1부터) */
  priority: number;
  /** 팩별 메모 (없으면 null) */
  memo: string | null;
  /** 대체 팩 여부 (주력 팩이 안 나올 때 들어갈 수 있는 팩). 기본 false */
  alternative?: boolean;
}

/** 시작 기프트 선택 1개 (키워드 그룹 내 다중 선택용) */
export interface StartingGiftPick {
  /** `gifts.json` / dungeon_meta 의 gift_id */
  gift_id: string;
  /** 표시용 이름 */
  name: string;
}

/**
 * 탐사 시작 시 선택한 시작 기프트 (README §8.2 `starting_gift`).
 * `dungeon_meta.json` 의 `starting_gifts` 에서 키워드 1개를 고르고
 * 그 키워드의 기프트를 여러 개 선택한다. 미선택이면 루트의 값은 null.
 */
export interface RouteStartingGift {
  /** 키워드 타입 (예: "호흡") */
  keyword_type: string;
  /** 선택한 시작 기프트 목록 (해당 키워드 그룹 내) */
  gifts: StartingGiftPick[];
}

/** 루트에 포함된 별의 가호 1개 (README §8.2 `gahos[]`) */
export interface RouteGaho {
  /** `dungeon_meta.json` 의 gaho id */
  gaho_id: string;
  /** 표시용 이름 */
  name: string;
  /** 강화 단계. 0 = 기본 / 1 = + / 2 = ++ */
  stage: number;
}

/** EXTREME 모드에서 층별 선택한 제약 1개 (README §8.2 `restrictions`) */
export interface RouteRestriction {
  /** 제약 이름 (dungeon_meta restrictions_by_floor 의 name) */
  name: string;
  /** 제약 선택 시 획득 점수 */
  score: number;
}

/**
 * 층(11~15) → 선택한 제약 목록.
 * `difficulty_mode: "extreme"` 일 때만 유효하다.
 */
export type RouteRestrictions = Record<string, RouteRestriction[]>;

/**
 * 로컬 `my_routes.json`에 저장되는 루트 1건 (README §8.2).
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
  /** 난이도 태그 */
  difficulty_tag: DifficultyTag;
  /** 루트 유형 */
  route_type: RouteType;
  /** 루트 최종 목표 난이도 */
  difficulty_mode: DifficultyMode;
  /** 노말 → 하드 전환 층. null이면 단일 난이도 */
  difficulty_switch_floor: number | null;
  /** 거던 층수 목록 */
  floors: number[];
  /** 자유 메모 */
  memo: string;
  /** 기프트 획득 순서 */
  gift_order: GiftOrderItem[];
  /** 팩 방문 순서 */
  pack_order: PackOrderItem[];
  /** 시작 기프트(1개). 미선택이면 null */
  starting_gift: RouteStartingGift | null;
  /** 별의 가호 목록 */
  gahos: RouteGaho[];
  /** EXTREME 모드 층별 제약. extreme이 아니면 빈 객체 */
  restrictions: RouteRestrictions;
}

/** 패치 버전별 통계 */
export interface RouteStat {
  likes: number;
  play_count: number;
}

/**
 * 서버에 공개되는 루트 데이터 구조 (README §8.4).
 * 6자리 코드로 식별되며, 통계는 패치 버전을 키로 독립 관리한다.
 * 시작 기프트 / 가호 / 제약은 로컬 전용이라 공개본에는 포함하지 않는다.
 */
export interface SharedRoute {
  route_code: string;
  patch_version: string;
  name: string;
  difficulty_tag: DifficultyTag;
  route_type: RouteType;
  difficulty_mode: DifficultyMode;
  difficulty_switch_floor: number | null;
  target_rewards: string[];
  floors: number[];
  memo: string;
  gift_order: GiftOrderItem[];
  pack_order: PackOrderItem[];
  verified_method: VerifiedMethod;
  /** 패치 버전을 키로 하는 통계 맵 (예: { "2.7": { likes, play_count } }) */
  stats: Record<string, RouteStat>;
  uploaded_at: string;
}

/** 새 루트 작성 폼 입력값 (LocalRoute 중 사용자가 직접 채우는 부분) */
export interface RouteDraft {
  name: string;
  target_rewards: string[];
  difficulty_tag: DifficultyTag;
  route_type: RouteType;
  difficulty_mode: DifficultyMode;
  difficulty_switch_floor: number | null;
  floors: number[];
  memo: string;
  gift_order: GiftOrderItem[];
  pack_order: PackOrderItem[];
  starting_gift: RouteStartingGift | null;
  gahos: RouteGaho[];
  restrictions: RouteRestrictions;
}
