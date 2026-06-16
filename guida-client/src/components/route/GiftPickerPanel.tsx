import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import type { Gift, DependencyEdge } from "@/types/gameData";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, buildGiftPackMap, getGiftColor } from "@/lib/utils";
import { GiftImageOverlay } from "@/components/common/GiftImageOverlay";
import { useAppStore } from "@/store/appStore";

interface Props {
  gifts: Gift[];
  /** 현재 목표로 선택된 기프트 id 집합 */
  selectedIds: Set<string>;
  /** 박스를 누르면 선택/해제 토글 */
  onToggle: (id: string) => void;
  onSelectMultiple?: (ids: string[]) => void;
  onDeselectMultiple?: (ids: string[]) => void;
  onClose: () => void;
}

/** "전체" 옵션을 포함한 distinct 값 목록 */
function distinct<T extends string>(values: (T | null | undefined)[]): T[] {
  return [...new Set(values.filter((v): v is T => Boolean(v)))];
}

function renderRecipe(recipe: any, giftById: Map<string, Gift>, acquiredGifts: string[] | Set<string>) {
  if (!recipe) return null;

  const getMaterialSpan = (id: string) => {
    const name = giftById.get(id)?.name ?? id;
    const acquired = acquiredGifts instanceof Set ? acquiredGifts.has(id) : acquiredGifts.includes(id);
    return (
      <span key={id} className={cn(acquired ? "text-emerald-500 font-semibold" : "text-muted-foreground/80")}>
        {name}{acquired && "✓"}
      </span>
    );
  };

  if (recipe.type === "simple") {
    return (
      <span className="inline-flex flex-wrap items-center gap-0.5">
        {recipe.required?.map((id: string, idx: number) => (
          <span key={id} className="inline-flex items-center">
            {idx > 0 && <span className="mx-1 text-muted-foreground/60">+</span>}
            {getMaterialSpan(id)}
          </span>
        ))}
      </span>
    );
  }

  if (recipe.type === "multi_path") {
    const paths = recipe.paths ?? [];
    let bestPath: string[] = [];
    let maxLen = -1;
    for (const p of paths) {
      if (p.length > maxLen) {
        maxLen = p.length;
        bestPath = p;
      }
    }
    if (bestPath.length === 0) return null;

    return (
      <span className="inline-flex flex-wrap items-center gap-0.5">
        {bestPath.map((id: string, idx: number) => (
          <span key={id} className="inline-flex items-center">
            {idx > 0 && <span className="mx-1 text-muted-foreground/60">+</span>}
            {getMaterialSpan(id)}
          </span>
        ))}
      </span>
    );
  }

  if (recipe.type === "required_and_pick") {
    const pickCount = recipe.pick?.count ?? 0;
    return (
      <span className="flex flex-col gap-0.5">
        <span className="inline-flex flex-wrap items-center gap-0.5">
          {recipe.required?.map((id: string, idx: number) => (
            <span key={id} className="inline-flex items-center">
              {idx > 0 && <span className="mx-1 text-muted-foreground/60">+</span>}
              {getMaterialSpan(id)}
            </span>
          ))}
        </span>
        <span className="text-muted-foreground/80 text-[8px]">
          + 아래 중 {pickCount}개:
          <span className="ml-1 inline-flex flex-wrap gap-1">
            (
            {recipe.pick?.from.map((id: string, idx: number) => (
              <span key={id} className="inline-flex items-center">
                {idx > 0 && <span className="mr-1">,</span>}
                {getMaterialSpan(id)}
              </span>
            ))}
            )
          </span>
        </span>
      </span>
    );
  }

  return null;
}

/**
 * 목표 에고기프트 선택용 오른쪽 드로어 패널.
 * 상단 필터(검색/키워드/등급/출처/태그/하드 전용) + 박스형 목록.
 * 박스를 누르면 선택 표시로 바뀌고, 다시 누르면 해제된다.
 * 출처를 "테마팩_전용"으로 고르면 어떤 테마팩인지 고르는 필터가 추가로 나타난다.
 */
export function GiftPickerPanel({
  gifts,
  selectedIds,
  onToggle,
  onSelectMultiple,
  onDeselectMultiple,
  onClose,
}: Props) {
  const { packs, dependencies } = useAppStore();
  const [q, setQ] = useState("");
  const [keyword, setKeyword] = useState("");
  const [grade, setGrade] = useState("");
  const [source, setSource] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [selectedPackId, setSelectedPackId] = useState("");
  const [hardOnly, setHardOnly] = useState(false);
  const [craftableOnly, setCraftableOnly] = useState(false);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [noPrereqOrMaterial, setNoPrereqOrMaterial] = useState(false);

  // 드래그 다중 선택 상태
  const [isDragging, setIsDragging] = useState(false);
  const [dragAction, setDragAction] = useState<"select" | "deselect" | null>(null);
  const [draggedIds, setDraggedIds] = useState<Set<string>>(new Set());

  // mouseup 감지하여 드래그 세션 종료
  useEffect(() => {
    if (!isDragging) return;
    const handleGlobalMouseUp = () => {
      setIsDragging(false);
      setDragAction(null);
      setDraggedIds(new Set());
    };
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => {
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [isDragging]);

  const handleMouseDown = (id: string, currentlySelected: boolean) => {
    setIsDragging(true);
    const action = currentlySelected ? "deselect" : "select";
    setDragAction(action);
    onToggle(id);

    const initial = new Set<string>();
    initial.add(id);
    setDraggedIds(initial);
  };

  const handleMouseEnter = (id: string, currentlySelected: boolean) => {
    if (!isDragging || !dragAction || draggedIds.has(id)) return;

    if (dragAction === "select" && !currentlySelected) {
      onToggle(id);
    } else if (dragAction === "deselect" && currentlySelected) {
      onToggle(id);
    }

    setDraggedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const keywords = useMemo(() => distinct(gifts.map((g) => g.keyword_type)), [gifts]);
  const grades = useMemo(
    () => distinct(gifts.map((g) => g.grade)).sort((a, b) => a.localeCompare(b)),
    [gifts],
  );
  const sources = useMemo(() => distinct(gifts.map((g) => g.source_category)), [gifts]);

  const tags = useMemo(() => {
    const tSet = new Set<string>();
    const excluded = new Set([
      "화상", "출혈", "진동", "파열", "침잠", "호흡", "충전",
      "참격", "관통", "타격", "범용"
    ]);
    gifts.forEach((g) => {
      if (g.tags) {
        g.tags.forEach((t) => {
          if (!excluded.has(t)) {
            tSet.add(t);
          }
        });
      }
    });
    return [...tSet].sort((a, b) => a.localeCompare(b));
  }, [gifts]);

  // gift_id → pack_id[] (테마팩 전용 관계는 packs.exclusive_gifts 에 들어 있다)
  const giftPackMap = useMemo(() => buildGiftPackMap(packs, gifts), [packs, gifts]);

  // 기프트 추가 화면: 한정 에고기프트가 있는 모든 테마팩을 후보로 보여준다.
  const exclusivePacks = useMemo(() => {
    const packIds = new Set<string>();
    gifts.forEach((g) => {
      const packIdsForGift = giftPackMap.get(g.id) ?? [];
      if (g.pack_exclusive) {
        packIdsForGift.forEach((pId) => packIds.add(pId));
      }
    });
    return packs
      .filter((p) => packIds.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [gifts, packs, giftPackMap]);

  const giftById = useMemo(() => new Map(gifts.map((g) => [g.id, g])), [gifts]);
  const depsByGift = useMemo(
    () => new Map(dependencies.map((d) => [d.gift_id, d.dependencies])),
    [dependencies],
  );

  const filtered = useMemo(() => {
    const k = q.trim();
    return gifts.filter((g) => {
      if (k && !g.name.includes(k) && !(g.tags && g.tags.some((t) => t.includes(k)))) return false;
      if (keyword && g.keyword_type !== keyword) return false;
      if (grade && g.grade !== grade) return false;
      if (source && g.source_category !== source) return false;
      if (source === "테마팩_전용" && selectedPackId) {
        const packsForGift = giftPackMap.get(g.id) ?? [];
        if (!packsForGift.includes(selectedPackId)) return false;
      }
      if (selectedTag && !(g.tags && g.tags.includes(selectedTag))) return false;
      if (hardOnly && !g.hard_mode_only) return false;
      if (craftableOnly && !g.is_craftable) return false;
      if (selectedOnly && !selectedIds.has(g.id)) return false;
      if (noPrereqOrMaterial) {
        const hasPrereq = (depsByGift.get(g.id) ?? []).some((e) => e.type === "before");
        const hasMaterial = g.is_craftable;
        if (hasPrereq || hasMaterial) return false;
      }
      return true;
    });
  }, [
    gifts,
    q,
    keyword,
    grade,
    source,
    selectedPackId,
    selectedTag,
    hardOnly,
    craftableOnly,
    selectedOnly,
    selectedIds,
    giftPackMap,
    noPrereqOrMaterial,
    depsByGift,
  ]);

  const resetFilters = () => {
    setQ("");
    setKeyword("");
    setGrade("");
    setSource("");
    setSelectedTag("");
    setSelectedPackId("");
    setHardOnly(false);
    setCraftableOnly(false);
    setSelectedOnly(false);
    setNoPrereqOrMaterial(false);
  };

  return createPortal(
    <>
      {/* 백드롭 */}
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden />
      {/* 드로어 */}
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h3 className="text-sm font-semibold">목표 에고기프트 추가</h3>
            <p className="text-[11px] text-muted-foreground">
              선택 {selectedIds.size}개 · 박스를 눌러 추가/해제
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="size-4" />
            닫기
          </Button>
        </div>

        {/* 필터 */}
        <div className="space-y-2 border-b border-border p-3">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="기프트 이름 검색"
            className="h-8"
          />
          <div className="grid grid-cols-2 gap-2">
            <Select value={keyword} onChange={(e) => setKeyword(e.target.value)} className="h-8">
              <option value="">키워드 전체</option>
              {keywords.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
            <Select value={grade} onChange={(e) => setGrade(e.target.value)} className="h-8">
              <option value="">등급 전체</option>
              {grades.map((g) => (
                <option key={g} value={g}>
                  {g}등급
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select value={source} onChange={(e) => {
              const val = e.target.value;
              setSource(val);
              if (val !== "테마팩_전용") {
                setSelectedPackId("");
              }
            }} className="h-8">
              <option value="">출처 전체</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Select value={selectedTag} onChange={(e) => setSelectedTag(e.target.value)} className="h-8">
              <option value="">태그 전체</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          {source === "테마팩_전용" && (
            <Select value={selectedPackId} onChange={(e) => setSelectedPackId(e.target.value)} className="h-8 w-full mt-1">
              <option value="">테마팩 전체</option>
              {exclusivePacks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={hardOnly} onClick={() => setHardOnly((v) => !v)}>
              하드 전용
            </FilterChip>
            <FilterChip active={craftableOnly} onClick={() => setCraftableOnly((v) => !v)}>
              합성 가능
            </FilterChip>
            <FilterChip active={selectedOnly} onClick={() => setSelectedOnly((v) => !v)}>
              선택한 것만
            </FilterChip>
            <FilterChip active={noPrereqOrMaterial} onClick={() => setNoPrereqOrMaterial((v) => !v)}>
              선행 없음
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

        {/* 검색 결과 요약 및 전체 작업 */}
        <div className="flex items-center justify-between border-b border-border bg-muted/20 px-4 py-2 text-xs">
          <span className="text-muted-foreground text-[11px]">
            필터 결과: <b className="font-semibold text-foreground">{filtered.length}</b>개
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px] font-medium"
              onClick={() => {
                const idsToSelect = filtered.map((g) => g.id);
                onSelectMultiple?.(idsToSelect);
              }}
              disabled={filtered.length === 0}
            >
              필터 결과 전체 선택
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px] font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={() => {
                const idsToDeselect = filtered.map((g) => g.id);
                onDeselectMultiple?.(idsToDeselect);
              }}
              disabled={filtered.length === 0}
            >
              필터 결과 전체 해제
            </Button>
          </div>
        </div>

        {/* 박스 목록 */}
        <div className="flex-1 overflow-y-auto p-3">
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              조건에 맞는 기프트가 없습니다.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 select-none">
              {filtered.map((g) => {
                const selected = selectedIds.has(g.id);
                const beforeDeps = (depsByGift.get(g.id) ?? []).filter(
                  (e) => e.type === "before"
                );
                const uniqueBeforeDeps: DependencyEdge[] = [];
                const seen = new Set<string>();
                for (const dep of beforeDeps) {
                  if (!seen.has(dep.target.gift_id)) {
                    seen.add(dep.target.gift_id);
                    uniqueBeforeDeps.push(dep);
                  }
                }
                const attributeColor = getGiftColor(g.keyword_type);

                return (
                  <button
                    key={g.id}
                    type="button"
                    onMouseDown={() => handleMouseDown(g.id, selected)}
                    onMouseEnter={() => handleMouseEnter(g.id, selected)}
                    onDragStart={(e) => e.preventDefault()}
                    onClick={(e) => {
                      if (e.detail === 0) {
                        onToggle(g.id);
                      }
                    }}
                    title={g.effect}
                    className={cn(
                      "group relative flex flex-col overflow-hidden rounded-lg border transition-all text-left bg-card",
                      selected
                        ? "border-emerald-500 bg-emerald-500/[0.03] shadow-[0_0_10px_rgba(16,185,129,0.25)] ring-1 ring-emerald-500/30 hover:scale-[1.02]"
                        : "border-border bg-card/60 hover:border-primary/40 hover:scale-[1.02]",
                    )}
                  >
                    {/* Colored Box Header */}
                    <div
                      className="aspect-square w-full relative flex items-center justify-center text-[10px] font-bold text-white/90 shadow-inner"
                      style={{ backgroundColor: attributeColor }}
                    >
                      <span>{g.keyword_type || "일반"}</span>

                      <GiftImageOverlay imageKey={g.image_key} alt={g.name} />

                      {/* Status Overlay Badge */}
                      <div className="absolute right-1.5 top-1.5 z-10">
                        {selected ? (
                          <Badge variant="default" className="h-5 px-1.5 text-[8px] rounded gap-0.5 bg-emerald-600 text-white font-bold border-none shadow-[0_1px_3px_rgba(0,0,0,0.3)] hover:bg-emerald-600">
                            <Check className="size-2.5" /> 추가됨
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="h-5 px-1.5 text-[8px] rounded bg-black/60 text-white/90 border-none font-medium">
                            미추가
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Info Container */}
                    <div className="flex-1 flex flex-col p-2.5 justify-between w-full gap-1.5 min-h-[78px]">
                      {/* Top Block: Name, Grade, Tags */}
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-xs leading-tight text-foreground line-clamp-2" title={g.name}>
                          {g.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{g.grade}등급</span>

                        {/* Tag list */}
                        {(g.tags || g.pack_exclusive) && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {g.tags
                              ?.filter((t) => t !== g.keyword_type && t !== "범용")
                              .map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded bg-primary/10 px-1.5 py-0.5 text-[8px] font-medium text-primary animate-fade-in"
                                >
                                  {tag}
                                </span>
                              ))}
                            {g.pack_exclusive && (
                              <span className="rounded bg-amber-500/10 text-amber-600 border border-amber-500/20 px-1.5 py-0.5 text-[8px] font-semibold animate-fade-in">
                                테마팩한정
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Bottom Block: Crafting Recipe and Prerequisites */}
                      {(g.is_craftable || uniqueBeforeDeps.length > 0) && (
                        <div className="flex flex-col gap-1.5 border-t border-border/40 pt-1.5">
                          {/* Crafting Recipe */}
                          {g.is_craftable && g.craft_recipe && (
                            <div className="text-[8px] leading-tight">
                              <div className="font-semibold text-amber-500 mb-0.5">조합식</div>
                              {renderRecipe(g.craft_recipe, giftById, selectedIds)}
                            </div>
                          )}

                          {/* Prerequisite Gifts */}
                          {uniqueBeforeDeps.length > 0 && (
                            <div className="text-[8px] leading-tight">
                              <div className="font-semibold text-amber-500 mb-0.5">선행기프트</div>
                              <div className="flex flex-wrap items-center gap-1">
                                {uniqueBeforeDeps.map((dep, idx) => {
                                  const id = dep.target.gift_id;
                                  const name = giftById.get(id)?.name ?? dep.target.name ?? id;
                                  const acquired = selectedIds.has(id);
                                  return (
                                    <span key={id} className="inline-flex items-center">
                                      {idx > 0 && <span className="mr-1 text-muted-foreground/60">,</span>}
                                      <span className={cn(acquired ? "text-emerald-500 font-semibold" : "text-muted-foreground/80")}>
                                        {name}{acquired && "✓"}
                                      </span>
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>,
    document.body
  );
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
