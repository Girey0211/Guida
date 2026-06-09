/**
 * 거던 가이드 상태.
 * 현재 파밍 목표(target reward)와 현재 보고 있는 층을 관리하며,
 * 게임 데이터로부터 "최적 선택지"를 도출한다.
 */

import { create } from "zustand";
import type { EventChoice, GameData, MirrorEvent } from "@/types/gameData";

interface GuideState {
  /** 유저가 설정한 파밍 목표 (빈 문자열이면 전체 보기) */
  targetReward: string;
  /** 현재 보고 있는 층 (null이면 전체 층) */
  currentFloor: number | null;

  setTargetReward: (reward: string) => void;
  setCurrentFloor: (floor: number | null) => void;
}

export const useGuideStore = create<GuideState>((set) => ({
  targetReward: "",
  currentFloor: null,
  setTargetReward: (targetReward) => set({ targetReward }),
  setCurrentFloor: (currentFloor) => set({ currentFloor }),
}));

/** 특정 선택지가 현재 목표에 추천되는지 판정 */
export function isRecommended(choice: EventChoice, target: string): boolean {
  if (!target) return false;
  if (choice.recommendedFor?.includes(target)) return true;
  // recommendedFor에 없어도 보상에 직접 목표가 포함되면 추천
  return choice.rewards.some((r) => r.item === target);
}

/** 이벤트 내에서 현재 목표에 가장 적합한 선택지 id를 반환 (없으면 null) */
export function bestChoiceId(event: MirrorEvent, target: string): string | null {
  if (!target) return null;
  let best: { id: string; amount: number } | null = null;
  for (const choice of event.choices) {
    if (!isRecommended(choice, target)) continue;
    const amount = choice.rewards
      .filter((r) => r.item === target)
      .reduce((sum, r) => sum + (r.amount ?? 1), 0);
    if (!best || amount > best.amount) {
      best = { id: choice.id, amount };
    }
  }
  return best?.id ?? null;
}

/** 현재 층/목표 기준으로 표시할 이벤트 목록을 필터링 */
export function filterEvents(
  gameData: GameData | null,
  floor: number | null,
  target: string,
): MirrorEvent[] {
  if (!gameData) return [];
  let events = gameData.events;
  if (floor != null) {
    events = events.filter((e) => e.floors.length === 0 || e.floors.includes(floor));
  }
  if (target) {
    // 목표 보상을 제공하는 선택지가 하나라도 있는 이벤트 우선
    events = events.filter((e) => e.choices.some((c) => isRecommended(c, target)));
  }
  return events;
}
