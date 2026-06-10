import { useMemo, useState } from "react";
import { Plus, Save, X, Check } from "lucide-react";
import type {
  DifficultyMode,
  DifficultyTag,
  PackOrderItem,
  RouteDraft,
  RouteType,
} from "@/types/route";
import type { DungeonMeta, Gift, Pack } from "@/types/gameData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { GiftPickerPanel } from "@/components/route/GiftPickerPanel";
import { cn } from "@/lib/utils";

interface Props {
  /** 편집 시 초기값 (없으면 새 루트) */
  initial?: RouteDraft;
  /** 에고기프트 카탈로그 (목표 기프트 / 시작 기프트 선택지) */
  gifts: Gift[];
  /** 팩 카탈로그 (팩 방문 선택지) */
  packs: Pack[];
  /** 시즌 메타 (시작 기프트 / 가호 / EXTREME 제약 선택지) */
  dungeonMeta: DungeonMeta | null;
  onSubmit: (draft: RouteDraft, selfReported: boolean) => void;
  onCancel: () => void;
  /** 편집 모드일 때 기존 검증 여부 */
  initialSelfReported?: boolean;
  submitting?: boolean;
}

const DIFFICULTIES: DifficultyTag[] = ["쉬움", "보통", "어려움"];
const ROUTE_TYPES: RouteType[] = ["파밍 효율 중심", "특정 목표 중심"];
/** 목표 층수 — 도달 목표 깊이 */
const TARGET_FLOORS = [5, 10, 15];
/** 하드 전환 가능 층 (1~5 중 하나) */
const SWITCH_FLOORS = [1, 2, 3, 4, 5];
const EXTREME_FLOORS = ["11", "12", "13", "14", "15"];

const DIFFICULTY_MODE_LABEL: Record<DifficultyMode, string> = {
  normal: "노말",
  hard: "하드",
  extreme: "EXTREME",
};
const DIFFICULTY_MODES: DifficultyMode[] = ["normal", "hard", "extreme"];
const STAGE_LABEL = ["기본", "+", "++"];

/** 팩 방문 구간 (1·2·3·4층 개별, 5~10·11~15는 묶음) */
const PACK_BUCKETS: { key: string; label: string; floor: number }[] = [
  { key: "1", label: "1층", floor: 1 },
  { key: "2", label: "2층", floor: 2 },
  { key: "3", label: "3층", floor: 3 },
  { key: "4", label: "4층", floor: 4 },
  { key: "5-10", label: "5~10층", floor: 5 },
  { key: "11-15", label: "11~15층 (EXTREME)", floor: 11 },
];

/** 팩 floor 값 → 구간 key */
function bucketOf(floor: number): string {
  if (floor >= 11) return "11-15";
  if (floor >= 5) return "5-10";
  return String(floor);
}

/**
 * 특정 층의 실제 난이도 판정.
 * - 11층 이상: EXTREME
 * - 하드/EXTREME 모드: 1~10층은 하드
 * - 노말 모드: 하드 전환 층 이상이면 하드, 아니면 노말
 */
function difficultyAtFloor(
  floor: number,
  mode: DifficultyMode,
  switchFloor: number | null,
): DifficultyMode {
  if (floor >= 11) return "extreme";
  if (mode === "hard" || mode === "extreme") return "hard";
  if (switchFloor != null && floor >= switchFloor) return "hard";
  return "normal";
}

/** 해당 구간·난이도에 등장할 수 있는 팩인지 (README §8.7) */
function packEligible(pack: Pack, bucketKey: string, diff: DifficultyMode): boolean {
  if (bucketKey === "11-15") return pack.is_extreme_only;
  if (pack.is_extreme_only) return false;
  const floor = bucketKey === "5-10" ? 5 : Number(bucketKey);
  // 노말이면 노말 풀, 하드/EXTREME이면 하드 풀에서 해당 층 등장 여부로 판단
  const floors = diff === "normal" ? pack.available_floors_normal : pack.available_floors_hard;
  return Boolean(floors?.includes(floor));
}

const EMPTY: RouteDraft = {
  name: "",
  target_rewards: [],
  difficulty_tag: "보통",
  route_type: "파밍 효율 중심",
  difficulty_mode: "normal",
  difficulty_switch_floor: null,
  floors: [5],
  memo: "",
  gift_order: [],
  pack_order: [],
  starting_gift: null,
  gahos: [],
  restrictions: {},
};

/** 검색 + 클릭 추가형 카탈로그 피커 */
function CatalogPicker({
  items,
  onPick,
  placeholder,
}: {
  items: { id: string; name: string; sub?: string }[];
  onPick: (id: string) => void;
  placeholder: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const k = q.trim();
    return (k ? items.filter((i) => i.name.includes(k)) : items).slice(0, 60);
  }, [items, q]);
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-8" />
      <div className="max-h-48 space-y-0.5 overflow-y-auto">
        {filtered.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => onPick(i.id)}
            className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-primary/15"
          >
            <span>{i.name}</span>
            {i.sub && <span className="shrink-0 text-muted-foreground">{i.sub}</span>}
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">검색 결과가 없습니다.</p>
        )}
      </div>
    </div>
  );
}

/** 루트 작성/편집 폼 */
export function RouteEditor({
  initial,
  gifts,
  packs,
  dungeonMeta,
  onSubmit,
  onCancel,
  initialSelfReported = false,
  submitting,
}: Props) {
  const [draft, setDraft] = useState<RouteDraft>(initial ?? EMPTY);
  const [selfReported, setSelfReported] = useState(initialSelfReported);
  const [error, setError] = useState<string | null>(null);
  const [giftPickerOpen, setGiftPickerOpen] = useState(false);
  const [openPackBucket, setOpenPackBucket] = useState<string | null>(null);

  const set = <K extends keyof RouteDraft>(key: K, value: RouteDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const giftById = useMemo(() => new Map(gifts.map((g) => [g.id, g])), [gifts]);
  const packById = useMemo(() => new Map(packs.map((p) => [p.id, p])), [packs]);

  // ── 목표 층수 ─────────────────────────────────────────────────
  const targetDepth = draft.floors[0] ?? 5;
  const setDepth = (d: number) => set("floors", [d]);

  // ── 난이도 모드 / 하드 전환 층 ──────────────────────────────────
  const switchEnabled = draft.difficulty_mode === "normal";
  const setMode = (mode: DifficultyMode) =>
    setDraft((d) => ({
      ...d,
      difficulty_mode: mode,
      // 노말이 아니면 하드 전환 개념이 없으므로 초기화
      difficulty_switch_floor: mode === "normal" ? d.difficulty_switch_floor : null,
    }));
  const toggleSwitchFloor = (f: number) =>
    set("difficulty_switch_floor", draft.difficulty_switch_floor === f ? null : f);

  // ── 시작 기프트 (키워드 1개 → 기프트 다중 선택) ──────────────────
  const startingGroups = dungeonMeta?.starting_gifts ?? [];
  const startingKeyword = draft.starting_gift?.keyword_type ?? "";
  const startingGroup = startingGroups.find((g) => g.keyword_type === startingKeyword);
  const selectedStartIds = new Set(draft.starting_gift?.gifts?.map((g) => g.gift_id) ?? []);
  const setStartingKeyword = (keyword: string) =>
    set("starting_gift", keyword ? { keyword_type: keyword, gifts: [] } : null);
  const toggleStartingGift = (gift: { gift_id: string; name: string }) => {
    if (!draft.starting_gift) return;
    const current = draft.starting_gift.gifts ?? [];
    const exists = selectedStartIds.has(gift.gift_id);
    const next = exists
      ? current.filter((g) => g.gift_id !== gift.gift_id)
      : [...current, { gift_id: gift.gift_id, name: gift.name }];
    set("starting_gift", { ...draft.starting_gift, gifts: next });
  };

  // ── 목표 에고기프트 (순서 무관 리스트) ──────────────────────────
  const giftIds = new Set(draft.gift_order.map((g) => g.gift_id));
  const addGift = (id: string) => {
    if (giftIds.has(id)) return;
    set("gift_order", [
      ...draft.gift_order,
      {
        gift_id: id,
        priority: draft.gift_order.length + 1,
        floor_target: targetDepth,
        difficulty: draft.difficulty_mode,
        required: true,
      },
    ]);
  };
  const removeGift = (id: string) =>
    set(
      "gift_order",
      draft.gift_order.filter((g) => g.gift_id !== id).map((g, i) => ({ ...g, priority: i + 1 })),
    );
  const toggleGift = (id: string) => (giftIds.has(id) ? removeGift(id) : addGift(id));

  // ── 팩 방문 (구간별) ───────────────────────────────────────────
  const packsByBucket = useMemo(() => {
    const m: Record<string, PackOrderItem[]> = {};
    for (const b of PACK_BUCKETS) m[b.key] = [];
    for (const p of draft.pack_order) (m[bucketOf(p.floor)] ??= []).push(p);
    return m;
  }, [draft.pack_order]);
  const addPack = (bucket: { key: string; floor: number }, packId: string, diff: DifficultyMode) => {
    if (draft.pack_order.some((p) => p.pack_id === packId && bucketOf(p.floor) === bucket.key)) return;
    set("pack_order", [
      ...draft.pack_order,
      {
        pack_id: packId,
        floor: bucket.floor,
        difficulty: diff,
        priority: draft.pack_order.length + 1,
        memo: null,
        alternative: false,
      },
    ]);
  };
  const removePack = (packId: string, floor: number) =>
    set("pack_order", draft.pack_order.filter((p) => !(p.pack_id === packId && p.floor === floor)));
  const togglePackAlt = (packId: string, floor: number) =>
    set(
      "pack_order",
      draft.pack_order.map((p) =>
        p.pack_id === packId && p.floor === floor ? { ...p, alternative: !p.alternative } : p,
      ),
    );
  const setPackMemo = (packId: string, floor: number, memo: string) =>
    set(
      "pack_order",
      draft.pack_order.map((p) =>
        p.pack_id === packId && p.floor === floor ? { ...p, memo: memo || null } : p,
      ),
    );
  const packPickerItems = (bucketKey: string, diff: DifficultyMode) =>
    packs
      .filter((p) => packEligible(p, bucketKey, diff))
      .filter((p) => !draft.pack_order.some((o) => o.pack_id === p.id && bucketOf(o.floor) === bucketKey))
      .map((p) => ({ id: p.id, name: p.name, sub: p.pack_type }));

  // ── 별의 가호 (전체 목록 + 강화도) ─────────────────────────────
  const metaGahos = dungeonMeta?.gahos ?? [];
  const gahoStage = (id: string) => draft.gahos.find((g) => g.gaho_id === id)?.stage ?? null;
  const toggleGaho = (meta: { id: string; name: string }) => {
    const selected = draft.gahos.some((g) => g.gaho_id === meta.id);
    set(
      "gahos",
      selected
        ? draft.gahos.filter((g) => g.gaho_id !== meta.id)
        : [...draft.gahos, { gaho_id: meta.id, name: meta.name, stage: 0 }],
    );
  };
  const setGahoStage = (id: string, stage: number) =>
    set("gahos", draft.gahos.map((g) => (g.gaho_id === id ? { ...g, stage } : g)));
  const setAllGahos = (stage: number) =>
    set("gahos", metaGahos.map((g) => ({ gaho_id: g.id, name: g.name, stage })));
  const allGahosSelected = metaGahos.length > 0 && draft.gahos.length === metaGahos.length;
  // 전체 선택: 모두 선택된 상태면 전부 해제, 아니면 전부(기본 단계) 선택
  const toggleAllGahos = () => (allGahosSelected ? set("gahos", []) : setAllGahos(0));
  // 선택한 가호 해금에 필요한 별빛 합계
  const gahoStarlight = useMemo(() => {
    const required = new Map(metaGahos.map((g) => [g.id, g.required_bonus_points]));
    return draft.gahos.reduce((sum, g) => sum + (required.get(g.gaho_id) ?? 0), 0);
  }, [draft.gahos, metaGahos]);

  // ── restrictions (EXTREME 전용) ───────────────────────────────
  const restrictionsByFloor = dungeonMeta?.restrictions_by_floor ?? {};
  const isExtreme = draft.difficulty_mode === "extreme";
  // EXTREME 콘텐츠(11~15층 팩 / 제약)는 EXTREME 모드이거나 목표 층수가 15층일 때 노출
  const showExtreme = isExtreme || targetDepth === 15;
  const toggleRestriction = (floor: string, name: string, score: number) => {
    const current = draft.restrictions[floor] ?? [];
    const exists = current.some((r) => r.name === name);
    const nextFloor = exists
      ? current.filter((r) => r.name !== name)
      : [...current, { name, score }];
    set("restrictions", { ...draft.restrictions, [floor]: nextFloor });
  };
  const restrictionScore = useMemo(
    () =>
      Object.values(draft.restrictions)
        .flat()
        .reduce((sum, r) => sum + r.score, 0),
    [draft.restrictions],
  );

  const handleSubmit = () => {
    if (!draft.name.trim()) return setError("루트 이름을 입력해 주세요.");
    if (draft.gift_order.some((g) => !g.gift_id)) return setError("기프트 목록에 비어 있는 항목이 있습니다.");
    if (draft.pack_order.some((p) => !p.pack_id)) return setError("팩 목록에 비어 있는 항목이 있습니다.");
    setError(null);
    // 키워드만 고르고 기프트는 안 골랐으면 미선택으로 처리
    const starting_gift =
      draft.starting_gift && draft.starting_gift.gifts.length > 0 ? draft.starting_gift : null;
    // EXTREME 콘텐츠가 아니면 제약은 저장하지 않는다
    const restrictions = showExtreme ? draft.restrictions : {};
    onSubmit({ ...draft, name: draft.name.trim(), starting_gift, restrictions }, selfReported);
  };

  return (
    <div className="space-y-5">
      {/* 이름 */}
      <div className="space-y-1.5">
        <Label>루트 이름 *</Label>
        <Input
          value={draft.name}
          placeholder="예: 혈귀덱 15층 풀제약"
          onChange={(e) => set("name", e.target.value)}
          maxLength={40}
        />
      </div>

      {/* 목표 층수 */}
      <div className="space-y-1.5">
        <Label>목표 층수 *</Label>
        <div className="flex flex-wrap gap-1.5">
          {TARGET_FLOORS.map((f) => {
            const active = targetDepth === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setDepth(f)}
                className={cn(
                  "h-9 rounded-md border px-4 text-sm transition-colors",
                  active
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40",
                )}
              >
                {f}층
              </button>
            );
          })}
        </div>
      </div>

      {/* 난이도 태그 / 유형 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>난이도 태그</Label>
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

      {/* 난이도 모드 */}
      <div className="space-y-1.5">
        <Label>난이도 모드</Label>
        <Select value={draft.difficulty_mode} onChange={(e) => setMode(e.target.value as DifficultyMode)}>
          {DIFFICULTY_MODES.map((m) => (
            <option key={m} value={m}>
              {DIFFICULTY_MODE_LABEL[m]}
            </option>
          ))}
        </Select>
      </div>

      {/* 하드 전환 층 (노말 모드에서만 활성) */}
      <div className="space-y-1.5">
        <Label className={cn(!switchEnabled && "text-muted-foreground/50")}>
          하드 전환 층 {switchEnabled ? "" : "(노말 모드에서만 선택 가능)"}
        </Label>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={!switchEnabled}
            onClick={() => set("difficulty_switch_floor", null)}
            className={cn(
              "h-9 rounded-md border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              draft.difficulty_switch_floor === null
                ? "border-primary bg-primary/20 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            단일 난이도
          </button>
          {SWITCH_FLOORS.map((f) => {
            const active = draft.difficulty_switch_floor === f;
            return (
              <button
                key={f}
                type="button"
                disabled={!switchEnabled}
                onClick={() => toggleSwitchFloor(f)}
                className={cn(
                  "h-9 w-11 rounded-md border text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  active
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40",
                )}
                title={`${f}층부터 하드`}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      {/* 시작 기프트 */}
      <div className="space-y-1.5">
        <Label>시작 기프트</Label>
        {startingGroups.length === 0 ? (
          <p className="text-xs text-muted-foreground">시즌 메타(dungeon_meta)를 불러오지 못해 선택할 수 없습니다.</p>
        ) : (
          <div className="space-y-2">
            <Select value={startingKeyword} onChange={(e) => setStartingKeyword(e.target.value)}>
              <option value="">키워드 선택 (없음)</option>
              {startingGroups.map((g) => (
                <option key={g.keyword_type} value={g.keyword_type}>
                  {g.keyword_type}
                </option>
              ))}
            </Select>
            {startingGroup && (
              <div className="flex flex-wrap gap-1.5">
                {startingGroup.gifts.map((g) => {
                  const active = selectedStartIds.has(g.gift_id);
                  return (
                    <button
                      key={g.gift_id}
                      type="button"
                      onClick={() => toggleStartingGift(g)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs transition-colors",
                        active
                          ? "border-primary bg-primary/20 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40",
                      )}
                    >
                      {active && <Check className="mr-1 inline size-3" />}
                      {g.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 목표 에고기프트 (순서 무관) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>목표 에고기프트</Label>
          <Button type="button" variant="outline" size="sm" onClick={() => setGiftPickerOpen(true)}>
            <Plus className="size-3.5" />
            기프트 추가
          </Button>
        </div>
        {draft.gift_order.length === 0 ? (
          <p className="text-xs text-muted-foreground">획득을 목표로 하는 기프트를 추가하세요 (순서 무관).</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {draft.gift_order.map((g) => {
              const gift = giftById.get(g.gift_id);
              return (
                <span
                  key={g.gift_id}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs"
                  style={gift?.keyword_color ? { borderColor: `${gift.keyword_color}66` } : undefined}
                >
                  {gift?.name ?? g.gift_id}
                  <button type="button" onClick={() => removeGift(g.gift_id)} title="제거">
                    <X className="size-3 text-muted-foreground hover:text-destructive" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* 팩 방문 (구간별) */}
      <div className="space-y-2">
        <Label>팩 방문</Label>
        <div className="space-y-2">
          {PACK_BUCKETS.map((bucket) => {
            // 11~15 구간은 EXTREME 모드이거나 목표 층수 15층일 때만 노출
            if (bucket.key === "11-15" && !showExtreme) return null;
            const items = packsByBucket[bucket.key] ?? [];
            const open = openPackBucket === bucket.key;
            // 이 구간의 실제 난이도 (난이도 모드 + 하드 전환 층 기준)
            const diff = difficultyAtFloor(bucket.floor, draft.difficulty_mode, draft.difficulty_switch_floor);
            return (
              <div key={bucket.key} className="rounded-md border border-border p-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {bucket.label}
                    {bucket.key !== "11-15" && (
                      <span className="ml-1.5 font-normal text-primary/80">· {DIFFICULTY_MODE_LABEL[diff]}</span>
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setOpenPackBucket(open ? null : bucket.key)}
                  >
                    <Plus className="size-3.5" />팩
                  </Button>
                </div>
                {open && (
                  <div className="mt-2">
                    <CatalogPicker
                      items={packPickerItems(bucket.key, diff)}
                      onPick={(id) => addPack(bucket, id, diff)}
                      placeholder={`${bucket.label} ${DIFFICULTY_MODE_LABEL[diff]} 팩 검색`}
                    />
                  </div>
                )}
                {items.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {items.map((p) => {
                      const pack = packById.get(p.pack_id);
                      // 현재 난이도 구성에서 이 팩이 등장하지 않으면 경고
                      const incompatible = pack ? !packEligible(pack, bucket.key, diff) : false;
                      return (
                        <div
                          key={p.pack_id}
                          className={cn(
                            "rounded-md border px-2 py-1.5",
                            incompatible
                              ? "border-destructive/60 bg-destructive/10"
                              : p.alternative
                                ? "border-dashed border-muted-foreground/40"
                                : "border-border bg-card",
                          )}
                        >
                          <div className="flex items-center gap-1.5 text-xs">
                            {incompatible && (
                              <span title={`${DIFFICULTY_MODE_LABEL[diff]} 난이도에서는 등장하지 않는 팩입니다.`}>
                                ⚠️
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => togglePackAlt(p.pack_id, p.floor)}
                              title={p.alternative ? "대체 팩 → 주력으로" : "주력 팩 → 대체로"}
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] transition-colors",
                                p.alternative
                                  ? "bg-muted text-muted-foreground hover:bg-muted/70"
                                  : "bg-primary/15 text-primary hover:bg-primary/25",
                              )}
                            >
                              {p.alternative ? "대체" : "주력"}
                            </button>
                            <span className={cn("flex-1", incompatible && "text-destructive")}>
                              {pack?.name ?? p.pack_id}
                            </span>
                            <button type="button" onClick={() => removePack(p.pack_id, p.floor)} title="제거">
                              <X className="size-3 text-muted-foreground hover:text-destructive" />
                            </button>
                          </div>
                          {p.alternative && (
                            <Input
                              value={p.memo ?? ""}
                              onChange={(e) => setPackMemo(p.pack_id, p.floor, e.target.value)}
                              placeholder="대체 조건 (예: 한겨울 밤의 악몽 기프트가 없으면 선택)"
                              className="mt-1.5 h-7 text-[11px]"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 별의 가호 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Label>별의 가호</Label>
            {draft.gahos.length > 0 && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-500">
                ✦ 필요 별빛 {gahoStarlight}
              </span>
            )}
          </div>
          {metaGahos.length > 0 && (
            <div className="flex gap-1.5">
              <Button type="button" variant="outline" size="sm" onClick={toggleAllGahos}>
                {allGahosSelected ? "전체 해제" : "전체 선택"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setAllGahos(1)}>
                전체 +
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setAllGahos(2)}>
                전체 ++
              </Button>
            </div>
          )}
        </div>
        {metaGahos.length === 0 ? (
          <p className="text-xs text-muted-foreground">시즌 메타(dungeon_meta)를 불러오지 못해 선택할 수 없습니다.</p>
        ) : (
          <div className="space-y-1.5">
            {metaGahos.map((meta) => {
              const stage = gahoStage(meta.id);
              const selected = stage !== null;
              return (
                <div
                  key={meta.id}
                  className={cn(
                    "rounded-md border p-2 transition-colors",
                    selected ? "border-primary/50 bg-primary/5" : "border-border",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => toggleGaho(meta)}
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                        selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
                      )}
                      title={selected ? "선택 해제" : "선택"}
                    >
                      {selected && <Check className="size-3" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{meta.name}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          별빛 {meta.required_bonus_points}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                        {meta.description}
                      </p>
                      {selected && (
                        <div className="mt-1.5 flex gap-1">
                          {STAGE_LABEL.map((label, s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setGahoStage(meta.id, s)}
                              className={cn(
                                "h-6 min-w-9 rounded border px-2 text-xs transition-colors",
                                stage === s
                                  ? "border-primary bg-primary/20 text-primary"
                                  : "border-border text-muted-foreground hover:border-primary/40",
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* EXTREME 제약 (extreme 모드이거나 목표 층수 15층일 때) */}
      {showExtreme && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>EXTREME 제약 (11~15층)</Label>
            <span className="text-xs text-muted-foreground">선택 점수 합계: {restrictionScore}</span>
          </div>
          {Object.keys(restrictionsByFloor).length === 0 ? (
            <p className="text-xs text-muted-foreground">시즌 메타(dungeon_meta)를 불러오지 못해 선택할 수 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {EXTREME_FLOORS.map((floor) => {
                const options = restrictionsByFloor[floor] ?? [];
                const selected = draft.restrictions[floor] ?? [];
                if (options.length === 0) return null;
                return (
                  <div key={floor} className="rounded-md border border-border p-2">
                    <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{floor}층</p>
                    <div className="space-y-1">
                      {options.map((opt) => (
                        <label key={opt.name} className="flex items-start gap-2 text-xs" title={opt.effect}>
                          <Checkbox
                            checked={selected.some((r) => r.name === opt.name)}
                            onChange={() => toggleRestriction(floor, opt.name, opt.score)}
                            className="mt-0.5"
                          />
                          <span>
                            {opt.name}{" "}
                            <span className="text-muted-foreground">({opt.score}점)</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 메모 */}
      <div className="space-y-1.5">
        <Label>자유 메모</Label>
        <Textarea
          value={draft.memo}
          placeholder="예: 3층부터 하드 전환. 심야청소 4층 필수."
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

      {/* 목표 에고기프트 추가 드로어 */}
      {giftPickerOpen && (
        <GiftPickerPanel
          gifts={gifts}
          selectedIds={giftIds}
          onToggle={toggleGift}
          onClose={() => setGiftPickerOpen(false)}
        />
      )}
    </div>
  );
}
