import { MonitorPlay } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useGuideStore, filterEvents, bestChoiceId, isRecommended } from "@/store/guideStore";
import { useOverlayControl } from "@/hooks/useTauriCommand";
import { GuideHighlight } from "@/components/overlay/GuideHighlight";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** 거던 선택지 가이드 페이지 (메인 창 버전) */
export function Guide() {
  const { gameData } = useAppStore();
  const { targetReward, currentFloor, setTargetReward, setCurrentFloor } = useGuideStore();
  const { showOverlay } = useOverlayControl();

  const events = filterEvents(gameData, currentFloor, targetReward);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <PageHeader
        title="거던 선택지 가이드"
        description="파밍 목표를 정하면 이벤트별 최적 선택지를 하이라이트합니다."
        action={
          <Button onClick={() => void showOverlay()}>
            <MonitorPlay className="size-4" />
            오버레이로 보기
          </Button>
        }
      />

      {/* 컨트롤 */}
      <Card className="mb-5">
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>파밍 목표 재화</Label>
            <Select value={targetReward} onChange={(e) => setTargetReward(e.target.value)}>
              <option value="">전체 보기 (목표 없음)</option>
              {gameData?.targetRewards.map((r) => (
                <option key={r} value={r}>
                  🎯 {r}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>거던 층 필터</Label>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setCurrentFloor(null)}
                className={cn(
                  "h-9 rounded-md border px-3 text-sm transition-colors",
                  currentFloor == null
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40",
                )}
              >
                전체
              </button>
              {[1, 2, 3, 4, 5, 6, 7].map((f) => (
                <button
                  key={f}
                  onClick={() => setCurrentFloor(f)}
                  className={cn(
                    "h-9 w-9 rounded-md border text-sm transition-colors",
                    currentFloor === f
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 이벤트 목록 */}
      {events.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          조건에 맞는 이벤트가 없습니다. 목표나 층 필터를 조정해 보세요.
        </p>
      ) : (
        <div className="space-y-4">
          {events.map((event) => {
            const best = bestChoiceId(event, targetReward);
            return (
              <Card key={event.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">{event.name}</CardTitle>
                    <div className="flex gap-1">
                      {event.floors.map((f) => (
                        <Badge key={f} variant="outline" className="text-[10px]">
                          {f}층
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {event.description && (
                    <p className="text-xs text-muted-foreground">{event.description}</p>
                  )}
                </CardHeader>
                <CardContent className="space-y-2">
                  {event.choices.map((c) => (
                    <GuideHighlight
                      key={c.id}
                      choice={c}
                      recommended={isRecommended(c, targetReward)}
                      best={c.id === best}
                      target={targetReward}
                    />
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
