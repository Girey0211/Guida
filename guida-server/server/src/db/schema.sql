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
  difficulty_mode         VARCHAR(10)  NOT NULL DEFAULT 'normal', -- 거던 난이도: normal | hard | extreme
  difficulty_switch_floor INT,                               -- 노말→하드 전환 층 (null = 단일 난이도)
  target_rewards          TEXT[]       NOT NULL DEFAULT '{}', -- 목표 재화 배열
  floors                  INT[]        NOT NULL DEFAULT '{}', -- 거던 층수 배열
  gift_order              JSONB        NOT NULL DEFAULT '[]', -- 기프트 획득 순서 [{ gift_id, priority, floor_target, difficulty, required }]
  pack_order              JSONB        NOT NULL DEFAULT '[]', -- 팩 방문 순서 [{ pack_id, floor, difficulty, priority, memo }]
  memo                    TEXT,                              -- 작성자 메모
  verified_method         VARCHAR(20)  NOT NULL,             -- self_report | ocr
  deck_code               TEXT,                              -- 덱 공유 코드
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
ALTER TABLE routes DROP COLUMN IF EXISTS route_type;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS difficulty_mode         VARCHAR(10)  NOT NULL DEFAULT 'normal';
ALTER TABLE routes ADD COLUMN IF NOT EXISTS difficulty_switch_floor INT;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS target_rewards          TEXT[]       NOT NULL DEFAULT '{}';
ALTER TABLE routes ADD COLUMN IF NOT EXISTS floors                  INT[]        NOT NULL DEFAULT '{}';
ALTER TABLE routes ADD COLUMN IF NOT EXISTS gift_order              JSONB        NOT NULL DEFAULT '[]';
ALTER TABLE routes ADD COLUMN IF NOT EXISTS pack_order              JSONB        NOT NULL DEFAULT '[]';
ALTER TABLE routes ADD COLUMN IF NOT EXISTS verified_method         VARCHAR(20)  NOT NULL DEFAULT 'self_report';
ALTER TABLE routes ADD COLUMN IF NOT EXISTS deck_code               TEXT;
ALTER TABLE routes DROP COLUMN IF EXISTS steps;

CREATE INDEX IF NOT EXISTS idx_routes_patch           ON routes (patch_version);
CREATE INDEX IF NOT EXISTS idx_routes_difficulty_tag  ON routes (difficulty_tag);
CREATE INDEX IF NOT EXISTS idx_routes_difficulty_mode ON routes (difficulty_mode);
DROP INDEX IF EXISTS idx_routes_route_type;
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
-- route_plays — 플레이 집계 쿨다운 원장
-- (uuid, route_code) 단위로 마지막 플레이 시각을 기록한다.
-- 동일 계정(uploader_uuid)이 같은 루트를 5분 내 재요청하면 집계되지 않으므로
-- 단일 curl 루프로 play_count 를 무제한 부풀리는 것을 차단한다.
-- ※ route_likes 와 동일하게 raw device_uuid 가 아니라 uploader_uuid(단방향)만 적재한다.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS route_plays (
  uuid           UUID        NOT NULL,
  route_code     CHAR(6)     NOT NULL REFERENCES routes (route_code) ON DELETE CASCADE,
  last_played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (uuid, route_code)
);

-- ─────────────────────────────────────────────
-- upload_idempotency — 업로드 멱등 키
-- 비멱등 /upload 의 서명 리플레이(±5분 창 내 재전송)로 중복 루트가
-- 생성되는 것을 막는다. 클라가 업로드마다 생성하는 UUID 를 키로 기억하고,
-- 동일 키 재요청이면 기존 route_code 를 그대로 반환한다.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS upload_idempotency (
  idempotency_key UUID        PRIMARY KEY,
  uploader_uuid   UUID        NOT NULL,
  route_code      CHAR(6)     NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- config — 서버 설정값
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
  key   VARCHAR PRIMARY KEY,
  value TEXT NOT NULL
);

-- ─────────────────────────────────────────────
-- 보안 마이그레이션 (1회): route_likes.uuid 스크럽
--   과거에는 route_likes.uuid 에 raw device_uuid(= Ed25519 서명 시드)가
--   평문 저장됐다. DB 유출 시 작성자 사칭에 악용될 수 있으므로 1회 비운다.
--   이후 추천은 uploader_uuid(uuidv5(pubkey), 단방향)만 기록한다.
--   ※ 통계 수치(route_stats.likes)는 보존되며, 중복방지 원장만 초기화된다.
-- ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM config WHERE key = 'route_likes_uuid_scrubbed_v1') THEN
    TRUNCATE route_likes;
    INSERT INTO config (key, value) VALUES ('route_likes_uuid_scrubbed_v1', 'true');
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- backups — 영지식 백업
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backups (
  recovery_code_hash CHAR(64) PRIMARY KEY,
  encrypted_blob     TEXT NOT NULL,
  uploaded_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 백업 쓰기 소유 증명: owner_uuid(uploader_uuid, 단방향)를 기록한다.
-- 기존 무소유자 행은 NULL → 첫 서명 쓰기 때 소유자를 채운다(claim-on-first-write).
-- 덮어쓰기는 owner_uuid 가 NULL 이거나 요청자와 일치할 때만 허용(불일치 403).
ALTER TABLE backups ADD COLUMN IF NOT EXISTS owner_uuid UUID;

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

-- ─────────────────────────────────────────────
-- inquiries — 버그 제보 및 건의 사항 수집
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inquiries (
  id          SERIAL PRIMARY KEY,
  category    VARCHAR(20)  NOT NULL,             -- bug | suggestion | other
  title       VARCHAR(200) NOT NULL,
  content     TEXT         NOT NULL,
  contact     VARCHAR(100),                      -- 연락처 (이메일, 디스코드 등)
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inquiries_created_at ON inquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_category ON inquiries (category);

-- ─────────────────────────────────────────────
-- users — 유저 프로필
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  uuid        UUID         PRIMARY KEY,
  nickname    VARCHAR(50)  NOT NULL,
  description TEXT         NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_nickname ON users (nickname);


