/**
 * 앱 전반 상태.
 * 디바이스 UUID, 현재 패치 버전, 게임 데이터, 설정, 초기화 상태를 관리한다.
 */

import { create } from "zustand";
import type { GameData, PatchInfo } from "@/types/gameData";
import type { Theme, UserSettings } from "@/types/settings";
import { DEFAULT_SETTINGS } from "@/types/settings";
import { ensureDeviceUuid, readJson, writeJson } from "@/lib/storage";
import { syncGameData } from "@/api/gameData";

const SETTINGS_FILE = "user_settings.json";

interface AppState {
  /** 부트스트랩 완료 여부 */
  ready: boolean;
  /** 로딩/에러 메시지 */
  bootError: string | null;
  /** 게임 데이터가 네트워크에서 왔는지(false면 오프라인 캐시) */
  online: boolean;

  uuid: string;
  settings: UserSettings;
  gameData: GameData | null;
  patch: PatchInfo | null;

  /** 앱 초기 부팅: UUID 확보 → 설정 로드 → 게임 데이터 동기화 */
  bootstrap: () => Promise<void>;
  /** 설정 일부 갱신 후 저장 */
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  bootError: null,
  online: true,
  uuid: "",
  settings: { uuid: "", ...DEFAULT_SETTINGS },
  gameData: null,
  patch: null,

  bootstrap: async () => {
    try {
      // 1. 디바이스 UUID 확보 (없으면 생성)
      const uuid = await ensureDeviceUuid();

      // 2. 설정 로드 (없으면 기본값)
      const stored = await readJson<Partial<UserSettings>>(SETTINGS_FILE, {});
      const settings: UserSettings = {
        ...DEFAULT_SETTINGS,
        ...stored,
        uuid,
      };

      // 3. 게임 데이터 + 패치 동기화 (오프라인 시 캐시 폴백)
      let online = true;
      let gameData: GameData | null = null;
      let patch: PatchInfo | null = null;
      try {
        const result = await syncGameData();
        gameData = result.gameData;
        patch = result.patch;
        online = result.fromNetwork;
        settings.current_patch = patch.current_patch;
      } catch (e) {
        // 게임 데이터를 전혀 못 받은 경우에도 앱은 떠야 한다.
        console.error("[bootstrap] 게임 데이터 로드 실패", e);
        online = false;
      }

      // 4. 설정 영구 저장 (current_patch 갱신 반영)
      await writeJson(SETTINGS_FILE, settings);

      set({ uuid, settings, gameData, patch, online, ready: true, bootError: null });
    } catch (e) {
      set({
        ready: true,
        bootError: e instanceof Error ? e.message : "초기화 중 알 수 없는 오류",
      });
    }
  },

  updateSettings: async (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    await writeJson(SETTINGS_FILE, next);
  },

  setTheme: async (theme) => {
    await get().updateSettings({ theme });
    document.documentElement.classList.toggle("dark", theme === "dark");
  },
}));

/** 현재 패치 버전 문자열 (없으면 설정의 마지막 값) */
export function currentPatch(): string {
  const { patch, settings } = useAppStore.getState();
  return patch?.current_patch ?? settings.current_patch;
}
