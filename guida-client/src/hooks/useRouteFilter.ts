/**
 * 루트 필터/정렬 로직 훅 (README 섹션 6).
 */

import { useMemo } from "react";
import type { SharedRoute } from "@/types/route";
import type { RouteFilterState } from "@/types/filter";

/** 특정 패치 기준 통계를 합산하여 추천/플레이 수를 구한다 */
function statFor(route: SharedRoute, patch: string): { likes: number; plays: number } {
  // "current"/"all"의 경우 전체 합산, 특정 버전이면 해당 버전만
  if (patch === "all") {
    return Object.values(route.stats).reduce(
      (acc, s) => ({ likes: acc.likes + s.likes, plays: acc.plays + s.play_count }),
      { likes: 0, plays: 0 },
    );
  }
  const s = route.stats[patch];
  return { likes: s?.likes ?? 0, plays: s?.play_count ?? 0 };
}

export function useRouteFilter(
  routes: SharedRoute[],
  filter: RouteFilterState,
  currentPatch: string,
): SharedRoute[] {
  return useMemo(() => {
    // 통계 집계 기준 패치
    const statPatch =
      filter.patch === "current" ? currentPatch : filter.patch === "all" ? "all" : filter.patch;

    let result = routes.filter((r) => {
      // 패치 버전 필터
      if (filter.patch === "current" && r.patch_version !== currentPatch) return false;
      if (filter.patch !== "current" && filter.patch !== "all" && r.patch_version !== filter.patch)
        return false;

      // 검증 여부
      if (filter.verified === "verified_only" && r.verified_method !== "self_report" && r.verified_method !== "ocr")
        return false;

      // 목표 재화
      if (filter.targetReward && !r.target_rewards.includes(filter.targetReward)) return false;

      // 거던 층수
      if (filter.floor != null && !r.floors.includes(filter.floor)) return false;

      // 난이도
      if (filter.difficulty && r.difficulty_tag !== filter.difficulty) return false;

      // 루트 유형
      if (filter.routeType && r.route_type !== filter.routeType) return false;

      // 신뢰도(최소 추천/플레이)
      const { likes, plays } = statFor(r, statPatch);
      if (likes < filter.minLikes) return false;
      if (plays < filter.minPlays) return false;

      return true;
    });

    // 정렬
    result = [...result].sort((a, b) => {
      const sa = statFor(a, statPatch);
      const sb = statFor(b, statPatch);
      switch (filter.sortBy) {
        case "likes":
          return sb.likes - sa.likes;
        case "play_count":
          return sb.plays - sa.plays;
        case "recent":
          return new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime();
      }
    });

    return result;
  }, [routes, filter, currentPatch]);
}

/** 표시용: 현재 필터 기준 패치의 통계 반환 */
export function routeStats(
  route: SharedRoute,
  filter: RouteFilterState,
  currentPatch: string,
): { likes: number; plays: number } {
  const statPatch =
    filter.patch === "current" ? currentPatch : filter.patch === "all" ? "all" : filter.patch;
  return statFor(route, statPatch);
}
