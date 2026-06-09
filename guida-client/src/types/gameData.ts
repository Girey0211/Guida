/**
 * 게임 데이터 스키마.
 * 거울 던전 이벤트/선택지/보상 정보를 담는다. 서버(CDN)에서 배포되며
 * 패치마다 갱신된다. 오프라인 시 로컬 캐시본으로 동작한다.
 */

/** 선택지가 제공하는 보상 항목 */
export interface ChoiceReward {
  /** 보상 재화/아이템 이름 (예: "루심화폐", "황금가지") */
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
}
