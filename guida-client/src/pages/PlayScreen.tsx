import { useEffect, useMemo, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { ArrowLeft, LogOut, Gift, Boxes, Check, Lock } from "lucide-react";
import type { DifficultyMode, GiftOrderItem, PackOrderItem } from "@/types/route";
import type { DependencyEdge, Gift as GiftEntity, Pack as PackEntity } from "@/types/gameData";
import { useAppStore } from "@/store/appStore";
import { useRouteStore } from "@/store/routeStore";
import { usePlayStore } from "@/store/playStore";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type PlayTab = "gifts" | "packs";

const TABS: { id: PlayTab; label: string; icon: typeof Gift }[] = [
  { id: "gifts", label: "에고기프트", icon: Gift },
  { id: "packs", label: "팩", icon: Boxes },
];

const DIFFICULTY_LABEL: Record<DifficultyMode, string> = {
  normal: "노말",
  hard: "하드",
  extreme: "EXTREME",
};

/**
 * 플레이화면 (README §11.3).
 * 상단 컨트롤바(뒤로가기/루트 선택/탐사 종료) + 탭(에고기프트/선택지/팩).
 * 탭 데이터는 루트의 gift_order / pack_order 를 직접 읽고, gifts/packs 카탈로그로
 * gift_id·pack_id → 이름을 해석한다.
 */
export function PlayScreen() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<PlayTab>("gifts");

  const { gifts, packs, dependencies } = useAppStore();
  const { myRoutes, loadMyRoutes } = useRouteStore();
  const { sessionId, activeRouteId, switchRoute, endSession } = usePlayStore();

  useEffect(() => {
    if (myRoutes.length === 0) void loadMyRoutes();
  }, [myRoutes.length, loadMyRoutes]);

  const giftById = useMemo(() => new Map(gifts.map((g) => [g.id, g])), [gifts]);
  const packById = useMemo(() => new Map(packs.map((p) => [p.id, p])), [packs]);
  // gift_id → 선행조건 의존성 목록 (🔒 잠금 판정용)
  const depsByGift = useMemo(
    () => new Map(dependencies.map((d) => [d.gift_id, d.dependencies])),
    [dependencies],
  );

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
            {tab === "gifts" && (
              <GiftsTab giftOrder={route.gift_order} giftById={giftById} depsByGift={depsByGift} />
            )}
            {tab === "packs" && <PacksTab packOrder={route.pack_order} packById={packById} />}
          </div>
        )}
      </main>
    </div>
  );
}

/* ────────────────────────────── 탭 1: 에고기프트 ────────────────────────────── */

/**
 * 목표 에고기프트 획득 추적 (§11.3 탭1 / §8.6).
 * gift_order 를 priority 순으로 정렬하고, 미충족 선행조건(dependencies "before")이
 * 있으면 🔒 잠금 표시한다. 정렬: 획득가능 미획득 → 잠금 → 획득 완료(어둡게/하단).
 */
function GiftsTab({
  giftOrder,
  giftById,
  depsByGift,
}: {
  giftOrder: GiftOrderItem[];
  giftById: Map<string, GiftEntity>;
  depsByGift: Map<string, DependencyEdge[]>;
}) {
  const { acquiredGifts, toggleGift } = usePlayStore();

  /** 미충족 선행조건: type "before"(이 기프트는 대상보다 나중에 획득) 중 대상 미획득 */
  const unmetBefore = (giftId: string): DependencyEdge[] =>
    (depsByGift.get(giftId) ?? []).filter(
      (e) => e.type === "before" && !acquiredGifts.includes(e.target_gift_id),
    );

  // priority 순 정렬 후 [획득가능 미획득 → 잠금 → 획득완료] 로 재배치
  const ordered = useMemo(() => {
    const byPriority = [...giftOrder].sort((a, b) => a.priority - b.priority);
    const rank = (g: GiftOrderItem) =>
      acquiredGifts.includes(g.gift_id) ? 2 : unmetBefore(g.gift_id).length > 0 ? 1 : 0;
    return [...byPriority].sort((a, b) => rank(a) - rank(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [giftOrder, acquiredGifts, depsByGift]);

  if (giftOrder.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        이 루트에 설정된 목표 에고기프트가 없습니다.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="mb-3 text-xs text-muted-foreground">
        카드를 탭하여 획득 여부를 표시하세요. 🔒는 선행 기프트를 먼저 획득해야 하는 항목입니다.
      </p>
      {ordered.map((item) => {
        const gift = giftById.get(item.gift_id);
        const acquired = acquiredGifts.includes(item.gift_id);
        const blockers = acquired ? [] : unmetBefore(item.gift_id);
        const locked = blockers.length > 0;
        const blockerNames = blockers
          .map((e) => giftById.get(e.target_gift_id)?.name ?? e.target_gift_id)
          .join(", ");
        return (
          <button
            key={item.gift_id}
            onClick={() => toggleGift(item.gift_id)}
            style={
              !acquired && !locked && gift?.keyword_color
                ? { borderColor: `${gift.keyword_color}66` }
                : undefined
            }
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-lg border px-4 py-3 text-left text-sm transition-all",
              acquired
                ? "border-border bg-card/60 opacity-[0.35]"
                : locked
                  ? "border-dashed border-border bg-card/40 text-muted-foreground"
                  : "border-border bg-card hover:border-primary/40",
            )}
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-2 font-medium">
                {locked ? <Lock className="size-3.5 shrink-0" /> : "🎯"} {gift?.name ?? item.gift_id}
                {!item.required && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    옵션
                  </Badge>
                )}
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                {gift?.keyword_type && (
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: `${gift.keyword_color}22`, color: gift.keyword_color }}
                  >
                    {gift.keyword_type}
                  </span>
                )}
                <Badge variant="outline" className="text-[10px]">
                  {item.floor_target}층 목표
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {DIFFICULTY_LABEL[item.difficulty]}
                </Badge>
                {locked && (
                  <span className="text-[10px] text-amber-400">{blockerNames} 먼저 필요</span>
                )}
              </span>
            </span>
            {acquired ? (
              <Badge variant="success" className="shrink-0 gap-1">
                <Check className="size-3" /> 획득
              </Badge>
            ) : locked ? (
              <Badge variant="outline" className="shrink-0 gap-1">
                <Lock className="size-3" /> 잠금
              </Badge>
            ) : (
              <Badge variant="outline" className="shrink-0">
                미획득
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────────── 탭 2: 팩 ────────────────────────────── */

/**
 * 방문할 팩 추적 (§11.3 탭3).
 * pack_order 를 층·우선순위 순으로 나열하고, 난이도가 바뀌는 지점에 전환
 * 구분선을 표시한다. 방문 완료 팩은 어둡게(opacity) 처리한다.
 */
function PacksTab({
  packOrder,
  packById,
}: {
  packOrder: PackOrderItem[];
  packById: Map<string, PackEntity>;
}) {
  const { visitedPacks, togglePack } = usePlayStore();

  // 층 오름차순 → 같은 층은 우선순위 순
  const ordered = useMemo(
    () => [...packOrder].sort((a, b) => a.floor - b.floor || a.priority - b.priority),
    [packOrder],
  );

  // 첫 미방문 팩 = 현재 목표 (Amber 강조)
  const currentKey = ordered.find((p) => !visitedPacks.includes(p.pack_id));

  if (packOrder.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        이 루트에 방문 계획된 팩이 없습니다.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="mb-3 text-xs text-muted-foreground">
        카드를 탭하여 방문 여부를 표시하세요. 난이도가 바뀌는 지점에 구분선이 표시됩니다.
      </p>
      {ordered.map((item, i) => {
        const pack = packById.get(item.pack_id);
        const visited = visitedPacks.includes(item.pack_id);
        const isCurrent = item === currentKey;
        const prev = ordered[i - 1];
        // 직전 팩과 난이도가 다르면 전환 구분선
        const showDivider = prev && prev.difficulty !== item.difficulty;
        const hasExclusive = (pack?.exclusive_gifts?.length ?? 0) > 0;
        return (
          <div key={`${item.pack_id}__${item.floor}`}>
            {showDivider && (
              <div className="my-2 flex items-center gap-2 px-1 text-[11px] text-primary/80">
                <span className="h-px flex-1 bg-primary/40" />
                {item.floor}층부터 {DIFFICULTY_LABEL[item.difficulty]} 전환
                <span className="h-px flex-1 bg-primary/40" />
              </div>
            )}
            <button
              onClick={() => togglePack(item.pack_id)}
              className={cn(
                "flex w-full flex-col gap-1 rounded-lg border px-4 py-3 text-left text-sm transition-all",
                visited
                  ? "border-border bg-card/60 opacity-[0.35]"
                  : isCurrent
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card hover:border-primary/40",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 flex-wrap items-center gap-1.5 font-medium">
                  {!visited && isCurrent ? "🔶" : "📦"} {item.floor}층 · {DIFFICULTY_LABEL[item.difficulty]} ·{" "}
                  {pack?.name ?? item.pack_id}
                  {item.alternative && (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      대체
                    </Badge>
                  )}
                  {hasExclusive && (
                    <Badge variant="warning" className="text-[10px]">
                      전용기프트
                    </Badge>
                  )}
                </span>
                {visited ? (
                  <Badge variant="success" className="shrink-0 gap-1">
                    <Check className="size-3" /> 방문 완료
                  </Badge>
                ) : (
                  <Badge variant="outline" className="shrink-0">
                    미방문
                  </Badge>
                )}
              </span>
              {item.memo && (
                <span className="pl-5 text-[11px] text-muted-foreground">└ {item.memo}</span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
