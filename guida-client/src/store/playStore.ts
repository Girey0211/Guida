/**
 * 플레이 세션 상태 (README §8.4 / §11.3).
 * 거던 탐사 진행 중 데이터를 메모리로 유지한다.
 *  - acquiredGifts: 획득 완료한 목표 에고기프트(재화) 이름 목록
 *  - visitedPacks: 방문 완료한 팩(층) 번호 목록
 *  - routeSwitchedAtFloor: 플레이 중 루트를 변경한 시점의 층 (§11.4)
 */

import { create } from "zustand";

/** 세션 ID 생성 (sess_YYYYMMDD_랜덤) */
function newSessionId(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `sess_${ymd}_${rand}`;
}

interface PlayState {
  /** 활성 세션 ID (null이면 탐사 중 아님) */
  sessionId: string | null;
  /** 현재 사용 중인 로컬 루트 ID */
  activeRouteId: string | null;
  /** 세션 시작 시각 (ISO) */
  startedAt: string | null;
  /** 현재 층 */
  currentFloor: number;
  /** 획득 완료한 목표 에고기프트(재화) 이름 */
  acquiredGifts: string[];
  /** 방문 완료한 팩(층) 번호 */
  visitedPacks: number[];
  /** 플레이 중 루트를 변경한 시점의 층 (변경 없으면 null) */
  routeSwitchedAtFloor: number | null;

  /** 탐사 시작: 새 세션 생성 후 진행 데이터 초기화 */
  startSession: (routeId: string) => void;
  /** 탐사 종료: 세션/진행 데이터 모두 초기화 */
  endSession: () => void;
  /**
   * 플레이 중 루트 변경 (§11.4).
   * 획득/방문 완료 데이터는 보존하고 변경 시점 층만 기록한다.
   */
  switchRoute: (routeId: string) => void;
  /** 현재 층 설정 */
  setFloor: (floor: number) => void;
  /** 목표 에고기프트 획득 여부 토글 */
  toggleGift: (gift: string) => void;
  /** 팩(층) 방문 여부 토글 */
  togglePack: (pack: number) => void;
}

export const usePlayStore = create<PlayState>((set) => ({
  sessionId: null,
  activeRouteId: null,
  startedAt: null,
  currentFloor: 1,
  acquiredGifts: [],
  visitedPacks: [],
  routeSwitchedAtFloor: null,

  startSession: (routeId) =>
    set({
      sessionId: newSessionId(),
      activeRouteId: routeId,
      startedAt: new Date().toISOString(),
      currentFloor: 1,
      acquiredGifts: [],
      visitedPacks: [],
      routeSwitchedAtFloor: null,
    }),

  endSession: () =>
    set({
      sessionId: null,
      activeRouteId: null,
      startedAt: null,
      currentFloor: 1,
      acquiredGifts: [],
      visitedPacks: [],
      routeSwitchedAtFloor: null,
    }),

  switchRoute: (routeId) =>
    set((s) => ({
      activeRouteId: routeId,
      // 획득/방문 데이터는 그대로 보존, 변경 시점 층만 기록
      routeSwitchedAtFloor: s.currentFloor,
    })),

  setFloor: (currentFloor) => set({ currentFloor }),

  toggleGift: (gift) =>
    set((s) => ({
      acquiredGifts: s.acquiredGifts.includes(gift)
        ? s.acquiredGifts.filter((g) => g !== gift)
        : [...s.acquiredGifts, gift],
    })),

  togglePack: (pack) =>
    set((s) => ({
      visitedPacks: s.visitedPacks.includes(pack)
        ? s.visitedPacks.filter((p) => p !== pack)
        : [...s.visitedPacks, pack],
    })),
}));
