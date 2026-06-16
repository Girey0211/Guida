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
  /** 루트 검증 (탐사 완료 시 호출) */
  verifyRoute: (localId: string) => Promise<void>;
  /** 루트 공유 → 6자리 코드 발급받아 로컬에 반영 */
  shareRoute: (localId: string) => Promise<string>;
  /** 가져온 루트 서버 버전 동기화 */
  syncRoute: (localId: string) => Promise<void>;
  /** 공유 허브의 공유 루트 삭제 */
  deleteSharedRoute: (code: string) => Promise<void>;

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
    let changed = false;
    const routes = file.routes.map((r) => {
      if (r.imported_from && !r.verified) {
        changed = true;
        return { ...r, verified: true };
      }
      return r;
    });
    set({ myRoutes: routes });
    if (changed) {
      await writeJson(ROUTES_FILE, { routes } satisfies RoutesFile);
    }
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
      play_count: 0,
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

  verifyRoute: async (localId) => {
    const route = get().myRoutes.find((r) => r.local_id === localId);
    if (!route) return;

    const { uuid, settings } = useAppStore.getState();
    const code = route.imported_from || route.shared_code;

    if (code) {
      try {
        await routesApi.recordPlay(uuid, code, settings.current_patch);
      } catch (e) {
        console.error("Failed to record play on server:", e);
      }
    }

    const now = new Date().toISOString();
    const next = get().myRoutes.map((r) =>
      r.local_id === localId
        ? {
            ...r,
            verified: true,
            verified_at: r.verified_at ?? now,
            play_count: (r.play_count ?? 0) + 1,
          }
        : r,
    );
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
    const payload = {
      uuid,
      patch_version: settings.current_patch,
      route: {
        name: route.name,
        difficulty_tag: route.difficulty_tag,
        difficulty_mode: route.difficulty_mode,
        difficulty_switch_floor: route.difficulty_switch_floor,
        target_rewards: route.target_rewards,
        floors: route.floors,
        memo: route.memo,
        gift_order: route.gift_order,
        pack_order: route.pack_order,
        verified_method: route.verified_method,
        deck_code: route.deck_code,
      },
    };

    let code: string;
    if (route.shared_code) {
      // 내가 이미 발행한 루트 → 수정 업로드 (서버가 uploader_uuid 일치 검증).
      // 서버에서 루트가 사라졌으면(NOT_FOUND) 새로 업로드로 폴백한다.
      try {
        const updated = await routesApi.updateRoute(route.shared_code, payload);
        code = updated.route_code;
      } catch (e) {
        if (e instanceof routesApi.ApiError && e.code === "NOT_FOUND") {
          code = (await routesApi.uploadRoute(payload)).route_code;
        } else {
          throw e;
        }
      }
    } else {
      // 신규 발행
      code = (await routesApi.uploadRoute(payload)).route_code;
    }

    // 발급/유지된 코드를 로컬 루트에 반영
    const next = get().myRoutes.map((r) =>
      r.local_id === localId ? { ...r, shared_code: code } : r,
    );
    set({ myRoutes: next });
    await persist(next);
    return code;
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
      verified: true,
      verified_method: shared.verified_method,
      // 가져온 루트는 내가 발행한 게 아니므로 shared_code 가 아니라 출처(imported_from)로 기록한다.
      // 이래야 재공유 시 남의 루트를 덮어쓰지 않고 내 코드로 새로 발행된다.
      imported_from: shared.route_code,
      deck_code: shared.deck_code,
      target_rewards: shared.target_rewards,
      floors: shared.floors,
      difficulty_tag: shared.difficulty_tag,
      difficulty_mode: shared.difficulty_mode,
      difficulty_switch_floor: shared.difficulty_switch_floor,
      memo: shared.memo,
      gift_order: shared.gift_order,
      pack_order: shared.pack_order,
      // 시작 기프트 / 가호 / 제약은 로컬 전용이라 공개본에 없음 → 빈 값으로 시작
      starting_gift: null,
      gahos: [],
      restrictions: {},
      play_count: 0,
    };
    const next = [local, ...get().myRoutes];
    set({ myRoutes: next });
    await persist(next);
    return local;
  },

  syncRoute: async (localId) => {
    const route = get().myRoutes.find((r) => r.local_id === localId);
    if (!route) throw new Error("루트를 찾을 수 없습니다.");
    const code = route.imported_from;
    if (!code) throw new Error("가져온 루트가 아닙니다.");

    const shared = await routesApi.getRouteByCode(code);
    const next = get().myRoutes.map((r) =>
      r.local_id === localId
        ? {
            ...r,
            name: shared.name,
            patch_version: shared.patch_version,
            difficulty_tag: shared.difficulty_tag,
            difficulty_mode: shared.difficulty_mode,
            difficulty_switch_floor: shared.difficulty_switch_floor,
            target_rewards: shared.target_rewards,
            floors: shared.floors,
            memo: shared.memo,
            gift_order: shared.gift_order,
            pack_order: shared.pack_order,
            deck_code: shared.deck_code,
            verified: true,
            verified_method: shared.verified_method,
          }
        : r,
    );
    set({ myRoutes: next });
    await persist(next);
  },

  deleteSharedRoute: async (code) => {
    // 1. 서버에서 루트 삭제
    await routesApi.deleteRoute(code);

    // 2. 허브 로컬 캐시 목록에서 제거
    set({
      hubRoutes: get().hubRoutes.filter((r) => r.route_code !== code),
    });

    // 3. 내 로컬 루트 중 이 코드를 가진 경우 shared_code 지우기
    const next = get().myRoutes.map((r) =>
      r.shared_code === code ? { ...r, shared_code: undefined } : r
    );
    set({ myRoutes: next });
    await persist(next);
  },
}));
