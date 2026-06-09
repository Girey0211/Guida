/**
 * 루트 데이터 상태.
 *  - 로컬 루트(my_routes.json) CRUD
 *  - 공유 허브 업로드 / 탐색 / 추천
 */

import { create } from "zustand";
import type { LocalRoute, RouteDraft, SharedRoute } from "@/types/route";
import { generateLocalId } from "@/lib/utils";
import { readJson, writeJson } from "@/lib/storage";
import * as routesApi from "@/api/routes";
import { useAppStore } from "./appStore";

const ROUTES_FILE = "my_routes.json";

interface RoutesFile {
  routes: LocalRoute[];
}

interface RouteState {
  /** 로컬에 저장된 내 루트 */
  myRoutes: LocalRoute[];
  /** 공유 허브에서 받아온 전체 루트 */
  hubRoutes: SharedRoute[];
  loadingHub: boolean;
  hubError: string | null;

  /** 로컬 루트 로드 */
  loadMyRoutes: () => Promise<void>;
  /** 새 루트 작성/저장 (verified는 자기 신고 체크박스로 결정) */
  createRoute: (draft: RouteDraft, selfReported: boolean) => Promise<LocalRoute>;
  /** 루트 수정 */
  updateRoute: (localId: string, draft: RouteDraft, selfReported: boolean) => Promise<void>;
  /** 루트 삭제 */
  deleteRoute: (localId: string) => Promise<void>;
  /** 루트 공유 → 6자리 코드 발급받아 로컬에 반영 */
  shareRoute: (localId: string) => Promise<string>;

  /** 허브 전체 루트 로드 */
  loadHub: () => Promise<void>;
  /** 추천 */
  likeHubRoute: (code: string) => Promise<void>;
  /** 코드로 단건 조회 → 로컬로 가져오기(import) */
  importByCode: (code: string) => Promise<LocalRoute>;
}

function persist(routes: LocalRoute[]): Promise<void> {
  return writeJson(ROUTES_FILE, { routes } satisfies RoutesFile);
}

export const useRouteStore = create<RouteState>((set, get) => ({
  myRoutes: [],
  hubRoutes: [],
  loadingHub: false,
  hubError: null,

  loadMyRoutes: async () => {
    const file = await readJson<RoutesFile>(ROUTES_FILE, { routes: [] });
    set({ myRoutes: file.routes });
  },

  createRoute: async (draft, selfReported) => {
    const now = new Date().toISOString();
    const route: LocalRoute = {
      local_id: generateLocalId(),
      created_at: now,
      patch_version: useAppStore.getState().settings.current_patch,
      verified: selfReported,
      verified_method: "self_report",
      verified_at: selfReported ? now : undefined,
      ...draft,
    };
    const next = [route, ...get().myRoutes];
    set({ myRoutes: next });
    await persist(next);
    return route;
  },

  updateRoute: async (localId, draft, selfReported) => {
    const now = new Date().toISOString();
    const next = get().myRoutes.map((r) =>
      r.local_id === localId
        ? {
            ...r,
            ...draft,
            verified: selfReported,
            verified_at: selfReported ? r.verified_at ?? now : undefined,
          }
        : r,
    );
    set({ myRoutes: next });
    await persist(next);
  },

  deleteRoute: async (localId) => {
    const next = get().myRoutes.filter((r) => r.local_id !== localId);
    set({ myRoutes: next });
    await persist(next);
  },

  shareRoute: async (localId) => {
    const route = get().myRoutes.find((r) => r.local_id === localId);
    if (!route) throw new Error("루트를 찾을 수 없습니다.");
    if (!route.verified) {
      throw new Error("공유하려면 먼저 '실제로 플레이했습니다' 확인이 필요합니다.");
    }

    const { uuid, settings } = useAppStore.getState();
    const shared = await routesApi.uploadRoute({
      uuid,
      patch_version: settings.current_patch,
      route: {
        name: route.name,
        difficulty_tag: route.difficulty_tag,
        route_type: route.route_type,
        target_rewards: route.target_rewards,
        floors: route.floors,
        steps: route.steps,
        memo: route.memo,
        verified_method: route.verified_method,
      },
    });

    // 발급받은 코드를 로컬 루트에 반영
    const next = get().myRoutes.map((r) =>
      r.local_id === localId ? { ...r, shared_code: shared.route_code } : r,
    );
    set({ myRoutes: next });
    await persist(next);
    return shared.route_code;
  },

  loadHub: async () => {
    set({ loadingHub: true, hubError: null });
    try {
      const routes = await routesApi.listRoutes();
      set({ hubRoutes: routes, loadingHub: false });
    } catch (e) {
      set({
        loadingHub: false,
        hubError: e instanceof Error ? e.message : "허브 로드 실패",
      });
    }
  },

  likeHubRoute: async (code) => {
    const { uuid, settings } = useAppStore.getState();
    const updated = await routesApi.likeRoute(uuid, code, settings.current_patch);
    set({
      hubRoutes: get().hubRoutes.map((r) => (r.route_code === code ? updated : r)),
    });
  },

  importByCode: async (code) => {
    const shared = await routesApi.getRouteByCode(code);
    const now = new Date().toISOString();
    const local: LocalRoute = {
      local_id: generateLocalId(),
      name: shared.name,
      created_at: now,
      patch_version: shared.patch_version,
      verified: false,
      verified_method: "self_report",
      shared_code: shared.route_code,
      target_rewards: shared.target_rewards,
      floors: shared.floors,
      difficulty_tag: shared.difficulty_tag,
      route_type: shared.route_type,
      steps: shared.steps,
      memo: shared.memo,
    };
    const next = [local, ...get().myRoutes];
    set({ myRoutes: next });
    await persist(next);
    return local;
  },
}));
