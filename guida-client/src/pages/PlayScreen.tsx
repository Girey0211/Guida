import { useEffect, useMemo, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { ArrowLeft, LogOut, Gift, Compass, Boxes, Check } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useRouteStore } from "@/store/routeStore";
import { usePlayStore } from "@/store/playStore";
import { filterEvents, bestChoiceId, isRecommended } from "@/store/guideStore";
import { GuideHighlight } from "@/components/overlay/GuideHighlight";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type PlayTab = "gifts" | "choices" | "packs";

const TABS: { id: PlayTab; label: string; icon: typeof Gift }[] = [
  { id: "gifts", label: "에고기프트", icon: Gift },
  { id: "choices", label: "선택지", icon: Compass },
  { id: "packs", label: "팩", icon: Boxes },
];

const FLOORS = [1, 2, 3, 4, 5, 6, 7];

/**
 * 플레이화면 (README §11.3).
 * 상단 컨트롤바(뒤로가기/루트 선택/탐사 종료) + 탭(에고기프트/선택지/팩).
 */
export function PlayScreen() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<PlayTab>("gifts");

  const { myRoutes, loadMyRoutes } = useRouteStore();
  const { sessionId, activeRouteId, switchRoute, endSession } = usePlayStore();

  useEffect(() => {
    if (myRoutes.length === 0) void loadMyRoutes();
  }, [myRoutes.length, loadMyRoutes]);

  const route = myRoutes.find((r) => r.local_id === activeRouteId) ?? null;

  // 세션이 없으면 기본화면으로 복귀
  if (!sessionId) return <Navigate to="/" replace />;

  const handleEnd = () => {
    if (!confirm("거던 탐사를 종료할까요? 진행 데이터는 초기화됩니다.")) return;
    endSession();
    navigate("/");
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* 상단 컨트롤바 (Charcoal Black) */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-brand px-3 py-2">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => navigate("/")}
          title="기본화면으로 (탐사 세션 유지)"
          className="size-8"
        >
          <ArrowLeft className="size-4" />
        </Button>

        <Select
          value={activeRouteId ?? ""}
          onChange={(e) => switchRoute(e.target.value)}
          className="h-8 max-w-[60%] flex-1 text-sm"
          title="루트 변경 (변경 즉시 가이드 갱신)"
        >
          {myRoutes.map((r) => (
            <option key={r.local_id} value={r.local_id}>
              {r.name}
            </option>
          ))}
        </Select>

        <Button size="sm" variant="default" onClick={handleEnd} className="ml-auto">
          <LogOut className="size-4" />
          탐사 종료
        </Button>
      </header>

      {/* 탭 네비게이션 */}
      <nav className="flex shrink-0 gap-1 border-b border-border bg-brand/60 px-3">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              tab === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>

      {/* 탭 콘텐츠 */}
      <main className="flex-1 overflow-y-auto">
        {!route ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            활성 루트를 찾을 수 없습니다. 탐사를 종료해 주세요.
          </p>
        ) : (
          <div className="mx-auto max-w-3xl p-5">
            {tab === "gifts" && <GiftsTab targets={route.target_rewards} />}
            {tab === "choices" && <ChoicesTab targets={route.target_rewards} />}
            {tab === "packs" && <PacksTab floors={route.floors} />}
          </div>
        )}
      </main>
    </div>
  );
}

/* ────────────────────────────── 탭 1: 에고기프트 ────────────────────────────── */

/**
 * 목표 에고기프트(재화) 획득 추적 (§11.3 탭1).
 * 미획득은 밝게/상단, 획득 완료는 어둡게(opacity)/하단으로 정렬.
 */
function GiftsTab({ targets }: { targets: string[] }) {
  const { acquiredGifts, toggleGift } = usePlayStore();

  // 미획득 → 획득 순으로 정렬
  const ordered = useMemo(() => {
    const pending = targets.filter((t) => !acquiredGifts.includes(t));
    const done = targets.filter((t) => acquiredGifts.includes(t));
    return [...pending, ...done];
  }, [targets, acquiredGifts]);

  if (targets.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        이 루트에 설정된 목표 에고기프트가 없습니다.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="mb-3 text-xs text-muted-foreground">
        카드를 탭하여 획득 여부를 표시하세요. 획득한 항목은 자동으로 하단에 정리됩니다.
      </p>
      {ordered.map((gift) => {
        const acquired = acquiredGifts.includes(gift);
        return (
          <button
            key={gift}
            onClick={() => toggleGift(gift)}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-lg border px-4 py-3 text-left text-sm transition-all",
              acquired
                ? "border-border bg-card/60 opacity-[0.35]"
                : "border-border bg-card hover:border-primary/40",
            )}
          >
            <span className="flex items-center gap-2 font-medium">🎯 {gift}</span>
            {acquired ? (
              <Badge variant="success" className="gap-1">
                <Check className="size-3" /> 획득
              </Badge>
            ) : (
              <Badge variant="outline">미획득</Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────────── 탭 2: 선택지 ────────────────────────────── */

/**
 * 현재 층 선택지 가이드 (§11.3 탭2).
 * 루트 목표 재화 기준 최적 선택지를 Amber로 하이라이트.
 */
function ChoicesTab({ targets }: { targets: string[] }) {
  const { gameData } = useAppStore();
  const { currentFloor, setFloor } = usePlayStore();
  const [target, setTarget] = useState(targets[0] ?? "");

  const events = filterEvents(gameData, currentFloor, target);

  return (
    <div className="space-y-4">
      {/* 층 선택 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted-foreground">현재 층</span>
        {FLOORS.map((f) => (
          <button
            key={f}
            onClick={() => setFloor(f)}
            className={cn(
              "size-8 rounded-md border text-sm transition-colors",
              currentFloor === f
                ? "border-primary bg-primary/20 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* 목표 재화 선택 */}
      <Select value={target} onChange={(e) => setTarget(e.target.value)} className="text-sm">
        <option value="">전체 보기 (목표 없음)</option>
        {targets.map((t) => (
          <option key={t} value={t}>
            🎯 {t}
          </option>
        ))}
      </Select>

      {/* 이벤트 목록 */}
      {events.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {currentFloor}층에 표시할 이벤트가 없습니다.
        </p>
      ) : (
        <div className="space-y-4">
          {events.map((event) => {
            const best = bestChoiceId(event, target);
            return (
              <div key={event.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{event.name}</p>
                  <div className="flex gap-1">
                    {event.floors.map((f) => (
                      <Badge key={f} variant="outline" className="text-[10px]">
                        {f}층
                      </Badge>
                    ))}
                  </div>
                </div>
                {event.choices.map((c) => (
                  <GuideHighlight
                    key={c.id}
                    choice={c}
                    recommended={isRecommended(c, target)}
                    best={c.id === best}
                    target={target}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────── 탭 3: 팩 ────────────────────────────── */

/**
 * 방문해야 할 팩(층) 추적 (§11.3 탭3).
 * 미방문은 밝게/상단, 방문 완료는 어둡게/하단으로 정렬 (에고기프트 탭과 동일 UX).
 */
function PacksTab({ floors }: { floors: number[] }) {
  const { visitedPacks, togglePack } = usePlayStore();

  const ordered = useMemo(() => {
    const sorted = [...floors].sort((a, b) => a - b);
    const pending = sorted.filter((f) => !visitedPacks.includes(f));
    const done = sorted.filter((f) => visitedPacks.includes(f));
    return [...pending, ...done];
  }, [floors, visitedPacks]);

  if (floors.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        이 루트에 방문 계획된 팩(층)이 없습니다.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="mb-3 text-xs text-muted-foreground">
        카드를 탭하여 방문 여부를 표시하세요. 방문한 팩은 자동으로 하단에 정리됩니다.
      </p>
      {ordered.map((floor) => {
        const visited = visitedPacks.includes(floor);
        return (
          <button
            key={floor}
            onClick={() => togglePack(floor)}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-lg border px-4 py-3 text-left text-sm transition-all",
              visited
                ? "border-border bg-card/60 opacity-[0.35]"
                : "border-border bg-card hover:border-primary/40",
            )}
          >
            <span className="font-medium">📦 {floor}층 팩</span>
            {visited ? (
              <Badge variant="success" className="gap-1">
                <Check className="size-3" /> 방문 완료
              </Badge>
            ) : (
              <Badge variant="outline">미방문</Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}
