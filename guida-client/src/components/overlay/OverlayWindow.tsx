import { useEffect, useState } from "react";
import { MousePointerClick, MousePointer2, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useGuideStore, filterEvents, bestChoiceId, isRecommended } from "@/store/guideStore";
import { useOverlayControl } from "@/hooks/useTauriCommand";
import { GuideHighlight } from "./GuideHighlight";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

/**
 * 오버레이 창 본체 (#/overlay 라우트).
 * 게임 위에 떠서 현재 층/목표에 맞는 최적 선택지를 하이라이트한다.
 * 클릭 관통(Click-through) 토글을 제공한다.
 */
export function OverlayWindow() {
  const { ready, gameData, settings, bootstrap } = useAppStore();
  const { targetReward, currentFloor, setTargetReward, setCurrentFloor } = useGuideStore();
  const { setClickThrough, hideOverlay, isDesktop } = useOverlayControl();
  const [clickThrough, setCT] = useState(false);

  // 오버레이 창은 독립 컨텍스트일 수 있으므로 자체 부트스트랩
  useEffect(() => {
    document.body.classList.add("overlay-mode");
    if (!ready) void bootstrap();

    // 마운트 시 상태 동기화 알림
    if (isDesktop) {
      const initOverlayStatus = async () => {
        const { emit } = await import("@tauri-apps/api/event");
        await emit("overlay-status-changed", { visible: true });
        await emit("overlay-click-through-state", { clickThrough: false });
      };
      void initOverlayStatus();
    }

    return () => {
      document.body.classList.remove("overlay-mode");
      // 언마운트 시 상태 동기화 알림
      if (isDesktop) {
        const clearOverlayStatus = async () => {
          const { emit } = await import("@tauri-apps/api/event");
          await emit("overlay-status-changed", { visible: false });
        };
        void clearOverlayStatus();
      }
    };
  }, [ready, bootstrap, isDesktop]);

  // 단축키(F9) 및 메인 창의 고정 해제 명령 수신 대기
  useEffect(() => {
    if (!isDesktop) return;

    let unlistenToggle: (() => void) | null = null;
    let unlistenSet: (() => void) | null = null;

    const setupListeners = async () => {
      const { listen } = await import("@tauri-apps/api/event");

      unlistenToggle = await listen("toggle-overlay-click-through", () => {
        setCT((prev) => {
          const next = !prev;
          void setClickThrough(next);
          return next;
        });
      });

      unlistenSet = await listen<boolean>("set-overlay-click-through", (e) => {
        const next = e.payload;
        setCT(next);
        void setClickThrough(next);
      });
    };

    void setupListeners();

    return () => {
      if (unlistenToggle) unlistenToggle();
      if (unlistenSet) unlistenSet();
    };
  }, [isDesktop, setClickThrough]);

  const toggleClickThrough = async () => {
    const next = !clickThrough;
    setCT(next);
    await setClickThrough(next);
  };

  const floor = currentFloor ?? 1;
  const events = filterEvents(gameData, floor, targetReward);

  return (
    <div
      className="flex h-screen flex-col gap-2 rounded-xl border border-primary/30 bg-background/90 p-3 text-foreground backdrop-blur-md"
      style={{ opacity: settings.overlay_opacity }}
    >
      {/* 헤더 (드래그 핸들 + 컨트롤) */}
      <div data-tauri-drag-region className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-primary">Guida</span>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant={clickThrough ? "default" : "ghost"}
            onClick={toggleClickThrough}
            title={clickThrough ? "클릭 관통 ON (게임으로 입력 통과)" : "클릭 관통 OFF"}
            className="size-7"
          >
            {clickThrough ? <MousePointerClick className="size-4" /> : <MousePointer2 className="size-4" />}
          </Button>
          {isDesktop && (
            <Button size="icon" variant="ghost" onClick={hideOverlay} title="오버레이 닫기" className="size-7">
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* 컨트롤: 층 이동 + 목표 */}
      <div className="flex items-center gap-1.5">
        <Button
          size="icon"
          variant="outline"
          className="size-7"
          onClick={() => setCurrentFloor(Math.max(1, floor - 1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="w-12 text-center text-xs font-semibold">{floor}층</span>
        <Button
          size="icon"
          variant="outline"
          className="size-7"
          onClick={() => setCurrentFloor(Math.min(7, floor + 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
        <Select
          value={targetReward}
          onChange={(e) => setTargetReward(e.target.value)}
          className="h-7 flex-1 text-xs"
        >
          <option value="">목표 없음</option>
          {gameData?.targetRewards.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
      </div>

      {/* 가이드 본문 */}
      <div className="flex-1 space-y-2 overflow-y-auto pr-1">
        {!ready && <p className="text-xs text-muted-foreground">데이터 로딩 중…</p>}
        {ready && events.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {floor}층에 표시할 이벤트가 없습니다.
            {targetReward && " 목표를 바꾸거나 다른 층을 확인하세요."}
          </p>
        )}
        {events.map((event) => {
          const best = bestChoiceId(event, targetReward);
          return (
            <div key={event.id} className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">{event.name}</p>
              {event.choices.map((c) => (
                <GuideHighlight
                  key={c.id}
                  choice={c}
                  recommended={isRecommended(c, targetReward)}
                  best={c.id === best}
                  target={targetReward}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
