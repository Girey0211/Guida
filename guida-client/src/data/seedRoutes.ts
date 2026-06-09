/**
 * Mock 서버 시드 데이터.
 * 루트 공유 허브가 비어있지 않도록 초기 공유 루트 몇 건을 제공한다.
 * 실제 서버 연동 시 이 시드는 사용되지 않는다.
 */

import type { SharedRoute } from "@/types/route";

export const SEED_SHARED_ROUTES: SharedRoute[] = [
  {
    route_code: "X7R2B9",
    patch_version: "2.4",
    name: "주간 루심화폐 파밍 루트",
    difficulty_tag: "보통",
    route_type: "파밍 효율 중심",
    target_rewards: ["루심화폐", "황금가지"],
    floors: [1, 2, 3, 4, 5, 6, 7],
    steps: [
      { floor: 1, note: "갈림길의 상인 — 거래 거절, 루심화폐 보존" },
      { floor: 3, note: "잊혀진 제단 — 체력 여유 시 황금가지" },
      { floor: 6, note: "심연의 제안 — 대량 루심화폐 수령" },
    ],
    memo: "3층 선택지 주의. 체력 관리가 핵심.",
    verified_method: "self_report",
    stats: {
      "2.4": { likes: 18, play_count: 42 },
      "2.3": { likes: 55, play_count: 130 },
    },
    uploaded_at: "2026-06-01T15:00:00Z",
  },
  {
    route_code: "K3M8P2",
    patch_version: "2.4",
    name: "에고기프트 집중 루트",
    difficulty_tag: "어려움",
    route_type: "특정 목표 중심",
    target_rewards: ["에고기프트 자원", "공명 보주"],
    floors: [1, 2, 3, 4, 5],
    steps: [
      { floor: 1, note: "상인에게서 에고기프트 즉시 구매" },
      { floor: 4, note: "공명의 균열 — 공명 보주 흡수" },
      { floor: 5, note: "안식처 — 보급품으로 에고기프트 추가 확보" },
    ],
    memo: "초반 루심화폐 소모가 크니 전투 보상으로 보충 필요.",
    verified_method: "self_report",
    stats: {
      "2.4": { likes: 9, play_count: 15 },
    },
    uploaded_at: "2026-06-03T09:20:00Z",
  },
  {
    route_code: "T5N1Q7",
    patch_version: "2.3",
    name: "[구버전] 안정형 클리어 루트",
    difficulty_tag: "쉬움",
    route_type: "파밍 효율 중심",
    target_rewards: ["체력 회복", "루심화폐"],
    floors: [1, 2, 3, 4, 5, 6, 7],
    steps: [
      { floor: 3, note: "잊혀진 제단 — 정신력 회복 우선" },
      { floor: 5, note: "안식처 — 체력 회복" },
    ],
    memo: "생존 위주. 신규 패치에서는 효율이 떨어질 수 있음.",
    verified_method: "self_report",
    stats: {
      "2.3": { likes: 40, play_count: 88 },
    },
    uploaded_at: "2026-05-18T11:00:00Z",
  },
];
