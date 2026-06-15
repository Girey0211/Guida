import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Plus, Save, X, Check, ChevronDown, ChevronUp, Copy, RotateCcw } from "lucide-react";
import {
  type SinnerIdentityState,
  encodeDeckCode,
  decodeDeckCode,
  createDefaultStates,
} from "@/lib/deckCode";
import type {
  DifficultyMode,
  DifficultyTag,
  PackOrderItem,
  RouteDraft,
  RouteRestrictions,
} from "@/types/route";
import type { DungeonMeta, Gift, Pack } from "@/types/gameData";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { GiftPickerPanel } from "@/components/route/GiftPickerPanel";
import { cn, getGiftColor } from "@/lib/utils";

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
  /** 상세 보기 모드 여부 */
  readOnly?: boolean;
}

const DIFFICULTIES: DifficultyTag[] = ["쉬움", "보통", "어려움"];
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
  if (switchFloor != null) {
    if (floor >= switchFloor) return "hard";
    return "normal";
  }
  if (mode === "hard" || mode === "extreme") return "hard";
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
  readOnly = false,
}: Props) {
  const [draft, setDraft] = useState<RouteDraft>(initial ?? EMPTY);
  const [selfReported, setSelfReported] = useState(initialSelfReported);
  const [error, setError] = useState<string | null>(null);
  const [giftPickerOpen, setGiftPickerOpen] = useState(false);
  const [giftsCardOpen, setGiftsCardOpen] = useState(false);
  const [openPackBucket, setOpenPackBucket] = useState<string | null>(null);
  const [sinnerStates, setSinnerStates] = useState<SinnerIdentityState[]>(createDefaultStates());
  const [activeSinnerId, setActiveSinnerId] = useState<string | null>(null);
  const [activeEgoPopoverSinnerId, setActiveEgoPopoverSinnerId] = useState<string | null>(null);
  const [deckInputCode, setDeckInputCode] = useState("");

  const { prisoners } = useAppStore();

  useEffect(() => {
    let isMounted = true;
    const loadDeck = async () => {
      if (prisoners.length === 0) return;
      const states = await decodeDeckCode(initial?.deck_code || "", prisoners);
      if (isMounted) {
        setSinnerStates(states);
        setDeckInputCode(initial?.deck_code || "");
      }
    };
    loadDeck();
    return () => { isMounted = false; };
  }, [initial?.deck_code, prisoners]);

  const updateSinnerState = async (updated: SinnerIdentityState) => {
    const nextStates = sinnerStates.map(s => s.sinnerId === updated.sinnerId ? updated : s);
    setSinnerStates(nextStates);
    const nextCode = await encodeDeckCode(nextStates, prisoners);
    set("deck_code", nextCode);
    setDeckInputCode(nextCode);
  };

  const handleImportDeckCode = async (code: string) => {
    if (!code || !code.trim() || prisoners.length === 0) return;
    const states = await decodeDeckCode(code, prisoners);
    setSinnerStates(states);
    const nextCode = await encodeDeckCode(states, prisoners);
    set("deck_code", nextCode);
    setDeckInputCode(nextCode);
  };

  const handleCopyDeckCode = () => {
    if (draft.deck_code) {
      navigator.clipboard.writeText(draft.deck_code);
    }
  };

  /** 우클릭: 편성 토글 (편성됨→취소, 미편성→마지막 번호로 편성) */
  const handleSinnerContextMenu = async (e: React.MouseEvent, sinnerId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const state = sinnerStates.find(s => s.sinnerId === sinnerId);
    if (!state) return;

    let nextStates: SinnerIdentityState[];
    if (state.order > 0) {
      // 편성 취소 후 나머지 번호 재정렬
      const removedOrder = state.order;
      nextStates = sinnerStates.map(s => {
        if (s.sinnerId === sinnerId) return { ...s, order: 0 };
        if (s.order > removedOrder) return { ...s, order: s.order - 1 };
        return s;
      });
    } else {
      // 마지막 번호로 편성
      const maxOrder = Math.max(0, ...sinnerStates.map(s => s.order));
      nextStates = sinnerStates.map(s =>
        s.sinnerId === sinnerId ? { ...s, order: maxOrder + 1 } : s
      );
    }
    setSinnerStates(nextStates);
    const nextCode = await encodeDeckCode(nextStates, prisoners);
    set("deck_code", nextCode);
    setDeckInputCode(nextCode);
  };

  /** 편성 초기화: 모든 수감자 편성 순서를 0으로 */
  const handleResetAllAssignments = async () => {
    const nextStates = sinnerStates.map(s => ({ ...s, order: 0 }));
    setSinnerStates(nextStates);
    const nextCode = await encodeDeckCode(nextStates, prisoners);
    set("deck_code", nextCode);
    setDeckInputCode(nextCode);
  };

  const set = <K extends keyof RouteDraft>(key: K, value: RouteDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const giftById = useMemo(() => new Map(gifts.map((g) => [g.id, g])), [gifts]);
  const packById = useMemo(() => new Map(packs.map((p) => [p.id, p])), [packs]);

  // ── 목표 층수 ─────────────────────────────────────────────────
  const targetDepth = draft.floors[0] ?? 5;
  const setDepth = (d: number) => {
    setDraft((dStore) => {
      let nextMode = dStore.difficulty_mode;
      if (d === 10) {
        nextMode = "hard";
      } else if (d === 15) {
        nextMode = "extreme";
      } else if (d === 5) {
        nextMode = "normal";
      }
      return {
        ...dStore,
        floors: [d],
        difficulty_mode: nextMode,
      };
    });
  };

  // ── 난이도 모드 / 하드 전환 층 ──────────────────────────────────
  const setMode = (mode: DifficultyMode) =>
    setDraft((d) => ({
      ...d,
      difficulty_mode: mode,
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
  const removeGift = (id: string) => {
    set(
      "gift_order",
      draft.gift_order.filter((g) => g.gift_id !== id).map((g, i) => ({ ...g, priority: i + 1 })),
    );
  };
  const toggleGift = (id: string) => (giftIds.has(id) ? removeGift(id) : addGift(id));
  const addGifts = (ids: string[]) => {
    setDraft((dStore) => {
      const currentIds = new Set(dStore.gift_order.map((g) => g.gift_id));
      const nextGifts = [...dStore.gift_order];
      let added = false;
      ids.forEach((id) => {
        if (!currentIds.has(id)) {
          nextGifts.push({
            gift_id: id,
            priority: nextGifts.length + 1,
            floor_target: dStore.floors[0] ?? 5,
            difficulty: dStore.difficulty_mode,
            required: true,
          });
          added = true;
        }
      });
      if (!added) return dStore;
      return {
        ...dStore,
        gift_order: nextGifts,
      };
    });
  };
  const removeGifts = (ids: string[]) => {
    setDraft((dStore) => {
      const idSet = new Set(ids);
      const nextGifts = dStore.gift_order
        .filter((g) => !idSet.has(g.gift_id))
        .map((g, i) => ({ ...g, priority: i + 1 }));
      return {
        ...dStore,
        gift_order: nextGifts,
      };
    });
  };



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

  const selectAllRestrictions = () => {
    const next: RouteRestrictions = {};
    for (const floor of EXTREME_FLOORS) {
      const options = restrictionsByFloor[floor] ?? [];
      next[floor] = options.map((opt) => ({ name: opt.name, score: opt.score }));
    }
    set("restrictions", next);
  };

  const clearAllRestrictions = () => {
    set("restrictions", {});
  };

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

    // 기프트들의 목표 층 및 실제 난이도 정합성 보정
    const actualDiff = difficultyAtFloor(targetDepth, draft.difficulty_mode, draft.difficulty_switch_floor);
    const sanitizedGiftOrder = draft.gift_order.map((g) => ({
      ...g,
      floor_target: targetDepth,
      difficulty: actualDiff,
    }));

    onSubmit(
      {
        ...draft,
        name: draft.name.trim(),
        gift_order: sanitizedGiftOrder,
        starting_gift,
        restrictions,
      },
      selfReported,
    );
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
          disabled={readOnly}
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
                disabled={readOnly}
                className={cn(
                  "h-9 rounded-md border px-4 text-sm transition-colors",
                  active
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40",
                  readOnly && "cursor-default opacity-80"
                )}
              >
                {f}층
              </button>
            );
          })}
        </div>
      </div>

      {/* 루트 난이도 태그 */}
      <div className="space-y-1.5">
        <Label>루트 난이도</Label>
        <Select value={draft.difficulty_tag} onChange={(e) => set("difficulty_tag", e.target.value as DifficultyTag)} disabled={readOnly}>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
      </div>

      {/* 난이도 모드 */}
      <div className="space-y-1.5">
        <Label>난이도 모드</Label>
        <Select value={draft.difficulty_mode} onChange={(e) => setMode(e.target.value as DifficultyMode)} disabled={readOnly}>
          {DIFFICULTY_MODES.map((m) => (
            <option key={m} value={m}>
              {DIFFICULTY_MODE_LABEL[m]}
            </option>
          ))}
        </Select>
      </div>

      {/* 하드 전환 층 */}
      <div className="space-y-1.5">
        <Label>하드 전환 층</Label>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => set("difficulty_switch_floor", null)}
            disabled={readOnly}
            className={cn(
              "h-9 rounded-md border px-3 text-sm transition-colors",
              draft.difficulty_switch_floor === null
                ? "border-primary bg-primary/20 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40",
              readOnly && "cursor-default opacity-80"
            )}
          >
            {draft.difficulty_mode === "normal" ? "단일 난이도" : "전체 하드"}
          </button>
          {SWITCH_FLOORS.map((f) => {
            const active = draft.difficulty_switch_floor === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => toggleSwitchFloor(f)}
                disabled={readOnly}
                className={cn(
                  "h-9 w-11 rounded-md border text-sm transition-colors",
                  active
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40",
                  readOnly && "cursor-default opacity-80"
                )}
                title={`${f}층부터 하드`}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      {/* 수감자 편성 (덱 코드 호환) */}
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <Label className="text-sm font-semibold">수감자 전투 편성 (덱 코드)</Label>
            <span className="text-[11px] text-muted-foreground">
              {readOnly ? "좌클릭: 상세 정보" : "좌클릭: 상세 편집 / 우클릭: 편성 토글"}
            </span>
          </div>
          <div className="flex gap-2">
            {!readOnly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetAllAssignments}
                className="h-8 text-xs gap-1"
              >
                <RotateCcw className="size-3" />
                편성 초기화
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyDeckCode}
              disabled={!draft.deck_code}
              className="h-8 text-xs gap-1"
            >
              <Copy className="size-3" />
              코드 복사
            </Button>
          </div>
        </div>

        {/* 덱 코드 텍스트 및 불러오기 버튼 */}
        {!readOnly && (
          <div className="flex gap-2">
            <Input
              value={deckInputCode}
              onChange={(e) => setDeckInputCode(e.target.value)}
              placeholder="림버스 컴퍼니 덱 코드를 여기에 입력하세요 (예: H4sIAAAA...)"
              className="h-8 text-xs font-mono"
            />
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => handleImportDeckCode(deckInputCode)}
              className="h-8 text-xs"
            >
              불러오기
            </Button>
          </div>
        )}

        {/* 12인 수감자 2x6 그리드 */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {sinnerStates.map((state) => {
            const sinnerMeta = prisoners.find(p => p.sinner_id === state.sinnerId);
            const selectedIden = sinnerMeta?.identities.find(id => id.code_index === state.identityCodeIndex);
            
            // 장착 에고 요약 및 개수 세기
            let egoCount = 0;
            const activeEgoNames: string[] = [];
            if (sinnerMeta) {
              const zayinEgo = sinnerMeta.egos.find(e => e.grade === "ZAYIN" && e.code_index === state.egoZayinCodeIndex);
              if (zayinEgo) {
                egoCount++;
                activeEgoNames.push(`ZAYIN: ${zayinEgo.name}`);
              }
              
              const tethEgo = sinnerMeta.egos.find(e => e.grade === "TETH" && e.code_index === state.egoTethCodeIndex);
              if (tethEgo) {
                egoCount++;
                activeEgoNames.push(`TETH: ${tethEgo.name}`);
              }
              
              const heEgo = sinnerMeta.egos.find(e => e.grade === "HE" && e.code_index === state.egoHeCodeIndex);
              if (heEgo) {
                egoCount++;
                activeEgoNames.push(`HE: ${heEgo.name}`);
              }
              
              const wawEgo = sinnerMeta.egos.find(e => e.grade === "WAW" && e.code_index === state.egoWawCodeIndex);
              if (wawEgo) {
                egoCount++;
                activeEgoNames.push(`WAW: ${wawEgo.name}`);
              }
            }

            return (
              <div
                key={state.sinnerId}
                onClick={() => setActiveSinnerId(state.sinnerId)}
                onContextMenu={readOnly ? (e) => e.preventDefault() : (e) => handleSinnerContextMenu(e, state.sinnerId)}
                title={readOnly ? `${activeEgoNames.length > 0 ? `장착 에고:\n- ${activeEgoNames.join("\n- ")}` : "장착된 에고 없음"}` : `${activeEgoNames.length > 0 ? `장착 에고:\n- ${activeEgoNames.join("\n- ")}` : "장착된 에고 없음"}\n\n우클릭: ${state.order > 0 ? "편성 취소" : "편성 추가"}`}
                className={cn(
                  "relative flex flex-col justify-between rounded-md border p-2.5 cursor-pointer transition-all hover:bg-primary/5 hover:border-primary/40 min-h-[105px]",
                  state.order > 0
                    ? "border-primary bg-primary/5 shadow-inner"
                    : "border-border bg-muted/10",
                  activeEgoPopoverSinnerId === state.sinnerId ? "z-30" : "z-10"
                )}
              >
                {/* 편성 번호 뱃지 */}
                {state.order > 0 && (
                  <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shadow-sm">
                    {state.order}
                  </span>
                )}

                <div className="space-y-1">
                  {/* 수감자 이름 */}
                  <span className="text-xs font-bold block text-foreground">
                    {sinnerMeta?.name || state.sinnerId}
                  </span>
                  
                  {/* 선택된 인격 */}
                  <span className={cn(
                    "text-[10px] font-medium leading-tight block line-clamp-2",
                    selectedIden
                      ? "text-primary"
                      : "text-muted-foreground"
                  )}>
                    {selectedIden?.name || "기본 LCB 수감자"}
                  </span>
                </div>

                {/* 장착 에고 개수 요약 */}
                <div className="mt-2 space-y-0.5 border-t border-border/40 pt-1.5 flex items-center justify-between relative">
                  <span className="text-[9px] text-muted-foreground">
                    장착 E.G.O
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveEgoPopoverSinnerId(
                        activeEgoPopoverSinnerId === state.sinnerId ? null : state.sinnerId
                      );
                    }}
                    className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary hover:bg-primary/20 transition-colors cursor-pointer select-none"
                  >
                    {egoCount}개
                  </button>
                  
                  {/* 에고 목록 팝업 */}
                  {activeEgoPopoverSinnerId === state.sinnerId && (
                    <div 
                      onClick={(e) => e.stopPropagation()}
                      className="absolute bottom-6 right-0 z-30 w-48 rounded-md border border-border bg-card p-2 shadow-lg backdrop-blur-sm bg-card/95 text-left animate-in fade-in slide-in-from-bottom-1 duration-150"
                    >
                      <div className="flex items-center justify-between border-b border-border/40 pb-1 mb-1">
                        <span className="text-[9px] font-bold text-muted-foreground">장착 E.G.O 리스트</span>
                        <button 
                          type="button" 
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveEgoPopoverSinnerId(null);
                          }}
                          className="text-muted-foreground hover:text-foreground text-[8px]"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="space-y-1 max-h-36 overflow-y-auto">
                        {activeEgoNames.length > 0 ? (
                          activeEgoNames.map((name, index) => (
                            <p key={index} className="text-[9px] text-foreground truncate pl-1 border-l border-primary/40 leading-relaxed font-medium">
                              {name}
                            </p>
                          ))
                        ) : (
                          <p className="text-[9px] text-muted-foreground text-center py-1">장착된 에고가 없습니다.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 수감자 개별 편성 설정 드로어 (우측 창) */}
      {activeSinnerId && (() => {
        const sinnerState = sinnerStates.find(s => s.sinnerId === activeSinnerId);
        const sinnerMeta = prisoners.find(p => p.sinner_id === activeSinnerId);
        if (!sinnerState || !sinnerMeta) return null;

        // 장착 에고 요약 생성
        const activeEgoNames: string[] = [];
        const zayinEgo = sinnerMeta.egos.find(e => e.grade === "ZAYIN" && e.code_index === sinnerState.egoZayinCodeIndex);
        if (zayinEgo) activeEgoNames.push(`[ZAYIN] ${zayinEgo.name}`);
        const tethEgo = sinnerMeta.egos.find(e => e.grade === "TETH" && e.code_index === sinnerState.egoTethCodeIndex);
        if (tethEgo) activeEgoNames.push(`[TETH] ${tethEgo.name}`);
        const heEgo = sinnerMeta.egos.find(e => e.grade === "HE" && e.code_index === sinnerState.egoHeCodeIndex);
        if (heEgo) activeEgoNames.push(`[HE] ${heEgo.name}`);
        const wawEgo = sinnerMeta.egos.find(e => e.grade === "WAW" && e.code_index === sinnerState.egoWawCodeIndex);
        if (wawEgo) activeEgoNames.push(`[WAW] ${wawEgo.name}`);

        return createPortal(
          <>
            {/* 백드롭 */}
            <div 
              className="fixed inset-0 z-40 bg-black/40" 
              onClick={() => setActiveSinnerId(null)} 
              aria-hidden 
            />
            
            {/* 우측 드로어 */}
            <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-xl animate-in slide-in-from-right duration-200">
              {/* 헤더 */}
              <div className="flex items-center justify-between border-b border-border p-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <span>{sinnerMeta.name} {readOnly ? "상세 정보" : "편성 설정"}</span>
                    {sinnerState.order > 0 && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                        {sinnerState.order}번 편성
                      </span>
                    )}
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {readOnly ? "선택된 인격과 등급별 E.G.O 장착 정보를 조회합니다." : "인격과 등급별 E.G.O 장착 상태를 우측 패널에서 간편하게 구성합니다."}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setActiveSinnerId(null)} className="h-8 gap-1 text-xs">
                  <X className="size-4" />
                  닫기
                </Button>
              </div>

              {/* 본문 바디 (스크롤 가능) */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* 1. 현재 장착 현황 요약 */}
                <div className="rounded-md bg-muted/20 border border-border/40 p-3 space-y-2">
                  <span className="text-[10px] font-bold text-muted-foreground block uppercase">현재 장착 정보</span>
                  <div className="space-y-1 text-xs">
                    <p className="text-foreground">
                      <span className="text-muted-foreground">인격:</span>{" "}
                      <span className="font-semibold text-primary">
                        {sinnerMeta.identities.find(id => id.code_index === sinnerState.identityCodeIndex)?.name || "LCB 수감자"}
                      </span>
                    </p>
                    {activeEgoNames.length > 0 ? (
                      <div className="space-y-0.5 mt-1">
                        <span className="text-muted-foreground text-[11px] block">장착 E.G.O:</span>
                        {activeEgoNames.map((name, index) => (
                          <p key={index} className="text-[11px] font-medium text-foreground pl-2 border-l border-border">
                            {name}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-[11px]">장착된 에고 없음</p>
                    )}
                  </div>
                </div>

                {/* 2. 편성 파티 순서 */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">편성 파티 순서</Label>
                  <Select
                    value={sinnerState.order}
                    onChange={(e) => updateSinnerState({ ...sinnerState, order: Number(e.target.value) })}
                    disabled={readOnly}
                    className="h-8 text-xs text-foreground bg-background"
                  >
                    <option value={0}>미편성 (대기)</option>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((idx) => (
                      <option key={idx} value={idx}>
                        {idx}번 전투 편성
                      </option>
                    ))}
                  </Select>
                </div>

                {/* 3. 인격 장착 (하나만 장착 가능) */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">장착 인격 선택 (하나만 장착 가능)</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {sinnerMeta.identities.map((iden) => {
                      const active = iden.code_index === sinnerState.identityCodeIndex;
                      return (
                        <button
                          key={iden.identity_id}
                          type="button"
                          onClick={readOnly ? undefined : () => updateSinnerState({ ...sinnerState, identityCodeIndex: iden.code_index })}
                          disabled={readOnly}
                          className={cn(
                            "relative flex flex-col rounded-md border p-2 text-left transition-all text-xs select-none",
                            active
                              ? "border-primary bg-primary/10 text-primary shadow-inner font-semibold"
                              : "border-border hover:bg-muted/40 text-foreground",
                            readOnly && active && "opacity-90",
                            readOnly && !active && "opacity-50 cursor-default hover:bg-transparent"
                          )}
                        >
                          <div className="flex items-center justify-between gap-1 w-full">
                            <span className="font-semibold truncate pr-3">{iden.name}</span>
                            <span className={cn(
                              "px-1 rounded text-[9px] shrink-0",
                              iden.rarity === "000" ? "bg-amber-500/10 text-amber-500 border border-amber-500/20" :
                              iden.rarity === "00" ? "bg-red-500/10 text-red-500 border border-red-500/20" :
                              "bg-green-500/10 text-green-500 border border-green-500/20"
                            )}>
                              {iden.rarity === "0" ? "0" : iden.rarity}
                            </span>
                          </div>
                          {iden.release_date && (
                            <span className="text-[9px] text-muted-foreground mt-1">출시일: {iden.release_date}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 4. 에고 장착 (등급별 하나씩) */}
                <div className="space-y-3 pt-2 border-t border-border/40">
                  <Label className="text-xs font-semibold">장착 E.G.O 선택 (등급별 하나씩)</Label>
                  
                  {/* ZAYIN (필수) */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-muted-foreground font-mono block">ZAYIN E.G.O (필수)</span>
                    <div className="flex flex-col gap-1">
                      {sinnerMeta.egos.filter(e => e.grade === "ZAYIN").map(ego => {
                        const active = ego.code_index === sinnerState.egoZayinCodeIndex;
                        return (
                          <button
                            key={ego.ego_id}
                            type="button"
                            onClick={readOnly ? undefined : () => updateSinnerState({ ...sinnerState, egoZayinCodeIndex: ego.code_index })}
                            disabled={readOnly}
                            className={cn(
                              "flex items-center justify-between rounded-md border p-2 text-left text-xs",
                              active
                                ? "border-primary bg-primary/10 text-primary font-semibold"
                                : "border-border hover:bg-muted/40 text-foreground",
                              readOnly && active && "opacity-90",
                              readOnly && !active && "opacity-50 cursor-default hover:bg-transparent"
                            )}
                          >
                            <span>{ego.name}</span>
                            {active && <Check className="size-3.5 text-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* TETH */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-muted-foreground font-mono block">TETH E.G.O</span>
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={readOnly ? undefined : () => updateSinnerState({ ...sinnerState, egoTethCodeIndex: 0 })}
                        disabled={readOnly}
                        className={cn(
                          "flex items-center justify-between rounded-md border p-2 text-left text-xs",
                          sinnerState.egoTethCodeIndex === 0
                            ? "border-primary bg-primary/10 text-primary font-semibold"
                            : "border-border hover:bg-muted/40 text-foreground",
                          readOnly && sinnerState.egoTethCodeIndex === 0 && "opacity-90",
                          readOnly && sinnerState.egoTethCodeIndex !== 0 && "opacity-50 cursor-default hover:bg-transparent"
                        )}
                      >
                        <span className="text-muted-foreground">미장착 (없음)</span>
                        {sinnerState.egoTethCodeIndex === 0 && <Check className="size-3.5 text-primary" />}
                      </button>
                      {sinnerMeta.egos.filter(e => e.grade === "TETH").map(ego => {
                        const active = ego.code_index === sinnerState.egoTethCodeIndex;
                        return (
                          <button
                            key={ego.ego_id}
                            type="button"
                            onClick={readOnly ? undefined : () => updateSinnerState({ ...sinnerState, egoTethCodeIndex: ego.code_index })}
                            disabled={readOnly}
                            className={cn(
                              "flex items-center justify-between rounded-md border p-2 text-left text-xs",
                              active
                                ? "border-primary bg-primary/10 text-primary font-semibold"
                                : "border-border hover:bg-muted/40 text-foreground",
                              readOnly && active && "opacity-90",
                              readOnly && !active && "opacity-50 cursor-default hover:bg-transparent"
                            )}
                          >
                            <span>{ego.name}</span>
                            {active && <Check className="size-3.5 text-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* HE */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-muted-foreground font-mono block">HE E.G.O</span>
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={readOnly ? undefined : () => updateSinnerState({ ...sinnerState, egoHeCodeIndex: 0 })}
                        disabled={readOnly}
                        className={cn(
                          "flex items-center justify-between rounded-md border p-2 text-left text-xs",
                          sinnerState.egoHeCodeIndex === 0
                            ? "border-primary bg-primary/10 text-primary font-semibold"
                            : "border-border hover:bg-muted/40 text-foreground",
                          readOnly && sinnerState.egoHeCodeIndex === 0 && "opacity-90",
                          readOnly && sinnerState.egoHeCodeIndex !== 0 && "opacity-50 cursor-default hover:bg-transparent"
                        )}
                      >
                        <span className="text-muted-foreground">미장착 (없음)</span>
                        {sinnerState.egoHeCodeIndex === 0 && <Check className="size-3.5 text-primary" />}
                      </button>
                      {sinnerMeta.egos.filter(e => e.grade === "HE").map(ego => {
                        const active = ego.code_index === sinnerState.egoHeCodeIndex;
                        return (
                          <button
                            key={ego.ego_id}
                            type="button"
                            onClick={readOnly ? undefined : () => updateSinnerState({ ...sinnerState, egoHeCodeIndex: ego.code_index })}
                            disabled={readOnly}
                            className={cn(
                              "flex items-center justify-between rounded-md border p-2 text-left text-xs",
                              active
                                ? "border-primary bg-primary/10 text-primary font-semibold"
                                : "border-border hover:bg-muted/40 text-foreground",
                              readOnly && active && "opacity-90",
                              readOnly && !active && "opacity-50 cursor-default hover:bg-transparent"
                            )}
                          >
                            <span>{ego.name}</span>
                            {active && <Check className="size-3.5 text-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* WAW */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-muted-foreground font-mono block">WAW E.G.O</span>
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={readOnly ? undefined : () => updateSinnerState({ ...sinnerState, egoWawCodeIndex: 0 })}
                        disabled={readOnly}
                        className={cn(
                          "flex items-center justify-between rounded-md border p-2 text-left text-xs",
                          sinnerState.egoWawCodeIndex === 0
                            ? "border-primary bg-primary/10 text-primary font-semibold"
                            : "border-border hover:bg-muted/40 text-foreground",
                          readOnly && sinnerState.egoWawCodeIndex === 0 && "opacity-90",
                          readOnly && sinnerState.egoWawCodeIndex !== 0 && "opacity-50 cursor-default hover:bg-transparent"
                        )}
                      >
                        <span className="text-muted-foreground">미장착 (없음)</span>
                        {sinnerState.egoWawCodeIndex === 0 && <Check className="size-3.5 text-primary" />}
                      </button>
                      {sinnerMeta.egos.filter(e => e.grade === "WAW").map(ego => {
                        const active = ego.code_index === sinnerState.egoWawCodeIndex;
                        return (
                          <button
                            key={ego.ego_id}
                            type="button"
                            onClick={readOnly ? undefined : () => updateSinnerState({ ...sinnerState, egoWawCodeIndex: ego.code_index })}
                            disabled={readOnly}
                            className={cn(
                              "flex items-center justify-between rounded-md border p-2 text-left text-xs",
                              active
                                ? "border-primary bg-primary/10 text-primary font-semibold"
                                : "border-border hover:bg-muted/40 text-foreground",
                              readOnly && active && "opacity-90",
                              readOnly && !active && "opacity-50 cursor-default hover:bg-transparent"
                            )}
                          >
                            <span>{ego.name}</span>
                            {active && <Check className="size-3.5 text-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          </>,
          document.body
        );
      })()}

      {/* 시작 기프트 */}
      <div className="space-y-1.5">
        <Label>시작 기프트</Label>
        {startingGroups.length === 0 ? (
          <p className="text-xs text-muted-foreground">시즌 메타(dungeon_meta)를 불러오지 못해 선택할 수 없습니다.</p>
        ) : (
          <div className="space-y-2">
            <Select value={startingKeyword} onChange={(e) => setStartingKeyword(e.target.value)} disabled={readOnly}>
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
                      onClick={readOnly ? undefined : () => toggleStartingGift(g)}
                      disabled={readOnly}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs transition-colors",
                        active
                          ? "border-primary bg-primary/20 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40",
                        readOnly && active && "opacity-90",
                        readOnly && !active && "opacity-50 cursor-default hover:bg-transparent"
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
      <div className="rounded-lg border border-border bg-card shadow-sm">
        <div 
          className="flex cursor-pointer items-center justify-between p-4"
          onClick={() => setGiftsCardOpen(!giftsCardOpen)}
        >
          <div className="flex items-center gap-2">
            <Label className="text-sm font-semibold cursor-pointer">목표 에고기프트</Label>
            {draft.gift_order.length > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                선택 {draft.gift_order.length}개
              </span>
            )}
          </div>
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {!readOnly && (
              <Button type="button" variant="outline" size="sm" onClick={() => setGiftPickerOpen(true)}>
                <Plus className="size-3.5" />
                기프트 추가
              </Button>
            )}
            <button
              type="button"
              className="p-1 hover:bg-muted rounded text-muted-foreground flex items-center justify-center transition-colors"
              onClick={() => setGiftsCardOpen(!giftsCardOpen)}
            >
              {giftsCardOpen ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </button>
          </div>
        </div>
        {giftsCardOpen && (
          <div className="border-t border-border p-4">
            {draft.gift_order.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">획득을 목표로 하는 기프트를 추가하세요 (순서 무관).</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {draft.gift_order.map((g) => {
                  const gift = giftById.get(g.gift_id);
                  const attributeColor = getGiftColor(gift?.keyword_type);
                  return (
                    <div
                      key={g.gift_id}
                      className="group relative flex flex-col overflow-hidden rounded-md border border-border bg-muted/20 hover:border-primary/40 transition-colors"
                    >
                      {/* Placeholder Image (Solid Box of attribute color) */}
                      <div 
                        className="h-16 w-full flex items-center justify-center text-[10px] font-bold text-white/90 shadow-inner"
                        style={{ backgroundColor: attributeColor }}
                      >
                        {gift?.keyword_type || "일반"}
                      </div>
                      {/* Gift name & grade */}
                      <div className="flex flex-col p-1.5 min-h-[48px] justify-between">
                        <span className="text-[11px] font-medium line-clamp-2 leading-tight text-foreground" title={gift?.name ?? g.gift_id}>
                          {gift?.name ?? g.gift_id}
                        </span>
                        {gift?.grade && (
                          <span className="text-[9px] text-muted-foreground mt-0.5">
                            {gift.grade}등급
                          </span>
                        )}
                      </div>
                      {/* Remove Button */}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => removeGift(g.gift_id)}
                          title="제거"
                          className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-destructive hover:scale-105 transition-all"
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>



      {/* 방문 팩 (구간별) */}
      <div className="space-y-2">
        <Label>방문 팩</Label>
        <div className="space-y-2">
          {PACK_BUCKETS.map((bucket) => {
            // 11~15 구간은 EXTREME 모드이거나 목표 층수 15층일 때만 노출
            if (bucket.key === "11-15" && !showExtreme) return null;
            const items = packsByBucket[bucket.key] ?? [];
            const open = openPackBucket === bucket.key;
            // 이 구간의 실제 난이도 (난이도 모드 + 하드 전환 층 기준)
            const diff = difficultyAtFloor(bucket.floor, draft.difficulty_mode, draft.difficulty_switch_floor);
            const displayLabel = bucket.key === "5-10" && targetDepth === 5 ? "5층" : bucket.label;
            return (
              <div key={bucket.key} className="rounded-md border border-border p-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {displayLabel}
                    {bucket.key !== "11-15" && (
                      <span className="ml-1.5 font-normal text-primary/80">· {DIFFICULTY_MODE_LABEL[diff]}</span>
                    )}
                  </span>
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenPackBucket(open ? null : bucket.key)}
                    >
                      <Plus className="size-3.5" />팩
                    </Button>
                  )}
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
                              onClick={readOnly ? undefined : () => togglePackAlt(p.pack_id, p.floor)}
                              disabled={readOnly}
                              title={p.alternative ? "대체 팩 → 주력으로" : "주력 팩 → 대체로"}
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] transition-colors",
                                p.alternative
                                  ? "bg-muted text-muted-foreground hover:bg-muted/70"
                                  : "bg-primary/15 text-primary hover:bg-primary/25",
                                readOnly && "cursor-default opacity-80"
                              )}
                            >
                              {p.alternative ? "대체" : "주력"}
                            </button>
                            <span className={cn("flex-1", incompatible && "text-destructive")}>
                              {pack?.name ?? p.pack_id}
                            </span>
                            {!readOnly && (
                              <button type="button" onClick={() => removePack(p.pack_id, p.floor)} title="제거">
                                <X className="size-3 text-muted-foreground hover:text-destructive" />
                              </button>
                            )}
                          </div>
                          {p.alternative && (
                            <Input
                              value={p.memo ?? ""}
                              onChange={(e) => setPackMemo(p.pack_id, p.floor, e.target.value)}
                              placeholder="대체 조건 (예: 한겨울 밤의 악몽 기프트가 없으면 선택)"
                              className="mt-1.5 h-7 text-[11px]"
                              disabled={readOnly}
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
          {!readOnly && metaGahos.length > 0 && (
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
                      onClick={readOnly ? undefined : () => toggleGaho(meta)}
                      disabled={readOnly}
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                        selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
                        readOnly && selected && "opacity-90",
                        readOnly && !selected && "opacity-50 cursor-default"
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
                              onClick={readOnly ? undefined : () => setGahoStage(meta.id, s)}
                              disabled={readOnly}
                              className={cn(
                                "h-6 min-w-9 rounded border px-2 text-xs transition-colors",
                                stage === s
                                  ? "border-primary bg-primary/20 text-primary"
                                  : "border-border text-muted-foreground hover:border-primary/40",
                                readOnly && stage === s && "opacity-90",
                                readOnly && stage !== s && "opacity-50 cursor-default"
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
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground mr-1">선택 점수 합계: {restrictionScore}</span>
              {!readOnly && (
                <>
                  <Button type="button" variant="outline" size="sm" onClick={selectAllRestrictions} className="h-7 px-2 text-[11px]">
                    전체 선택
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={clearAllRestrictions} className="h-7 px-2 text-[11px]">
                    전체 해제
                  </Button>
                </>
              )}
            </div>
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
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="text-xs font-semibold text-muted-foreground">{floor}층</p>
                      {!readOnly && (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const options = restrictionsByFloor[floor] ?? [];
                              set("restrictions", {
                                ...draft.restrictions,
                                [floor]: options.map((opt) => ({ name: opt.name, score: opt.score })),
                              });
                            }}
                            className="rounded px-1.5 py-0.5 text-[10px] bg-muted hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors font-medium"
                          >
                            전체 선택
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              set("restrictions", {
                                ...draft.restrictions,
                                [floor]: [],
                              });
                            }}
                            className="rounded px-1.5 py-0.5 text-[10px] bg-muted hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors font-medium"
                          >
                            전체 해제
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1">
                      {options.map((opt) => (
                        <label key={opt.name} className="flex items-start gap-2 text-xs" title={opt.effect}>
                          <Checkbox
                            checked={selected.some((r) => r.name === opt.name)}
                            onChange={readOnly ? undefined : () => toggleRestriction(floor, opt.name, opt.score)}
                            disabled={readOnly}
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
          disabled={readOnly}
        />
      </div>

      {/* 자기 신고 (Phase 1 검증) */}
      <label className="flex items-start gap-2.5 rounded-md border border-border bg-muted/30 p-3">
        <Checkbox checked={selfReported} onChange={readOnly ? undefined : (e) => setSelfReported(e.target.checked)} disabled={readOnly} className="mt-0.5" />
        <span className="text-sm">
          <b>실제로 이 루트로 플레이했습니다.</b>
          <span className="block text-xs text-muted-foreground">
            Phase 1에서는 자기 신고 방식으로 검증됩니다. 체크해야 공유(코드 발급)가 가능합니다.
          </span>
        </span>
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        {readOnly ? (
          <Button onClick={onCancel}>
            <Check className="size-4" />
            닫기
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onCancel}>
              <X className="size-4" />
              취소
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              <Save className="size-4" />
              저장
            </Button>
          </>
        )}
      </div>

      {/* 목표 에고기프트 추가 드로어 */}
      {giftPickerOpen && (
        <GiftPickerPanel
          gifts={gifts}
          selectedIds={giftIds}
          onToggle={toggleGift}
          onSelectMultiple={addGifts}
          onDeselectMultiple={removeGifts}
          onClose={() => setGiftPickerOpen(false)}
        />
      )}
    </div>
  );
}
