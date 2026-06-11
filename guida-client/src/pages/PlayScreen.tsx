import { useEffect, useMemo, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { ArrowLeft, LogOut, Gift, Boxes, Check, Lock } from "lucide-react";
import type { DifficultyMode, GiftOrderItem, PackOrderItem, RouteDependency } from "@/types/route";
import type { DependencyEdge, Gift as GiftEntity, Pack as PackEntity } from "@/types/gameData";
import { useAppStore } from "@/store/appStore";
import { useRouteStore } from "@/store/routeStore";
import { usePlayStore } from "@/store/playStore";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { cn, getGiftColor } from "@/lib/utils";

type PlayTab = "packs" | "gifts";

const TABS: { id: PlayTab; label: string; icon: typeof Gift }[] = [
  { id: "packs", label: "팩", icon: Boxes },
  { id: "gifts", label: "에고기프트", icon: Gift },
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
  const [tab, setTab] = useState<PlayTab>("packs");

  const { gifts, packs, dependencies } = useAppStore();
  const { myRoutes, loadMyRoutes, verifyRoute } = useRouteStore();
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

  const handleComplete = async () => {
    if (!confirm("거던 탐사를 완료하셨습니까? 이 루트를 검증(실제 플레이 완료) 상태로 표시합니다.")) return;
    if (activeRouteId) {
      await verifyRoute(activeRouteId);
      toast.success("탐사가 완료되어 루트가 검증되었습니다!");
    }
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

        <Button size="sm" variant="default" onClick={handleComplete} className="ml-auto">
          <Check className="size-4" />
          탐사 완료
        </Button>

        <Button size="sm" variant="outline" onClick={handleEnd}>
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
              <GiftsTab
                gifts={gifts}
                giftOrder={route.gift_order}
                giftById={giftById}
                depsByGift={depsByGift}
                giftDependencies={route.gift_dependencies ?? []}
                routeTargetDepth={route.floors[0] ?? 5}
                routeMode={route.difficulty_mode}
                routeSwitchFloor={route.difficulty_switch_floor}
              />
            )}
            {tab === "packs" && (
              <PacksTab
                packOrder={route.pack_order}
                packById={packById}
                giftOrder={route.gift_order}
                giftById={giftById}
              />
            )}
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
function distinct<T extends string>(values: (T | null | undefined)[]): T[] {
  return [...new Set(values.filter((v): v is T => Boolean(v)))];
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
        active
          ? "border-primary bg-primary/20 text-primary"
          : "border-border text-muted-foreground hover:border-primary/40",
      )}
    >
      {children}
    </button>
  );
}

function GiftsTab({
  gifts,
  giftOrder,
  giftById,
  depsByGift,
  giftDependencies,
  routeTargetDepth,
  routeMode,
  routeSwitchFloor,
}: {
  gifts: GiftEntity[];
  giftOrder: GiftOrderItem[];
  giftById: Map<string, GiftEntity>;
  depsByGift: Map<string, DependencyEdge[]>;
  giftDependencies: RouteDependency[];
  routeTargetDepth: number;
  routeMode: DifficultyMode;
  routeSwitchFloor: number | null;
}) {
  const { acquiredGifts, toggleGift } = usePlayStore();

  const [q, setQ] = useState("");
  const [keyword, setKeyword] = useState("");
  const [grade, setGrade] = useState("");
  const [source, setSource] = useState("");
  const [hardOnly, setHardOnly] = useState(false);
  const [craftableOnly, setCraftableOnly] = useState(false);
  const [hideAcquired, setHideAcquired] = useState(false);

  // distinct values for filters
  const keywords = useMemo(() => distinct(gifts.map((g) => g.keyword_type)), [gifts]);
  const grades = useMemo(
    () => distinct(gifts.map((g) => g.grade)).sort((a, b) => a.localeCompare(b)),
    [gifts],
  );
  const sources = useMemo(() => distinct(gifts.map((g) => g.source_category)), [gifts]);

  const resetFilters = () => {
    setQ("");
    setKeyword("");
    setGrade("");
    setSource("");
    setHardOnly(false);
    setCraftableOnly(false);
    setHideAcquired(false);
  };

  /** 미충족 선행조건: type "before"(이 기프트는 대상보다 나중에 획득) 중 대상 미획득 및 사용자 지정 우선순위 */
  const unmetBefore = (giftId: string): DependencyEdge[] => {
    const targetGiftIds = new Set(giftOrder.map((g) => g.gift_id));

    const globalDeps = (depsByGift.get(giftId) ?? []).filter(
      (e) => e.type === "before" && targetGiftIds.has(e.target.gift_id) && !acquiredGifts.includes(e.target.gift_id),
    );

    const customDeps: DependencyEdge[] = giftDependencies
      .filter((d) => d.second_gift_id === giftId && targetGiftIds.has(d.first_gift_id) && !acquiredGifts.includes(d.first_gift_id))
      .map((d) => ({
        target: {
          gift_id: d.first_gift_id,
          name: giftById.get(d.first_gift_id)?.name ?? d.first_gift_id,
        },
        type: "before",
        required: true,
        reason: "사용자 설정 우선순위 제약",
      }));

    return [...globalDeps, ...customDeps];
  };

  const filtered = useMemo(() => {
    const k = q.trim();
    return giftOrder.filter((item) => {
      const g = giftById.get(item.gift_id);
      if (!g) return true;
      if (k && !g.name.includes(k)) return false;
      if (keyword && g.keyword_type !== keyword) return false;
      if (grade && g.grade !== grade) return false;
      if (source && g.source_category !== source) return false;
      if (hardOnly && !g.hard_mode_only) return false;
      if (craftableOnly && !g.is_craftable) return false;
      if (hideAcquired && acquiredGifts.includes(item.gift_id)) return false;
      return true;
    });
  }, [giftOrder, q, keyword, grade, source, hardOnly, craftableOnly, hideAcquired, acquiredGifts, giftById]);

  // priority 순 정렬 후 [획득가능 미획득 → 잠금 → 획득완료] 로 재배치
  const ordered = useMemo(() => {
    const byPriority = [...filtered].sort((a, b) => a.priority - b.priority);
    const rank = (g: GiftOrderItem) =>
      acquiredGifts.includes(g.gift_id) ? 2 : unmetBefore(g.gift_id).length > 0 ? 1 : 0;
    return [...byPriority].sort((a, b) => rank(a) - rank(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, acquiredGifts, depsByGift, giftDependencies, giftById]);

  // 실제 target depth와 difficulty 계산
  const targetDepth = routeTargetDepth;
  const actualDiff = (() => {
    if (targetDepth >= 11) return "extreme";
    if (routeSwitchFloor != null) return targetDepth >= routeSwitchFloor ? "hard" : "normal";
    if (routeMode === "hard" || routeMode === "extreme") return "hard";
    return "normal";
  })();

  if (giftOrder.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        이 루트에 설정된 목표 에고기프트가 없습니다.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* 필터 영역 */}
      <div className="space-y-2 rounded-lg border border-border bg-card p-3 shadow-sm">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="목표 기프트 이름 검색"
          className="h-8"
        />
        <div className="grid grid-cols-2 gap-2">
          <Select value={keyword} onChange={(e) => setKeyword(e.target.value)} className="h-8 text-xs">
            <option value="">키워드 전체</option>
            {keywords.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
          <Select value={grade} onChange={(e) => setGrade(e.target.value)} className="h-8 text-xs">
            <option value="">등급 전체</option>
            {grades.map((g) => (
              <option key={g} value={g}>
                {g}등급
              </option>
            ))}
          </Select>
        </div>
        <Select value={source} onChange={(e) => setSource(e.target.value)} className="h-8 text-xs">
          <option value="">출처 전체</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <FilterChip active={hardOnly} onClick={() => setHardOnly((v) => !v)}>
            하드 전용
          </FilterChip>
          <FilterChip active={craftableOnly} onClick={() => setCraftableOnly((v) => !v)}>
            합성 가능
          </FilterChip>
          <FilterChip active={hideAcquired} onClick={() => setHideAcquired((v) => !v)}>
            미획득만 보기
          </FilterChip>
          <button
            type="button"
            onClick={resetFilters}
            className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
          >
            필터 초기화
          </button>
        </div>
      </div>



      {ordered.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          조건에 맞는 목표 에고기프트가 없습니다.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {ordered.map((item) => {
            const gift = giftById.get(item.gift_id);
            const acquired = acquiredGifts.includes(item.gift_id);
            const blockers = acquired ? [] : unmetBefore(item.gift_id);
            const locked = blockers.length > 0;
            const blockerNames = blockers
              .map((e) => giftById.get(e.target.gift_id)?.name ?? e.target.gift_id)
              .join(", ");
            const attributeColor = getGiftColor(gift?.keyword_type);
            return (
              <button
                key={item.gift_id}
                onClick={() => toggleGift(item.gift_id)}
                title={gift?.effect}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-lg border transition-all text-left bg-card",
                  acquired
                    ? "border-border opacity-[0.4]"
                    : locked
                      ? "border-dashed border-border text-muted-foreground bg-card/40"
                      : "border-border hover:border-primary/40 hover:scale-[1.02]",
                )}
              >
                {/* Colored Box Placeholder as Image */}
                <div 
                  className="h-20 w-full relative flex items-center justify-center text-xs font-bold text-white/90 shadow-inner"
                  style={{ backgroundColor: attributeColor }}
                >
                  <span>{gift?.keyword_type || "일반"}</span>
                  
                  {/* Status Overlay Badge on the top-right corner of the image */}
                  <div className="absolute right-1.5 top-1.5 flex gap-1">
                    {acquired ? (
                      <Badge variant="success" className="h-5 px-1.5 text-[9px] rounded gap-0.5">
                        <Check className="size-2.5" /> 획득
                      </Badge>
                    ) : locked ? (
                      <Badge variant="outline" className="h-5 px-1.5 text-[9px] rounded gap-0.5 bg-black/65 text-white border-none">
                        <Lock className="size-2.5" /> 잠금
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="h-5 px-1.5 text-[9px] rounded bg-black/45 text-white border-none">
                        미획득
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Info Container below */}
                <div className="flex-1 flex flex-col p-2.5 justify-between min-h-[78px] gap-1 w-full">
                  <span className="font-semibold text-xs line-clamp-2 leading-tight text-foreground" title={gift?.name ?? item.gift_id}>
                    {gift?.name ?? item.gift_id}
                  </span>
                  
                  <div className="flex flex-col gap-1 mt-auto w-full">
                    {/* Optional or required badge */}
                    <div className="flex flex-wrap gap-1 items-center">
                      {!item.required && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                          옵션
                        </span>
                      )}
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                        {targetDepth}층 목표
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                        {DIFFICULTY_LABEL[actualDiff]}
                      </span>
                    </div>

                    {/* Blocker text if locked */}
                    {locked && (
                      <span className="text-[9px] leading-tight text-amber-500 line-clamp-1" title={`${blockerNames} 먼저 필요`}>
                        🔒 {blockerNames} 필요
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
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
  giftOrder,
  giftById,
}: {
  packOrder: PackOrderItem[];
  packById: Map<string, PackEntity>;
  giftOrder: GiftOrderItem[];
  giftById: Map<string, GiftEntity>;
}) {
  const { visitedPacks, togglePack, acquiredGifts } = usePlayStore();

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

      {ordered.map((item, i) => {
        const pack = packById.get(item.pack_id);
        const visited = visitedPacks.includes(item.pack_id);
        const isCurrent = item === currentKey;
        const prev = ordered[i - 1];
        // 직전 팩과 난이도가 다르면 전환 구분선
        const showDivider = prev && prev.difficulty !== item.difficulty;
        const hasExclusive = (pack?.exclusive_gifts?.length ?? 0) > 0;

        // 이 팩의 전용 기프트 중 루트에 목표로 등록된 것들 추출
        const targetGiftIds = new Set(giftOrder.map((g) => g.gift_id));
        const exclusiveGiftsInRoute = (pack?.exclusive_gifts ?? [])
          .filter((eg) => targetGiftIds.has(eg.gift_id))
          .map((eg) => giftById.get(eg.gift_id))
          .filter((g): g is GiftEntity => !!g);

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
              {/* 전용 기프트 목록 표시 */}
              {exclusiveGiftsInRoute.length > 0 && (
                <div className="mt-2 pl-5 border-t border-border/40 pt-2 w-full flex flex-col gap-1.5">
                  <span className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">전용 기프트 목표:</span>
                  <div className="flex flex-wrap gap-2">
                    {exclusiveGiftsInRoute.map((eg) => {
                      const acquired = acquiredGifts.includes(eg.id);
                      const attributeColor = getGiftColor(eg.keyword_type);
                      return (
                        <div
                          key={eg.id}
                          className={cn(
                            "relative flex flex-col overflow-hidden rounded border text-left bg-card w-16 h-20 transition-all",
                            acquired
                              ? "border-border opacity-[0.4]"
                              : "border-border"
                          )}
                        >
                          {/* Mini Colored Box Placeholder */}
                          <div 
                            className="h-8 w-full relative flex items-center justify-center text-[8px] font-bold text-white/90 shadow-inner"
                            style={{ backgroundColor: attributeColor }}
                          >
                            <span>{eg.keyword_type || "일반"}</span>
                            
                            {/* Checkmark overlay if acquired */}
                            {acquired && (
                              <div className="absolute right-0.5 top-0.5 bg-success/80 text-success-foreground rounded p-0.5 flex items-center justify-center">
                                <Check className="size-2" />
                              </div>
                            )}
                          </div>
                          
                          {/* Name section */}
                          <div className="flex-1 flex flex-col p-1 justify-between min-h-[36px] gap-0.5 bg-background/20">
                            <span className="font-medium text-[9px] line-clamp-2 leading-none text-foreground" title={eg.name}>
                              {eg.name}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
