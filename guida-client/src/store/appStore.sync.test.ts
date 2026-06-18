/**
 * 런타임 동기화 = 디스크 전용 갱신, 메모리 핫스왑 없음 회귀 테스트
 * (phase2 dev plan §6 행5 / §7 S2).
 *
 * 설정 "게임 데이터 동기화" 트리거(requestGameDataSync)가 디스크 동기화는
 * 수행하되, 현재 실행의 메모리 게임 데이터는 교체하지 않음을 보장한다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/gameData", () => ({ syncGameData: vi.fn() }));
// 부팅 전용 의존성 — 모듈 import 가 깨지지 않도록 가볍게 목킹.
vi.mock("@/api/appUpdate", () => ({
  checkAppUpdate: vi.fn(),
  getCurrentAppVersion: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  ensureDeviceUuid: vi.fn(),
  readJson: vi.fn(),
  writeJson: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  IS_LOGGING_ENABLED: false,
}));
vi.mock("@/lib/env", () => ({ isTauri: () => false }));

import { useAppStore } from "@/store/appStore";
import { syncGameData } from "@/api/gameData";

const NEW_RESULT = {
  gameData: { patch_version: "2.0", targetRewards: [], events: [] },
  patch: { current_patch: "2.0", updated_at: "x" },
  dungeonMeta: null,
  gifts: [{ id: "gift_NEW" }],
  packs: [{ id: "pack_NEW" }],
  dependencies: [],
  prisoners: [],
  fromNetwork: true,
};

beforeEach(() => {
  vi.mocked(syncGameData).mockReset();
  // 부팅으로 메모리에 로드되어 있던 상태를 흉내낸다.
  useAppStore.setState({
    gifts: [{ id: "gift_old" }] as never,
    packs: [{ id: "pack_old" }] as never,
    gameData: { patch_version: "1.0", targetRewards: [], events: [] } as never,
    patch: { current_patch: "1.0", updated_at: "x" } as never,
    syncing: false,
    lastSyncAt: null,
  });
});

describe("requestGameDataSync — 런타임 핫스왑 없음", () => {
  it("디스크 동기화는 수행하되 메모리 게임 데이터는 교체하지 않는다", async () => {
    vi.mocked(syncGameData).mockResolvedValue(NEW_RESULT as never);

    const result = await useAppStore.getState().requestGameDataSync();

    expect(result.status).toBe("synced");
    // 디스크 동기화(syncGameData)는 호출됨
    expect(syncGameData).toHaveBeenCalledTimes(1);
    // 그러나 메모리 데이터는 '옛' 값 그대로 — 핫스왑 없음
    const s = useAppStore.getState();
    expect(s.gifts).toEqual([{ id: "gift_old" }]);
    expect(s.packs).toEqual([{ id: "pack_old" }]);
    expect((s.patch as { current_patch: string }).current_patch).toBe("1.0");
    expect((s.gameData as { patch_version: string }).patch_version).toBe("1.0");
    // 동기화 성공 시각만 갱신
    expect(s.lastSyncAt).not.toBeNull();
    expect(s.syncing).toBe(false);
  });

  it("오프라인(fromNetwork=false) → status offline, 메모리 불변", async () => {
    vi.mocked(syncGameData).mockResolvedValue({ ...NEW_RESULT, fromNetwork: false } as never);

    const result = await useAppStore.getState().requestGameDataSync();

    expect(result.status).toBe("offline");
    expect(useAppStore.getState().gifts).toEqual([{ id: "gift_old" }]);
  });

  it("동기화 throw → status error, 메모리 불변, syncing 해제", async () => {
    vi.mocked(syncGameData).mockRejectedValue(new Error("boom"));

    const result = await useAppStore.getState().requestGameDataSync();

    expect(result.status).toBe("error");
    expect(useAppStore.getState().gifts).toEqual([{ id: "gift_old" }]);
    expect(useAppStore.getState().syncing).toBe(false);
  });
});
