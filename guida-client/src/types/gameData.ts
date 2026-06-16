/**
 * 게임 데이터 스키마.
 * 거울 던전 이벤트/선택지/보상 정보를 담는다. 서버(CDN)에서 배포되며
 * 패치마다 갱신된다. 오프라인 시 로컬 캐시본으로 동작한다.
 */

/** 선택지가 제공하는 보상 항목 */
export interface ChoiceReward {
  /** 보상 재화/아이템 이름 (예: "주간보상") */
  item: string;
  /** 수량 (불확정 시 생략 가능) */
  amount?: number;
  /** 이미지 파일명 (지연 로딩 대상, 예: "greg_01.webp") */
  image?: string;
}

/** 이벤트 내 단일 선택지 */
export interface EventChoice {
  id: string;
  /** 선택지에 표시되는 문구 */
  label: string;
  /** 이 선택지를 골랐을 때의 보상 목록 */
  rewards: ChoiceReward[];
  /** 위험/주의 요소 설명 (선택) */
  risk?: string;
  /** 작성자가 권장하는 파밍 목적 태그 (이 선택지가 유리한 목표 재화들) */
  recommendedFor?: string[];
}

/** 거울 던전에서 조우하는 이벤트 */
export interface MirrorEvent {
  id: string;
  /** 이벤트 이름 */
  name: string;
  /** 주로 등장하는 층 (전체면 빈 배열) */
  floors: number[];
  /** 이벤트 설명 */
  description?: string;
  /** 선택지 목록 */
  choices: EventChoice[];
}

/** 게임 데이터 전체 (`game_data.json`) */
export interface GameData {
  /** 이 데이터가 작성된 기준 패치 버전 */
  patch_version: string;
  /** 선택 가능한 목표 재화 사전 (필터/추천에 사용) */
  targetRewards: string[];
  /** 거울 던전 이벤트 목록 */
  events: MirrorEvent[];
}

/** 현재 패치 버전 정보 (`patch_version.json`) */
export interface PatchInfo {
  /** 현재 패치 버전 (예: "2.4") */
  current_patch: string;
  /** 패치 적용 일시 (ISO) */
  updated_at: string;
  /** 패치 노트 요약 (선택) */
  note?: string;
  /**
   * 서버가 선언하는 최소 허용 앱 버전(semver, 예: "0.2.0").
   * 현재 앱 버전이 이 값보다 낮으면 강제 업데이트 게이트로 진입한다.
   * 평소엔 GitHub Releases가 최신 여부의 단일 진실원이고, 이 필드는
   * 긴급 차단(서버 호환성 깨짐 등)을 즉시 거는 비상 레버다. 없으면 미적용.
   */
  min_app_version?: string;
}

// ───────────────────────────────────────────────────────────────────
// 게임 데이터 엔티티 (README §8.5) — 에고기프트 / 팩 / 의존성 / 던전 메타
// 루트 작성기(gift_order / pack_order / starting_gift / gahos / restrictions)가
// 참조한다. CDN(서버 data/*.json)에서 배포되며 패치마다 갱신된다.
// ───────────────────────────────────────────────────────────────────

/** 키워드 타입 (배지 색상 식별의 핵심) */
export type KeywordType =
  | "화상"
  | "출혈"
  | "진동"
  | "파열"
  | "침잠"
  | "호흡"
  | "충전"
  | "참격"
  | "관통"
  | "타격"
  | "범용";

/** 에고기프트 1개 (`gifts.json`) */
export interface Gift {
  id: string;
  name: string;
  /** 이미지 키 (Phase 2~ 지연 로딩, 없으면 null) */
  image_key: string | null;
  ocr_keywords: string[];
  keyword_type: KeywordType;
  /** 키워드 배지 색상 (#RRGGBB) */
  keyword_color: string;
  /** 등급 (문자열, 예: "2" / "3") */
  grade: string;
  /** 하드 난이도에서만 등장하는 기프트 여부 */
  hard_mode_only: boolean;
  /** 특정 팩에서만 획득 가능한지 여부 */
  pack_exclusive: boolean;
  /** 전용 팩 id (없으면 null) */
  pack_id: string | null;
  effect: string;
  upgradeable: boolean;
  first_appeared: string | null;
  related: string | null;
  is_craftable: boolean;
  /** 합성 재료 (없으면 null) */
  craft_recipe: {
    type: "simple" | "multi_path" | "required_and_pick" | string;
    required?: string[];
    paths?: string[][];
    pick?: {
      count: number;
      from: string[];
    };
  } | null;
  /** 이 기프트가 재료로 쓰일 때의 결과물 gift_id 배열 (없으면 null) */
  craft_result_of: string[] | null;
  source_type: string;
  source_category: string;
  added_patch: string | null;
  tags: string[];
}

/** 팩 드랍 풀의 기프트 참조 */
export interface PackGiftRef {
  name: string;
  /** 매칭되는 gift_id (미매칭이면 null) */
  gift_id: string | null;
}

/** 팩 1개 (`packs.json`) */
export interface Pack {
  id: string;
  name: string;
  image_key: string | null;
  ocr_keywords: string[];
  pack_type: string;
  story_chapter: string | null;
  /** 노말 난이도 등장 가능 층. null이면 노말 미등장 */
  available_floors_normal: number[] | null;
  /** 하드 난이도 등장 가능 층. null이면 하드 미등장 */
  available_floors_hard: number[] | null;
  /** 노말 등장 여부 (null 체크 생략용) */
  available_in_normal: boolean;
  /** 하드 등장 여부 (null 체크 생략용) */
  available_in_hard: boolean;
  floor_length: number;
  bosses: string[];
  /** 통상 기프트 풀 그룹 코드 목록 (A~J) */
  gift_groups: string[];
  /** 이 팩에서만 얻을 수 있는 전용 기프트 목록 */
  exclusive_gifts: { name: string; gift_id: string }[];
  is_hidden: boolean;
  is_extreme_only: boolean;
  added_patch: string | null;
  tags: string[];
  /** 드랍 기프트 풀 (그룹/전용/키워드 등 가공된 목록, 선택) */
  gift_pool?: PackGiftRef[];
  /** 드랍 풀 구성 방식 (예: "그룹_지정" / "모든_통상_기프트") */
  gift_pool_type?: string;
  /** 키워드 친화도 (선택) */
  keyword_affinity?: unknown;
}

/** 기프트 순서 의존성 종류 (README §8.5) */
export type DependencyType = "before" | "after" | "with" | "excludes";

/** 의존성 한 항목 */
export interface DependencyEdge {
  target: {
    gift_id: string;
    name: string;
  };
  type: DependencyType;
  required: boolean;
  reason: string;
}

/** 기프트별 의존성 (`dependencies.json`) */
export interface GiftDependency {
  gift_id: string;
  dependencies: DependencyEdge[];
}

// ── dungeon_meta.json (README §8.5) ────────────────────────────────

/** 시작 기프트 선택지 1개 */
export interface StartingGiftOption {
  name: string;
  gift_id: string;
}

/** 키워드별 시작 기프트 그룹 (키워드당 3개 중 1개 선택) */
export interface StartingGiftGroup {
  keyword_type: string;
  /** 시작 기프트 등급 (현재 시즌 기준 모두 "2") */
  grade: string;
  gifts: StartingGiftOption[];
}

/** 별의 가호 1개 */
export interface DungeonGaho {
  id: string;
  name: string;
  /** 해금에 필요한 별빛 보너스 점수 */
  required_bonus_points: number;
  description: string;
  /** 강화 단계 라벨 (예: ["기본", "+", "++"]) */
  stages: string[];
  /** 최대 강화 단계 (항상 2) */
  max_stage: number;
}

/** EXTREME 모드 층별 선택 가능한 제약 1개 */
export interface FloorRestriction {
  name: string;
  effect: string;
  /** 제약 선택 시 획득 점수 */
  score: number;
  /** 별빛 보너스 + 투영도 획득량 (예: "1515") */
  bonus: string;
}

/**
 * 시즌별 던전 메타 데이터 (`dungeon_meta.json`).
 * 시작 기프트 / 별의 가호 / EXTREME 제약을 담는다.
 * patch_version.json 과 달리 패치마다 바뀌지 않고 새 거울 던전 시즌마다 교체된다.
 */
export interface DungeonMeta {
  dungeon_name: string;
  dungeon_season: number;
  starting_gifts: StartingGiftGroup[];
  gahos: DungeonGaho[];
  /** 층("11"~"15") → 선택 가능한 제약 목록 */
  restrictions_by_floor: Record<string, FloorRestriction[]>;
}

/** 인격(identity) 필드 */
export interface Identity {
  identity_id: string;
  name: string;
  sinner: string;
  rarity: "0" | "00" | "000";
  release_date: string;
  code_index: number;
  page_order: number;
  trait_keywords: string[];
  resists: {
    참격: "취약" | "보통" | "내성";
    관통: "취약" | "보통" | "내성";
    타격: "취약" | "보통" | "내성";
  };
  attack_types: ("참격" | "관통" | "타격")[];
  sin_affinities: string[];
  keyword_types: KeywordType[];
  skills: {
    attack_type: "참격" | "관통" | "타격";
    sin: string;
  }[];
}

/** 에고(ego) 필드 */
export interface Ego {
  ego_id: string;
  name: string;
  sinner: string;
  grade: "ZAYIN" | "TETH" | "HE" | "WAW" | "ALEPH";
  release_date: string;
  code_index: number;
  page_order: number;
  resists: Record<string, string> | null;
  sin_affinities: string[];
  resource_sins: Record<string, number> | null;
  keyword_types: KeywordType[] | null;
}

/** 수감자(sinner) 객체 */
export interface Sinner {
  sinner_id: string;
  name: string;
  slot_index: number;
  identity_count: number;
  ego_count: number;
  identities: Identity[];
  egos: Ego[];
}

