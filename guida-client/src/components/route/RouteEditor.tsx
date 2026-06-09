import { useState } from "react";
import { Plus, Trash2, Save, X } from "lucide-react";
import type { DifficultyTag, RouteDraft, RouteStep, RouteType } from "@/types/route";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface Props {
  /** 편집 시 초기값 (없으면 새 루트) */
  initial?: RouteDraft;
  /** 선택 가능한 목표 재화 (게임 데이터에서) */
  targetRewards: string[];
  onSubmit: (draft: RouteDraft, selfReported: boolean) => void;
  onCancel: () => void;
  /** 편집 모드일 때 기존 검증 여부 */
  initialSelfReported?: boolean;
  submitting?: boolean;
}

const DIFFICULTIES: DifficultyTag[] = ["쉬움", "보통", "어려움"];
const ROUTE_TYPES: RouteType[] = ["파밍 효율 중심", "특정 목표 중심"];
const ALL_FLOORS = [1, 2, 3, 4, 5, 6, 7];

const EMPTY: RouteDraft = {
  name: "",
  target_rewards: [],
  floors: [1, 2, 3, 4, 5, 6, 7],
  difficulty_tag: "보통",
  route_type: "파밍 효율 중심",
  steps: [],
  memo: "",
};

/** 루트 작성/편집 폼 */
export function RouteEditor({
  initial,
  targetRewards,
  onSubmit,
  onCancel,
  initialSelfReported = false,
  submitting,
}: Props) {
  const [draft, setDraft] = useState<RouteDraft>(initial ?? EMPTY);
  const [selfReported, setSelfReported] = useState(initialSelfReported);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof RouteDraft>(key: K, value: RouteDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const toggleReward = (r: string) =>
    set(
      "target_rewards",
      draft.target_rewards.includes(r)
        ? draft.target_rewards.filter((x) => x !== r)
        : [...draft.target_rewards, r],
    );

  const toggleFloor = (f: number) =>
    set("floors", draft.floors.includes(f) ? draft.floors.filter((x) => x !== f) : [...draft.floors, f].sort((a, b) => a - b));

  const addStep = () => set("steps", [...draft.steps, { floor: draft.floors[0] ?? 1, note: "" }]);
  const updateStep = (i: number, patch: Partial<RouteStep>) =>
    set("steps", draft.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const removeStep = (i: number) => set("steps", draft.steps.filter((_, idx) => idx !== i));

  const handleSubmit = () => {
    if (!draft.name.trim()) return setError("루트 이름을 입력해 주세요.");
    if (draft.floors.length === 0) return setError("최소 1개 층을 선택해 주세요.");
    setError(null);
    onSubmit({ ...draft, name: draft.name.trim() }, selfReported);
  };

  return (
    <div className="space-y-5">
      {/* 이름 */}
      <div className="space-y-1.5">
        <Label>루트 이름 *</Label>
        <Input
          value={draft.name}
          placeholder="예: 주간 루심화폐 파밍 루트"
          onChange={(e) => set("name", e.target.value)}
          maxLength={40}
        />
      </div>

      {/* 목표 재화 */}
      <div className="space-y-1.5">
        <Label>목표 재화</Label>
        <div className="flex flex-wrap gap-1.5">
          {targetRewards.map((r) => {
            const active = draft.target_rewards.includes(r);
            return (
              <button
                key={r}
                type="button"
                onClick={() => toggleReward(r)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40",
                )}
              >
                {active ? "✓ " : ""}
                {r}
              </button>
            );
          })}
        </div>
      </div>

      {/* 층수 */}
      <div className="space-y-1.5">
        <Label>거던 층수 *</Label>
        <div className="flex flex-wrap gap-1.5">
          {ALL_FLOORS.map((f) => {
            const active = draft.floors.includes(f);
            return (
              <button
                key={f}
                type="button"
                onClick={() => toggleFloor(f)}
                className={cn(
                  "h-8 w-9 rounded-md border text-sm transition-colors",
                  active
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40",
                )}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      {/* 난이도 / 유형 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>난이도</Label>
          <Select value={draft.difficulty_tag} onChange={(e) => set("difficulty_tag", e.target.value as DifficultyTag)}>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>루트 유형</Label>
          <Select value={draft.route_type} onChange={(e) => set("route_type", e.target.value as RouteType)}>
            {ROUTE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* 단계 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>층별 단계 메모</Label>
          <Button type="button" variant="outline" size="sm" onClick={addStep}>
            <Plus className="size-3.5" />
            단계 추가
          </Button>
        </div>
        {draft.steps.length === 0 && (
          <p className="text-xs text-muted-foreground">단계가 없습니다. 층별 권장 행동을 추가해 보세요.</p>
        )}
        <div className="space-y-2">
          {draft.steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select
                value={step.floor}
                onChange={(e) => updateStep(i, { floor: Number(e.target.value) })}
                className="h-9 w-20 shrink-0"
              >
                {ALL_FLOORS.map((f) => (
                  <option key={f} value={f}>
                    {f}층
                  </option>
                ))}
              </Select>
              <Input
                value={step.note}
                placeholder="권장 선택지/행동"
                onChange={(e) => updateStep(i, { note: e.target.value })}
              />
              <Button type="button" variant="ghost" size="icon" onClick={() => removeStep(i)}>
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* 메모 */}
      <div className="space-y-1.5">
        <Label>자유 메모</Label>
        <Textarea
          value={draft.memo}
          placeholder="예: 3층 선택지 주의. 체력 관리가 핵심."
          onChange={(e) => set("memo", e.target.value)}
        />
      </div>

      {/* 자기 신고 (Phase 1 검증) */}
      <label className="flex items-start gap-2.5 rounded-md border border-border bg-muted/30 p-3">
        <Checkbox checked={selfReported} onChange={(e) => setSelfReported(e.target.checked)} className="mt-0.5" />
        <span className="text-sm">
          <b>실제로 이 루트로 플레이했습니다.</b>
          <span className="block text-xs text-muted-foreground">
            Phase 1에서는 자기 신고 방식으로 검증됩니다. 체크해야 공유(코드 발급)가 가능합니다.
          </span>
        </span>
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          <X className="size-4" />
          취소
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          <Save className="size-4" />
          저장
        </Button>
      </div>
    </div>
  );
}
