-- ============================================================
-- guida-server 초기 스키마
-- PostgreSQL 컨테이너 최초 실행 시 1회 실행된다.
-- ============================================================

-- ─────────────────────────────────────────────
-- routes — 공유 루트
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS routes (
  id              SERIAL PRIMARY KEY,
  route_code      CHAR(6)      NOT NULL UNIQUE,           -- 공유용 6자리 난수 코드 (예: X7R2B9)
  name            VARCHAR(100) NOT NULL,
  patch_version   VARCHAR(10)  NOT NULL,                  -- 업로드 시점 패치 버전
  difficulty      VARCHAR(10)  NOT NULL,                  -- 쉬움 | 보통 | 어려움
  route_type      VARCHAR(30)  NOT NULL,                  -- 파밍 효율 중심 | 특정 목표 중심
  target_rewards  TEXT[]       NOT NULL DEFAULT '{}',     -- 목표 재화 배열
  floors          INT[]        NOT NULL DEFAULT '{}',     -- 거던 층수 배열
  memo            TEXT,                                   -- 작성자 메모
  verified_method VARCHAR(20)  NOT NULL,                  -- self_report | ocr
  uploader_uuid   UUID         NOT NULL,                  -- 업로드한 디바이스 UUID
  uploaded_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routes_patch       ON routes (patch_version);
CREATE INDEX IF NOT EXISTS idx_routes_difficulty  ON routes (difficulty);
CREATE INDEX IF NOT EXISTS idx_routes_route_type  ON routes (route_type);
CREATE INDEX IF NOT EXISTS idx_routes_uploaded_at ON routes (uploaded_at DESC);

-- ─────────────────────────────────────────────
-- route_stats — 패치 버전별 통계
-- (route_code, patch_version) UNIQUE 로 버전당 1개 행 보장.
-- 이전 패치 데이터는 삭제되지 않고 아카이브로 유지된다.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS route_stats (
  id            SERIAL PRIMARY KEY,
  route_code    CHAR(6)     NOT NULL REFERENCES routes (route_code) ON DELETE CASCADE,
  patch_version VARCHAR(10) NOT NULL,
  likes         INT         NOT NULL DEFAULT 0,
  play_count    INT         NOT NULL DEFAULT 0,
  UNIQUE (route_code, patch_version)
);

CREATE INDEX IF NOT EXISTS idx_route_stats_likes      ON route_stats (likes DESC);
CREATE INDEX IF NOT EXISTS idx_route_stats_play_count ON route_stats (play_count DESC);

-- ─────────────────────────────────────────────
-- route_likes — 중복 추천 방지
-- (uuid, route_code, patch_version) 복합 PK 로 중복 추천 원천 차단.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS route_likes (
  uuid          UUID        NOT NULL,
  route_code    CHAR(6)     NOT NULL REFERENCES routes (route_code) ON DELETE CASCADE,
  patch_version VARCHAR(10) NOT NULL,
  liked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (uuid, route_code, patch_version)
);

-- ─────────────────────────────────────────────
-- config — 서버 설정값
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
  key   VARCHAR PRIMARY KEY,
  value TEXT NOT NULL
);

-- 현재 게임 패치 버전 초기값
INSERT INTO config (key, value)
VALUES ('current_patch', '2.4')
ON CONFLICT (key) DO NOTHING;
