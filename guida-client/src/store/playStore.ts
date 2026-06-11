/**
 * 플레이 세션 상태 (README §8.3 / §11.3).
 * 거던 탐사 진행 중 데이터를 메모리로 유지한다.
 *  - acquiredGifts: 획득 완료한 목표 에고기프트 gift_id 목록 (gift_order 참조)
 *  - visitedPacks: 방문 완료한 팩 pack_id 목록 (pack_order 참조)
 *  - routeSwitchedAtFloor: 플레이 중 루트를 변경한 시점의 층 (§11.4)
 */

import { create } from "zustand";
import { writeJson } from "@/lib/storage";

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
  /** 획득 완료한 목표 에고기프트 gift_id */
  acquiredGifts: string[];
  /** 방문 완료한 팩 pack_id */
  visitedPacks: string[];
  /** 플레이 중 루트를 변경한 시점의 층 (변경 없으면 null) */
  routeSwitchedAtFloor: number | null;

  /** 세션 복원 (앱 구동 시 파일로부터 수신) */
  restoreSession: (session: Partial<PlayState>) => void;
  /** 탐사 시작: 새 세션 생성 후 진행 데이터 초기화 */
  startSession: (routeId: string) => void;
  /** 탐사 종료: 세션/진행 데이터 모두 초기화 */
  endSession: () => void;
  /**
   * 플레이 중 루트 변경 (§11.4).
   * 획득/방문 데이터는 보존하고 변경 시점 층만 기록한다.
   */
  switchRoute: (routeId: string) => void;
  /** 현재 층 설정 */
  setFloor: (floor: number) => void;
  /** 목표 에고기프트 획득 여부 토글 (gift_id) */
  toggleGift: (giftId: string) => void;
  /** 팩 방문 여부 토글 (pack_id) */
  togglePack: (packId: string) => void;
}

function saveSession(state: {
  sessionId: string | null;
  activeRouteId: string | null;
  startedAt: string | null;
  currentFloor: number;
  acquiredGifts: string[];
  visitedPacks: string[];
  routeSwitchedAtFloor: number | null;
}) {
  const data = state.sessionId
    ? {
        sessionId: state.sessionId,
        activeRouteId: state.activeRouteId,
        startedAt: state.startedAt,
        currentFloor: state.currentFloor,
        acquiredGifts: state.acquiredGifts,
        visitedPacks: state.visitedPacks,
        routeSwitchedAtFloor: state.routeSwitchedAtFloor,
      }
    : null;
  void writeJson("play_session.json", data);
}

export const usePlayStore = create<PlayState>((set) => ({
  sessionId: null,
  activeRouteId: null,
  startedAt: null,
  currentFloor: 1,
  acquiredGifts: [],
  visitedPacks: [],
  routeSwitchedAtFloor: null,

  restoreSession: (session) =>
    set({
      sessionId: session.sessionId ?? null,
      activeRouteId: session.activeRouteId ?? null,
      startedAt: session.startedAt ?? null,
      currentFloor: session.currentFloor ?? 1,
      acquiredGifts: session.acquiredGifts ?? [],
      visitedPacks: session.visitedPacks ?? [],
      routeSwitchedAtFloor: session.routeSwitchedAtFloor ?? null,
    }),

  startSession: (routeId) => {
    const next = {
      sessionId: newSessionId(),
      activeRouteId: routeId,
      startedAt: new Date().toISOString(),
      currentFloor: 1,
      acquiredGifts: [],
      visitedPacks: [],
      routeSwitchedAtFloor: null,
    };
    set(next);
    saveSession(next);
  },

  endSession: () => {
    const next = {
      sessionId: null,
      activeRouteId: null,
      startedAt: null,
      currentFloor: 1,
      acquiredGifts: [],
      visitedPacks: [],
      routeSwitchedAtFloor: null,
    };
    set(next);
    saveSession(next);
  },

  switchRoute: (routeId) =>
    set((s) => {
      const next = {
        ...s,
        activeRouteId: routeId,
        routeSwitchedAtFloor: s.currentFloor,
      };
      saveSession(next);
      return {
        activeRouteId: routeId,
        routeSwitchedAtFloor: s.currentFloor,
      };
    }),

  setFloor: (currentFloor) =>
    set((s) => {
      const next = { ...s, currentFloor };
      saveSession(next);
      return { currentFloor };
    }),

  toggleGift: (giftId) =>
    set((s) => {
      const acquiredGifts = s.acquiredGifts.includes(giftId)
        ? s.acquiredGifts.filter((g) => g !== giftId)
        : [...s.acquiredGifts, giftId];
      const next = { ...s, acquiredGifts };
      saveSession(next);
      return { acquiredGifts };
    }),

  togglePack: (packId) =>
    set((s) => {
      const visitedPacks = s.visitedPacks.includes(packId)
        ? s.visitedPacks.filter((p) => p !== packId)
        : [...s.visitedPacks, packId];
      const next = { ...s, visitedPacks };
      saveSession(next);
      return { visitedPacks };
    }),
}));
