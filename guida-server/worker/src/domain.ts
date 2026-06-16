/** DB 스키마 / API 계약 타입 (기존 server/src/types/index.ts 와 동일). */
export type DifficultyTag = '쉬움' | '보통' | '어려움';
export type DifficultyMode = 'normal' | 'hard' | 'extreme';
export type VerifiedMethod = 'self_report' | 'ocr';

export interface GiftOrderItem {
  gift_id: string;
  priority: number;
  floor_target: number;
  difficulty: DifficultyMode;
  required: boolean;
}

export interface PackOrderItem {
  pack_id: string;
  floor: number;
  difficulty: DifficultyMode;
  priority: number;
  memo: string | null;
}

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

export interface LikeBody {
  patch_version: string;
}

export interface PlayBody {
  patch_version: string;
}

export interface ListRoutesQuery {
  patch?: string;
  sort?: 'likes' | 'latest' | 'play_count';
  difficulty_tag?: DifficultyTag;
  difficulty_mode?: DifficultyMode;
  min_likes?: string;
  limit?: string;
  offset?: string;
}
