import type { DifficultyMode, DifficultyTag, RouteType } from "./route";

/** 정렬 기준 */
export type SortBy = "likes" | "recent" | "play_count";

/** 패치 버전 필터 */
export type PatchFilter = "current" | "all" | string;

/** 검증 여부 필터 */
export type VerifiedFilter = "all" | "verified_only";

/**
 * 루트 탐색 필터 (README 섹션 6).
 * 패치 버전 기본값은 항상 "현재 패치"로 고정된다.
 */
export interface RouteFilterState {
  /** 패치 버전: current(현재) / all(전체) / 특정 버전 */
  patch: PatchFilter;
  /** 정렬 기준 */
  sortBy: SortBy;
  /** 검증 여부 */
  verified: VerifiedFilter;
  /** 목표 재화 (빈 문자열이면 전체) */
  targetReward: string;
  /** 거던 층수 (특정 층 집중, null이면 전체) */
  floor: number | null;
  /** 난이도 태그 (null이면 전체) */
  difficulty: DifficultyTag | null;
  /** 난이도 모드 — 노말/하드/EXTREME (null이면 전체) */
  difficultyMode: DifficultyMode | null;
  /** 루트 유형 (null이면 전체) */
  routeType: RouteType | null;
  /** 최소 추천수 */
  minLikes: number;
  /** 최소 플레이수 */
  minPlays: number;
}

export const DEFAULT_FILTER: RouteFilterState = {
  patch: "current",
  sortBy: "likes",
  verified: "verified_only",
  targetReward: "",
  floor: null,
  difficulty: null,
  difficultyMode: null,
  routeType: null,
  minLikes: 0,
  minPlays: 0,
};
