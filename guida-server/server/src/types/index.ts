/**
 * 공유 타입 정의
 * DB 스키마(routes / route_stats / route_likes / config)와 API 계약을 표현한다.
 * 루트 스키마는 README §8.4(서버 루트 공개 데이터)를 단일 소스로 따른다.
 */

/** 난이도 태그 — 체감 난이도 라벨 (README §6.2) */
export type DifficultyTag = '쉬움' | '보통' | '어려움';
/** 난이도 모드 — 거던 실제 난이도 (gift_order / pack_order 항목과 연동) */
export type DifficultyMode = 'normal' | 'hard' | 'extreme';
export type VerifiedMethod = 'self_report' | 'ocr';

/** 기프트 획득 순서 한 항목 (routes.gift_order JSONB) — gifts.json 의 id 참조 */
export interface GiftOrderItem {
  gift_id: string;
  priority: number;
  floor_target: number;
  difficulty: DifficultyMode;
  required: boolean;
}

/** 팩 방문 순서 한 항목 (routes.pack_order JSONB) — packs.json 의 id 참조 */
export interface PackOrderItem {
  pack_id: string;
  floor: number;
  difficulty: DifficultyMode;
  priority: number;
  memo: string | null;
}

/** routes 테이블 한 행 + 집계된 통계(likes / play_count)를 합친 응답 형태 */
export interface Route {
  route_code: string;
  name: string;
  patch_version: string;
  difficulty_tag: DifficultyTag;
  difficulty_mode: DifficultyMode;
  difficulty_switch_floor: number | null;
  target_rewards: string[];
  floors: number[];
  gift_order: GiftOrderItem[];
  pack_order: PackOrderItem[];
  memo: string | null;
  verified_method: VerifiedMethod;
  deck_code: string | null;
  uploader_uuid: string;
  uploader_nickname: string;
  uploaded_at: string;
  likes: number;
  play_count: number;
}

/** route_stats 테이블 한 행 */
export interface Stats {
  route_code: string;
  patch_version: string;
  likes: number;
  play_count: number;
}

/** POST /api/routes/upload 요청 바디 (작성자는 요청 서명으로 식별) */
export interface UploadBody {
  name: string;
  difficulty_tag: DifficultyTag;
  difficulty_mode: DifficultyMode;
  difficulty_switch_floor?: number | null;
  target_rewards: string[];
  floors: number[];
  gift_order?: GiftOrderItem[];
  pack_order?: PackOrderItem[];
  memo?: string;
  verified_method: VerifiedMethod;
  deck_code?: string | null;
  /** 업로드 멱등 키(클라 생성 UUID). 서명 리플레이로 인한 중복 업로드 방지용. update 에는 미사용. */
  idempotency_key?: string;
}

/** POST /api/routes/:code/like 요청 바디 (추천 주체는 요청 서명으로 식별) */
export interface LikeBody {
  patch_version: string;
}

/** POST /api/routes/:code/play 요청 바디 (거던 클리어 시 호출) */
export interface PlayBody {
  patch_version: string;
}

/** GET /api/routes 쿼리 파라미터 */
export interface ListRoutesQuery {
  patch?: string;
  sort?: 'likes' | 'latest' | 'play_count';
  difficulty_tag?: DifficultyTag;
  difficulty_mode?: DifficultyMode;
  min_likes?: number;
  limit?: number;
  offset?: number;
}
