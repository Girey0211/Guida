import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Pack, Gift } from "@/types/gameData";

/** Tailwind 클래스 병합 (shadcn/ui 표준 헬퍼) */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * gift_id → pack_id[] 매핑을 만든다.
 * gifts.json 의 pack_id 필드는 비어 있고, 실제 전용 관계는
 * packs.json 의 exclusive_gifts(테마팩별 한정 에고기프트 목록)에 들어 있다.
 * 테마팩 전용 필터에서 어떤 기프트가 어느 테마팩 소속인지 알아내는 데 쓴다.
 * 조합 기프트의 경우 하위 재료의 전용 테마팩 제한을 재귀적으로 모아 결합한다.
 */
export function buildGiftPackMap(packs: Pack[], gifts?: Gift[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  packs.forEach((p) => {
    p.exclusive_gifts?.forEach((eg) => {
      if (eg.gift_id) {
        const existing = map.get(eg.gift_id) ?? [];
        if (!existing.includes(p.id)) {
          map.set(eg.gift_id, [...existing, p.id]);
        }
      }
    });
  });

  if (gifts && gifts.length > 0) {
    const giftMap = new Map<string, Gift>(gifts.map((g) => [g.id, g]));
    const memo = new Map<string, string[]>();

    const getPacksForGift = (giftId: string, visited = new Set<string>()): string[] => {
      if (memo.has(giftId)) return memo.get(giftId)!;
      if (visited.has(giftId)) return [];
      visited.add(giftId);

      const gift = giftMap.get(giftId);
      if (!gift) return [];

      let packIds = map.get(giftId) ? [...(map.get(giftId) ?? [])] : [];

      if (gift.is_craftable && gift.craft_recipe) {
        const recipe = gift.craft_recipe;
        const subIds = new Set<string>();

        if (recipe.type === "simple") {
          recipe.required?.forEach((id) => subIds.add(id));
        } else if (recipe.type === "multi_path") {
          recipe.paths?.flat().forEach((id) => subIds.add(id));
        } else if (recipe.type === "required_and_pick") {
          recipe.required?.forEach((id) => subIds.add(id));
          recipe.pick?.from.forEach((id) => subIds.add(id));
        }

        subIds.forEach((subId) => {
          const subPacks = getPacksForGift(subId, visited);
          subPacks.forEach((pId) => {
            if (!packIds.includes(pId)) {
              packIds.push(pId);
            }
          });
        });
      }

      memo.set(giftId, packIds);
      return packIds;
    };

    gifts.forEach((g) => {
      const packsForGift = getPacksForGift(g.id);
      if (packsForGift.length > 0) {
        map.set(g.id, packsForGift);
      }
    });
  }

  return map;
}

/** 6자리 영숫자 난수 코드 생성 (예: X7R2B9). 혼동 문자(0/O,1/I) 제외 */
export function generateShareCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

/** 로컬 루트 ID 생성 */
export function generateLocalId(): string {
  return `route_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 브라우저 환경용 UUID v4 폴백 생성기 */
export function generateUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // 매우 오래된 환경용 폴백
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** ISO 날짜를 'YYYY-MM-DD' 형태로 간단 포맷 */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

/** 두 패치 버전(예: "1.107.0", "1.106.0", 또는 "2.4", "2.2")의 차이를 반환 (a - b) */
export function patchDiff(a: string, b: string): number {
  const parseSemverPatch = (v: string): { major: number; minor: number; patch: number } | null => {
    const parts = v.split(".").map((x) => parseInt(x, 10));
    if (parts.length >= 2 && parts.every((x) => !isNaN(x))) {
      return {
        major: parts[0],
        minor: parts[1],
        patch: parts[2] ?? 0,
      };
    }
    return null;
  };

  const sa = parseSemverPatch(a);
  const sb = parseSemverPatch(b);

  if (sa && sb) {
    if (sa.major !== sb.major) {
      return (sa.major - sb.major) * 100 + (sa.minor - sb.minor);
    }
    return sa.minor - sb.minor;
  }

  const pa = parseFloat(a);
  const pb = parseFloat(b);
  if (Number.isNaN(pa) || Number.isNaN(pb)) return 0;
  // 0.1 단위 패치를 정수 거리로 환산
  return Math.round((pa - pb) * 10);
}

/** 에고 기프트 속성별 상징색 매핑 */
export function getGiftColor(keyword: string | null | undefined): string {
  switch (keyword) {
    case "화상":
      return "#cd594b";
    case "출혈":
      return "#CE7E4A";
    case "진동":
      return "#FFA31A";
    case "파열":
      return "#9CC751";
    case "침잠":
      return "#61A9B7";
    case "호흡":
      return "#3E96DB";
    case "충전":
      return "#9A6BAE";
    default:
      return "#90969D"; // 범용 색상
  }
}

