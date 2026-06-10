-- ============================================================
-- guida-server 스키마 (단일 소스)
-- 서버 부팅 시 매번 실행된다. 모든 구문이 멱등(idempotent)하므로
-- 이미 반영된 항목은 건너뛰고, 새로 추가된 테이블/인덱스만 반영된다.
-- ※ 컬럼 변경/삭제는 자동 반영되지 않는다(아래 ALTER 가이드 참고).
-- ============================================================

-- ─────────────────────────────────────────────
-- routes — 공유 루트
-- ─────────────────────────────────────────────
-- 루트 스키마는 README §8.4(서버 루트 공개 데이터)를 따른다.
CREATE TABLE IF NOT EXISTS routes (
  id                      SERIAL PRIMARY KEY,
  route_code              CHAR(6)      NOT NULL UNIQUE,       -- 공유용 6자리 난수 코드 (예: X7R2B9)
  name                    VARCHAR(100) NOT NULL,
  patch_version           VARCHAR(10)  NOT NULL,             -- 업로드 시점 패치 버전
  difficulty_tag          VARCHAR(10)  NOT NULL,             -- 체감 난이도: 쉬움 | 보통 | 어려움
  route_type              VARCHAR(30)  NOT NULL,             -- 파밍 효율 중심 | 특정 목표 중심
  difficulty_mode         VARCHAR(10)  NOT NULL DEFAULT 'normal', -- 거던 난이도: normal | hard | extreme
  difficulty_switch_floor INT,                               -- 노말→하드 전환 층 (null = 단일 난이도)
  target_rewards          TEXT[]       NOT NULL DEFAULT '{}', -- 목표 재화 배열
  floors                  INT[]        NOT NULL DEFAULT '{}', -- 거던 층수 배열
  gift_order              JSONB        NOT NULL DEFAULT '[]', -- 기프트 획득 순서 [{ gift_id, priority, floor_target, difficulty, required }]
  pack_order              JSONB        NOT NULL DEFAULT '[]', -- 팩 방문 순서 [{ pack_id, floor, difficulty, priority, memo }]
  memo                    TEXT,                              -- 작성자 메모
  verified_method         VARCHAR(20)  NOT NULL,             -- self_report | ocr
  uploader_uuid           UUID         NOT NULL,             -- 업로드한 디바이스 UUID
  uploaded_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 구(舊) 스키마 운영 DB 자동 마이그레이션 (멱등).
-- CREATE TABLE IF NOT EXISTS 는 기존 테이블을 변경하지 않으므로,
-- 아래 ALTER 들이 인덱스 생성 전에 컬럼을 최신 상태로 맞춘다.
DO $$
BEGIN
  -- difficulty → difficulty_tag 리네임 (구 컬럼이 있고 신 컬럼이 없을 때만)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'routes' AND column_name = 'difficulty'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'routes' AND column_name = 'difficulty_tag'
  ) THEN
    ALTER TABLE routes RENAME COLUMN difficulty TO difficulty_tag;
  END IF;
END $$;

ALTER TABLE routes ADD COLUMN IF NOT EXISTS difficulty_tag          VARCHAR(10)  NOT NULL DEFAULT '보통';
ALTER TABLE routes ADD COLUMN IF NOT EXISTS route_type              VARCHAR(30)  NOT NULL DEFAULT '파밍 효율 중심';
ALTER TABLE routes ADD COLUMN IF NOT EXISTS difficulty_mode         VARCHAR(10)  NOT NULL DEFAULT 'normal';
ALTER TABLE routes ADD COLUMN IF NOT EXISTS difficulty_switch_floor INT;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS target_rewards          TEXT[]       NOT NULL DEFAULT '{}';
ALTER TABLE routes ADD COLUMN IF NOT EXISTS floors                  INT[]        NOT NULL DEFAULT '{}';
ALTER TABLE routes ADD COLUMN IF NOT EXISTS gift_order              JSONB        NOT NULL DEFAULT '[]';
ALTER TABLE routes ADD COLUMN IF NOT EXISTS pack_order              JSONB        NOT NULL DEFAULT '[]';
ALTER TABLE routes ADD COLUMN IF NOT EXISTS verified_method         VARCHAR(20)  NOT NULL DEFAULT 'self_report';
ALTER TABLE routes DROP COLUMN IF EXISTS steps;

CREATE INDEX IF NOT EXISTS idx_routes_patch           ON routes (patch_version);
CREATE INDEX IF NOT EXISTS idx_routes_difficulty_tag  ON routes (difficulty_tag);
CREATE INDEX IF NOT EXISTS idx_routes_difficulty_mode ON routes (difficulty_mode);
CREATE INDEX IF NOT EXISTS idx_routes_route_type      ON routes (route_type);
CREATE INDEX IF NOT EXISTS idx_routes_uploaded_at     ON routes (uploaded_at DESC);

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

-- 현재 게임 패치 버전 초기값 (data/patch_version.json 과 일치)
INSERT INTO config (key, value)
VALUES ('current_patch', '2.7')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────
-- 기존 테이블에 컬럼을 추가할 때
--   CREATE TABLE IF NOT EXISTS 는 이미 존재하는 테이블을 변경하지 않으므로,
--   컬럼 추가는 아래처럼 멱등 ALTER 로 작성한다.
--   예) ALTER TABLE routes ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
--
--   ※ 구(舊) difficulty / steps 스키마 운영 DB 마이그레이션:
--      ALTER TABLE routes RENAME COLUMN difficulty TO difficulty_tag;
--      ALTER TABLE routes ADD COLUMN IF NOT EXISTS difficulty_mode VARCHAR(10) NOT NULL DEFAULT 'normal';
--      ALTER TABLE routes ADD COLUMN IF NOT EXISTS difficulty_switch_floor INT;
--      ALTER TABLE routes ADD COLUMN IF NOT EXISTS gift_order JSONB NOT NULL DEFAULT '[]';
--      ALTER TABLE routes ADD COLUMN IF NOT EXISTS pack_order JSONB NOT NULL DEFAULT '[]';
--      ALTER TABLE routes DROP COLUMN IF EXISTS steps;
-- ─────────────────────────────────────────────
