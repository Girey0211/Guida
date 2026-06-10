import type { RouteFilterState } from "@/types/filter";
import type { DifficultyMode, DifficultyTag, RouteType } from "@/types/route";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DEFAULT_FILTER } from "@/types/filter";
import { RotateCcw } from "lucide-react";

interface Props {
  filter: RouteFilterState;
  onChange: (next: RouteFilterState) => void;
  currentPatch: string;
  /** 데이터에 존재하는 패치 버전 목록 */
  availablePatches: string[];
  /** 선택 가능한 목표 재화 */
  targetRewards: string[];
}

const DIFFICULTIES: DifficultyTag[] = ["쉬움", "보통", "어려움"];
const ROUTE_TYPES: RouteType[] = ["파밍 효율 중심", "특정 목표 중심"];
const DIFFICULTY_MODES: { value: DifficultyMode; label: string }[] = [
  { value: "normal", label: "노말" },
  { value: "hard", label: "하드" },
  { value: "extreme", label: "EXTREME" },
];

/** 탐색 필터 패널 (README 섹션 6) */
export function RouteFilter({
  filter,
  onChange,
  currentPatch,
  availablePatches,
  targetRewards,
}: Props) {
  const set = <K extends keyof RouteFilterState>(key: K, value: RouteFilterState[K]) =>
    onChange({ ...filter, [key]: value });

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">필터 / 정렬</h3>
        <Button variant="ghost" size="sm" onClick={() => onChange(DEFAULT_FILTER)}>
          <RotateCcw className="size-3.5" />
          초기화
        </Button>
      </div>

      {/* 기본 필터 */}
      <div className="space-y-1.5">
        <Label>패치 버전</Label>
        <Select value={filter.patch} onChange={(e) => set("patch", e.target.value)}>
          <option value="current">현재 패치 (v{currentPatch})</option>
          <option value="all">전체</option>
          {availablePatches
            .filter((p) => p !== currentPatch)
            .map((p) => (
              <option key={p} value={p}>
                v{p}
              </option>
            ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>정렬 기준</Label>
        <Select value={filter.sortBy} onChange={(e) => set("sortBy", e.target.value as RouteFilterState["sortBy"])}>
          <option value="likes">추천순</option>
          <option value="recent">최신순</option>
          <option value="play_count">플레이 많은순</option>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>검증 여부</Label>
        <Select
          value={filter.verified}
          onChange={(e) => set("verified", e.target.value as RouteFilterState["verified"])}
        >
          <option value="verified_only">검증된 루트만</option>
          <option value="all">전체</option>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>이미 가져온 루트</Label>
        <Select
          value={filter.hideImported ? "hide" : "all"}
          onChange={(e) => set("hideImported", e.target.value === "hide")}
        >
          <option value="all">함께 보기</option>
          <option value="hide">숨기기</option>
        </Select>
      </div>

      <hr className="border-border" />

      {/* 게임 콘텐츠 필터 */}
      <div className="space-y-1.5">
        <Label>목표 재화</Label>
        <Select value={filter.targetReward} onChange={(e) => set("targetReward", e.target.value)}>
          <option value="">전체</option>
          {targetRewards.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>거던 층수 (특정 층 집중)</Label>
        <Select
          value={filter.floor ?? ""}
          onChange={(e) => set("floor", e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">전체</option>
          {[1, 2, 3, 4, 5, 6, 7].map((f) => (
            <option key={f} value={f}>
              {f}층
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>난이도</Label>
        <Select
          value={filter.difficultyMode ?? ""}
          onChange={(e) => set("difficultyMode", (e.target.value || null) as DifficultyMode | null)}
        >
          <option value="">전체</option>
          {DIFFICULTY_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>난이도 태그</Label>
        <Select
          value={filter.difficulty ?? ""}
          onChange={(e) => set("difficulty", (e.target.value || null) as DifficultyTag | null)}
        >
          <option value="">전체</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>루트 유형</Label>
        <Select
          value={filter.routeType ?? ""}
          onChange={(e) => set("routeType", (e.target.value || null) as RouteType | null)}
        >
          <option value="">전체</option>
          {ROUTE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </div>

      <hr className="border-border" />

      {/* 신뢰도 필터 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>최소 추천수</Label>
          <Input
            type="number"
            min={0}
            value={filter.minLikes}
            onChange={(e) => set("minLikes", Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>최소 플레이수</Label>
          <Input
            type="number"
            min={0}
            value={filter.minPlays}
            onChange={(e) => set("minPlays", Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        ⚠️ 패치 버전 기본값은 항상 <b>현재 패치</b>로 고정됩니다. 메타가 빠르게 변하는 림버스 특성을 반영합니다.
      </p>
    </div>
  );
}
