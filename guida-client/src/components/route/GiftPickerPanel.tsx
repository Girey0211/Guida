import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import type { Gift } from "@/types/gameData";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn, buildGiftPackMap } from "@/lib/utils";
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
  const { packs } = useAppStore();
  const [q, setQ] = useState("");
  const [keyword, setKeyword] = useState("");
  const [grade, setGrade] = useState("");
  const [source, setSource] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [selectedPackId, setSelectedPackId] = useState("");
  const [hardOnly, setHardOnly] = useState(false);
  const [craftableOnly, setCraftableOnly] = useState(false);
  const [selectedOnly, setSelectedOnly] = useState(false);

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

  // gift_id → pack_id (테마팩 전용 관계는 packs.exclusive_gifts 에 들어 있다)
  const giftPackMap = useMemo(() => buildGiftPackMap(packs), [packs]);

  // 기프트 추가 화면: 한정 에고기프트가 있는 모든 테마팩을 후보로 보여준다.
  const exclusivePacks = useMemo(() => {
    const packIds = new Set<string>();
    gifts.forEach((g) => {
      const packId = giftPackMap.get(g.id);
      if (g.pack_exclusive && packId) {
        packIds.add(packId);
      }
    });
    return packs
      .filter((p) => packIds.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [gifts, packs, giftPackMap]);

  const filtered = useMemo(() => {
    const k = q.trim();
    return gifts.filter((g) => {
      if (k && !g.name.includes(k) && !(g.tags && g.tags.some((t) => t.includes(k)))) return false;
      if (keyword && g.keyword_type !== keyword) return false;
      if (grade && g.grade !== grade) return false;
      if (source && g.source_category !== source) return false;
      if (source === "테마팩_전용" && selectedPackId && giftPackMap.get(g.id) !== selectedPackId) return false;
      if (selectedTag && !(g.tags && g.tags.includes(selectedTag))) return false;
      if (hardOnly && !g.hard_mode_only) return false;
      if (craftableOnly && !g.is_craftable) return false;
      if (selectedOnly && !selectedIds.has(g.id)) return false;
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
                      "relative flex flex-col gap-1 rounded-md border p-2 text-left transition-colors",
                      selected
                        ? "border-primary bg-primary/15"
                        : "border-border bg-muted/30 hover:border-primary/40",
                    )}
                  >
                    {selected && (
                      <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3" />
                      </span>
                    )}
                    <span className="line-clamp-2 pr-5 text-xs font-medium">{g.name}</span>
                    <span className="flex items-center gap-1">
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                        style={{ backgroundColor: g.keyword_color }}
                      >
                        {g.keyword_type}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{g.grade}등급</span>
                    </span>
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
