/**
 * 공유 타입 정의
 * DB 스키마(routes / route_stats / route_likes / config)와 API 계약을 표현한다.
 */

export type Difficulty = '쉬움' | '보통' | '어려움';
export type RouteType = '파밍 효율 중심' | '특정 목표 중심';
export type VerifiedMethod = 'self_report' | 'ocr';

/** routes 테이블 한 행 + 집계된 통계(likes / play_count)를 합친 응답 형태 */
export interface Route {
  route_code: string;
  name: string;
  patch_version: string;
  difficulty: Difficulty;
  route_type: RouteType;
  target_rewards: string[];
  floors: number[];
  memo: string | null;
  verified_method: VerifiedMethod;
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

/** POST /api/routes/upload 요청 바디 */
export interface UploadBody {
  uuid: string;
  name: string;
  difficulty: Difficulty;
  route_type: RouteType;
  target_rewards: string[];
  floors: number[];
  memo?: string;
  verified_method: VerifiedMethod;
}

/** POST /api/routes/:code/like 요청 바디 */
export interface LikeBody {
  uuid: string;
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
  difficulty?: Difficulty;
  route_type?: RouteType;
  min_likes?: number;
  limit?: number;
  offset?: number;
}
