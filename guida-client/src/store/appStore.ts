/**
 * 앱 전반 상태.
 * 디바이스 UUID, 현재 패치 버전, 게임 데이터, 설정, 초기화 상태를 관리한다.
 */

import { create } from "zustand";
import type { DungeonMeta, GameData, Gift, GiftDependency, Pack, PatchInfo, Sinner } from "@/types/gameData";
import type { UserSettings } from "@/types/settings";
import { DEFAULT_SETTINGS } from "@/types/settings";
import { ensureDeviceUuid, readJson, writeJson } from "@/lib/storage";
import { syncGameData } from "@/api/gameData";
import {
  type AppUpdateInfo,
  checkAppUpdate,
  getCurrentAppVersion,
} from "@/api/appUpdate";
import { isBelowMinVersion } from "@/lib/version";
import { usePlayStore } from "./playStore";
import { logger, IS_LOGGING_ENABLED } from "@/lib/logger";
import { isTauri } from "@/lib/env";

const SETTINGS_FILE = "user_settings.json";

/**
 * 강제 업데이트 게이트 상태.
 * `required` 가 true 면 본화면 진입을 막고 UpdateGate 만 렌더한다.
 */
export interface UpdateGateState {
  /** 강제 업데이트가 필요한가 */
  required: boolean;
  /** 자동 설치 가능한 앱 업데이트 핸들(있으면 버튼으로 즉시 설치) */
  appUpdate: AppUpdateInfo | null;
  /**
   * 자동 설치 핸들은 없지만 강제가 걸린 사유(예: 서버 min_app_version 미달인데
   * 릴리스 매니페스트를 못 받음 → 수동 다운로드 안내). 없으면 null.
   */
  manualReason: string | null;
}

const NO_UPDATE: UpdateGateState = {
  required: false,
  appUpdate: null,
  manualReason: null,
};

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
  /** 시즌 메타 (시작 기프트 / 가호 / EXTREME 제약). 없으면 null */
  dungeonMeta: DungeonMeta | null;
  /** 에고기프트 카탈로그 (루트 작성기 gift_order / starting_gift 선택용) */
  gifts: Gift[];
  /** 팩 카탈로그 (루트 작성기 pack_order 선택용) */
  packs: Pack[];
  /** 기프트 순서 의존성 (플레이화면 🔒 선행조건 판정용) */
  dependencies: GiftDependency[];
  /** 수감자 편성 데이터 */
  prisoners: Sinner[];
  /** 강제 업데이트 게이트 (앱 버전 / 림버스 패치 최신성) */
  update: UpdateGateState;

  /** 앱 초기 부팅: UUID 확보 → 설정 로드 → 게임 데이터 동기화 → 업데이트 확인 */
  bootstrap: () => Promise<void>;
  /** 설정 일부 갱신 후 저장 */
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  bootError: null,
  online: true,
  uuid: "",
  settings: { uuid: "", ...DEFAULT_SETTINGS },
  gameData: null,
  patch: null,
  dungeonMeta: null,
  gifts: [],
  packs: [],
  dependencies: [],
  prisoners: [],
  update: NO_UPDATE,

  bootstrap: async () => {
    try {
      // 0. 로그 기능 활성화 상태라면 날짜 검사 후 로그 초기화
      if (IS_LOGGING_ENABLED) {
        try {
          const todayStr = new Date().toISOString().split("T")[0];
          const lastLogDate = await readJson<string>("last_log_date.json", "");
          if (lastLogDate !== todayStr) {
            if (isTauri()) {
              const { invoke } = await import("@tauri-apps/api/core");
              await invoke("write_data_file", { name: "requests.log", content: "" });
              await invoke("write_data_file", { name: "requests.log.old", content: "" });
            } else {
              localStorage.removeItem("guida:logs");
            }
            await writeJson("last_log_date.json", todayStr);
          }
        } catch (e) {
          console.error("Failed to clean up yesterday's logs on boot:", e);
        }
      }

      await logger.info("System", "Starting application boot sequence...");

      // 1. 디바이스 UUID 확보 (없으면 생성)
      const uuid = await ensureDeviceUuid();
      await logger.info("System", `Device UUID verified: ${uuid}`);

      // 2. 설정 로드 (없으면 기본값)
      const stored = await readJson<Partial<UserSettings>>(SETTINGS_FILE, {});
      const settings: UserSettings = {
        ...DEFAULT_SETTINGS,
        ...stored,
        uuid,
      };
      await logger.info("System", "Settings loaded successfully");

      // 3. 게임 데이터 + 패치 동기화 (오프라인 시 캐시 폴백)
      let online = true;
      let gameData: GameData | null = null;
      let patch: PatchInfo | null = null;
      let dungeonMeta: DungeonMeta | null = null;
      let gifts: Gift[] = [];
      let packs: Pack[] = [];
      let dependencies: GiftDependency[] = [];
      let prisoners: Sinner[] = [];
      try {
        const result = await syncGameData();
        gameData = result.gameData;
        patch = result.patch;
        dungeonMeta = result.dungeonMeta;
        gifts = result.gifts;
        packs = result.packs;
        dependencies = result.dependencies;
        prisoners = result.prisoners;
        online = result.fromNetwork;
        settings.current_patch = patch.current_patch;
        await logger.info("System", `Game data synced. Network: ${online}, Patch version: ${patch.current_patch}`);
      } catch (e) {
        // 게임 데이터를 전혀 못 받은 경우에도 앱은 떠야 한다.
        await logger.error("System", "Game data loading failed during boot", e);
        online = false;
      }

      // 4. 앱 버전 확정 + 강제 업데이트 게이트 판정
      //    - 림버스 패치: 위 syncGameData 가 online 일 때 항상 최신으로 재동기화
      //      하므로 별도 강제 동작 불필요(오프라인이면 캐시로 동작).
      //    - 가이다 앱: GitHub Releases 매니페스트(Tauri updater)로 판정하고,
      //      서버 min_app_version 을 비상 차단선으로 함께 본다.
      const appVersion = await getCurrentAppVersion(DEFAULT_SETTINGS.app_version);
      settings.app_version = appVersion;

      let update: UpdateGateState = NO_UPDATE;
      if (!online) {
        // 서버 연결 불가 → 업데이트 확인/강제 게이트를 생략하고 현재(캐시) 버전으로
        // 그대로 부팅한다. 반쪽짜리 연결 상태에서 강제 설치를 시작하면 설치를
        // 끝내지 못한 채 앱이 닫혀(NSIS 설치 종료) 그대로 사라지는 문제를 막는다.
        // 사용자에게는 ServerUnavailableNotice 팝업으로 안내한다.
        await logger.warn("System", "Server unreachable — skipping update check; booting current version");
      } else {
        const appUpdate = await checkAppUpdate();
        if (appUpdate) {
          // (a) 설치 가능한 새 버전이 있으면 강제 업데이트(정책상 모든 업데이트 강제)
          update = { required: true, appUpdate, manualReason: null };
          await logger.warn("System", `Force update required: v${appVersion} -> v${appUpdate.version}`);
        } else if (isBelowMinVersion(appVersion, patch?.min_app_version)) {
          // (b) 서버가 요구하는 최소 버전 미달인데 자동 설치 핸들이 없음
          //     (릴리스 미게시) → 수동 다운로드 안내로 강제 차단
          update = {
            required: true,
            appUpdate: null,
            manualReason: `현재 버전 v${appVersion} 은(는) 더 이상 지원되지 않습니다. 최신 버전(v${patch?.min_app_version} 이상)으로 업데이트해 주세요.`,
          };
          await logger.error("System", `Force update required (manual instructions): v${appVersion} < min v${patch?.min_app_version}`);
        } else {
          await logger.info("System", `App version v${appVersion} meets current minimum requirements`);
        }
      }

      // 5. 설정 영구 저장 (current_patch / app_version 갱신 반영)
      await writeJson(SETTINGS_FILE, settings);

      // 6. 플레이 세션 복원
      const session = await readJson<any>("play_session.json", null);
      if (session) {
        usePlayStore.getState().restoreSession(session);
        await logger.info("System", "Play session restored successfully");
      }

      await logger.info("System", "Boot sequence completed successfully. Ready to run.");

      set({
        uuid,
        settings,
        gameData,
        patch,
        dungeonMeta,
        gifts,
        packs,
        dependencies,
        prisoners,
        online,
        update,
        ready: true,
        bootError: null,
      });
    } catch (e) {
      await logger.error("System", "Boot sequence crashed with critical error", e);
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
}));

/** 현재 패치 버전 문자열 (없으면 설정의 마지막 값) */
export function currentPatch(): string {
  const { patch, settings } = useAppStore.getState();
  return patch?.current_patch ?? settings.current_patch;
}
