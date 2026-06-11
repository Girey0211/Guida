# 🧭 Guida (가이다)

> 림버스 컴퍼니 유저의 거울 던전 플레이 및 수집 목표 관리를 돕기 위한 **PC 전용 데스크톱 편의성 애플리케이션**입니다.
>
> 오픈소스의 투명성을 기반으로 하며, 게임의 공정성을 해치지 않는 **'읽기 전용(Read-Only)'** 및 **'로컬 중심(Offline-First)'** 설계를 지향합니다.
>
> *"Guida"는 단테의 신곡에서 베르길리우스가 단테의 안내자(길잡이)로 불리던 이탈리아어 단어입니다. 한국어 표기 및 약칭은 **가이다**입니다.*

---

## 📑 목차

1. [프로젝트 개요 및 기조](#1-프로젝트-개요-및-기조)
2. [개발 로드맵 (MVP 우선순위)](#2-개발-로드맵-mvp-우선순위)
3. [시스템 아키텍처](#3-시스템-아키텍처-3-tier-hybrid)
4. [코드 구조](#4-코드-구조-project-structure)
5. [핵심 기능 요구사항](#5-핵심-기능-요구사항-functional-requirements)
6. [루트 탐색 필터 명세](#6-루트-탐색-필터-명세-route-search-filter)
7. [데이터 흐름도](#7-데이터-흐름도-data-flow-diagram)
8. [데이터 스키마](#8-데이터-스키마-data-schema)
9. [기술 명세 및 제약 조항](#9-기술-명세-및-제약-조항-technical-specifications)
10. [배포 및 운영 정책](#10-배포-및-운영-정책)
11. [화면 구조 및 UI 명세](#11-화면-구조-및-ui-명세)
12. [디자인 시스템](#12-디자인-시스템-design-system)

---

## 1. 프로젝트 개요 및 기조

- **목적:** 거울 던전 선택지 가이드 및 실시간 보상 추적을 통한 유저 편의성 극대화
- **플랫폼:** PC 데스크톱 애플리케이션 (Windows 환경 우선 지원)

### 개발 기조

| 기조 | 설명 |
|---|---|
| 🔍 **Transparency** (투명성) | GitHub 전면 오픈소스 공개로 코드 투명성 확보 및 보안 취약점 원천 차단 |
| 🛡️ **Read-Only** (안전성) | 게임 내 조작(Input) 및 클라이언트 변조가 없는 비인젝션(Non-Injection) 방식 설계 |
| 📦 **Offline-First** (독립성) | 중앙 서버 가동 여부와 관계없이 핵심 기능이 100% 가동되는 하이브리드 아키텍처 |
| 🪶 **Ultra-Lightweight** (경량화) | 최초 설치 용량 **15MB 이하** 목표 (이미지 지연 로딩 적용) |

---

## 2. 개발 로드맵 (MVP 우선순위)

### Phase 1 — MVP (최초 출시)

| 기능 | 설명 |
|---|---|
| ✅ **거던 선택지 가이드** | 거울 던전 이벤트/선택지별 보상 DB 기반 오버레이 가이드 |
| ✅ **루트 작성 및 로컬 저장** | 유저가 직접 루트를 작성하고 로컬에 저장 |
| ✅ **루트 공유 허브 (코드 방식)** | 6자리 난수 코드 기반 익명 루트 업로드/다운로드 |
| ✅ **루트 탐색 및 필터** | 패치 버전, 추천순, 목표 재화 등 필터 기반 루트 검색 |
| ✅ **추천(좋아요) 시스템** | UUID 기반 디바이스당 1추천, 패치 버전 단위 집계 |
| ✅ **이미지 지연 로딩 및 캐싱** | 이미지 키 구조 확보, MVP는 텍스트+배지로 대체 운영 |

> ⚠️ Phase 1에서 루트 공유의 검증 조건은 자기 신고 방식(체크박스)으로 대체합니다.

### Phase 2 — OCR 베타

| 기능 | 설명 |
|---|---|
| 🔬 **OCR 보상 추적 (베타)** | 거던 클리어 결과창 자동 감지 및 아이템/수량 추출 |
| 🔬 **OCR 기반 루트 자동 검증** | 결과창 감지 시 `verified: true` 자동 플래그 |
| 🔬 **다양한 해상도/DPI 대응** | 창 모드, 전체화면, DPI scaling 별 캡처 보정 |
| 🔬 **게임 이미지 에셋 도입** | CDN 이미지 제공 시작, `ImageWithFallback` 컴포넌트로 점진 전환 |

### Phase 3 — 고도화

| 기능 | 설명 |
|---|---|
| 🚀 **수집 목표 관리 대시보드** | 획득한 재화 누적 추적 및 목표 달성률 시각화 |
| 🚀 **루트 버전 만료 경고** | 현재 패치와 2버전 이상 차이 시 "오래된 루트" 배지 자동 표시 |
| 🚀 **클립보드 코드 감지** | 코드 복사 후 앱 실행 시 해당 루트 자동 불러오기 팝업 |
| 🚀 **macOS / Linux 지원 확장** | Windows 우선 이후 타 OS 지원 검토 |

---

## 3. 시스템 아키텍처 (3-Tier Hybrid)

### 3.1. 아키텍처 구조

#### 🖥️ Client Layer (Tauri)

- **UI / Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **App Core / Backend (Rust):** Windows Graphics Capture API *(Phase 2~)*, OCR *(Phase 2~)*, 로컬 파일 시스템

#### 💾 Local Storage Layer

`%APPDATA%/Guida/` 경로에 저장
- `user_settings.json` — 앱 설정 및 디바이스 고유 UUID
- `my_routes.json` — 로컬 루트 데이터
- `cache/` — 게임 데이터 이미지 캐시 *(Phase 2~)*

#### ☁️ Server & Data Layer

- **CDN (정적 파일):** `gifts.json`, `packs.json`, `events.json`, `dependencies.json`, `patch_version.json`, 이미지 에셋 *(Phase 2~)*
- **Backend Server (동적 API):** 루트 공유 허브, 추천/조회 통계, Rate Limiting, UUID 중복 방지

### 3.2. 데이터 저장소 분류 원칙

| 데이터 종류 | 변경 빈도 | 저장소 | 이유 |
|---|---|---|---|
| 에고기프트 / 팩 / 선택지 / 의존성 | 패치마다 | **CDN JSON** | 읽기 전용, 전 유저 동일, 오프라인 캐싱 적합 |
| 게임 이미지 에셋 | 패치마다 | **CDN + 로컬 캐시** | 용량 크므로 지연 로딩 및 로컬 캐싱 |
| 루트 공유 / 추천 / 조회 통계 | 실시간 | **DB (서버)** | 유저마다 다르고 실시간 누적 |
| 유저 설정 / 로컬 루트 / 플레이 세션 | 유저 행동마다 | **로컬 파일** | 개인 데이터, 서버 불필요 |

---

## 4. 코드 구조 (Project Structure)

```
guida/
│
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── ui/
│   │   ├── overlay/
│   │   │   ├── OverlayWindow.tsx
│   │   │   └── GuideHighlight.tsx
│   │   ├── route/
│   │   │   ├── RouteCard.tsx
│   │   │   ├── RouteEditor.tsx       # 루트 작성/편집 + 의존성 경고 UI
│   │   │   └── RouteFilter.tsx
│   │   └── common/
│   │       ├── PatchBadge.tsx
│   │       ├── DifficultyBadge.tsx   # 노말/하드/EXTREME 배지
│   │       ├── KeywordBadge.tsx
│   │       └── ImageWithFallback.tsx
│   │
│   ├── pages/
│   │   ├── BaseScreen.tsx
│   │   ├── PlayScreen.tsx
│   │   └── Settings.tsx
│   │
│   ├── store/
│   │   ├── appStore.ts
│   │   ├── guideStore.ts
│   │   ├── routeStore.ts
│   │   └── playStore.ts
│   │
│   ├── hooks/
│   │   ├── useTauriCommand.ts
│   │   ├── useImageCache.ts
│   │   ├── useRouteFilter.ts
│   │   └── useDependencyCheck.ts
│   │
│   ├── api/
│   │   ├── client.ts
│   │   ├── routes.ts
│   │   └── gameData.ts
│   │
│   ├── types/
│   │   ├── route.ts
│   │   ├── gameData.ts
│   │   └── settings.ts
│   │
│   └── assets/
│       ├── fallback.webp
│       └── icons/
│
├── src-tauri/
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── commands/
│       │   ├── fs.rs
│       │   ├── settings.rs
│       │   └── capture.rs        # Phase 2~
│       ├── ocr/                  # Phase 2~
│       │   ├── capture.rs
│       │   ├── preprocess.rs
│       │   └── recognize.rs
│       └── utils/uuid.rs
│
├── data/
│   ├── patch_version.json
│   ├── gifts.json
│   ├── packs.json
│   ├── events.json
│   └── dependencies.json
│
├── package.json
├── vite.config.ts
├── tailwind.config.ts
└── README.md
```

---

## 5. 핵심 기능 요구사항

### 5.1. 거울 던전 실시간 선택지 가이드 `Phase 1`

- 거울 던전 내 조우하는 이벤트 및 선택지별 보상 데이터베이스 탑재
- 유저가 설정한 파밍 목적에 맞춰 최적의 선택지를 오버레이 화면에 추천 및 하이라이트 노출

### 5.2. 거던 루트 익명 공유 허브 `Phase 1`

#### 루트 업로드
- 로그인 없이 서버에 업로드
- Phase 1: 자기 신고 체크박스 / Phase 2~: OCR 자동 검증
- 업로드 시 서버에서 현재 패치 버전 자동 태깅
- 6자리 고유 난수 코드 발급 (예: `X7R2B9`)

#### 루트 탐색 및 검색
- 6자리 코드 직접 입력으로 특정 루트 즉시 호출
- 필터/정렬 조합으로 루트 검색 (섹션 6 참조)

#### 추천(좋아요) 시스템
- 디바이스 UUID 기반 루트 1추천 제한
- 추천수는 패치 버전 단위로 집계
- 이전 패치 데이터는 아카이브로 보존

#### 조회수 집계
- `GET /routes/:code` 호출 시 +1 (Phase 1)
- Phase 2~ OCR 연동 시 실제 플레이 기반 카운트 전환 검토

### 5.3. 인게임 실시간 보상 추적 `Phase 2`

- 거울 던전 클리어 후 보상 획득 결과 창 백그라운드 감지
- OCR로 획득 아이템 종류 및 수량 추출 → 로컬 자동 반영
- 결과 창 감지 시 현재 루트에 `verified: true` 자동 플래그

### 5.4. 화면 전환 자동화 `Phase 2`

- 앱 켜져 있는 동안 백그라운드 게임 화면 모니터링 (Phase 2~ OCR 도입 시 진행)
- 거던 탐사 시작 화면 감지 시 기본화면 → 플레이화면 자동 전환
- 탐사 종료 감지 시 플레이화면 → 기본화면 복귀


---

## 6. 루트 탐색 필터 명세

### 6.1. 기본 필터

| 필터 | 옵션 | 기본값 |
|---|---|---|
| **패치 버전** | 현재 패치 / 전체 / 버전 직접 선택 | 현재 패치 |
| **정렬 기준** | 추천순 / 최신순 / 조회 많은순 | 추천순 |
| **검증 여부** | 전체 / 검증된 루트만 | 검증된 루트만 |

### 6.2. 게임 콘텐츠 필터

| 필터 | 설명 |
|---|---|
| **목표 재화** | 특정 에고기프트/ 기타 특정 재화 |
| **거던 층수** | 전체 / 특정 층 집중 루트 |
| **난이도** | 노말 / 하드 / EXTREME |
| **난이도 태그** | 쉬움 / 보통 / 어려움 |
| **루트 유형** | 파밍 효율 중심 / 특정 목표 중심 |

### 6.3. 신뢰도 필터

| 필터 | 설명 |
|---|---|
| **최소 추천수** | 예) 추천 5개 이상만 표시 |
| **최소 조회수** | 예) 3회 이상 조회된 루트만 |

---

## 7. 데이터 흐름도

### 7.1. 최초 실행 및 데이터 동기화

```
[ 앱 최초 실행 ]
        │
        ├─► UUID 존재 여부 확인
        │       ├─► 없음: UUID 신규 생성 후 user_settings.json 저장
        │       └─► 있음: 기존 UUID 로드
        │
        ▼
[ CDN에 버전 체크 요청 ]
        │
        ├─► 로컬 캐시 버전 == 서버 버전: 로컬 캐시 사용
        └─► 버전 차이: 변경된 JSON 파일만 선택적 다운로드
              (gifts / packs / events / dependencies 병렬 요청)
        │
        ▼
[ 게임 데이터 메모리 탑재 완료 → 앱 사용 가능 ]
```

### 7.2. 루트 업로드 및 코드 발급

```
[ 유저: 루트 작성 완료 후 '공유하기' 클릭 ]
        ▼
[ 자기 신고 체크박스 확인 ]
        ▼
[ 루트 데이터 + UUID + 현재 패치 버전 → 서버 전송 ]
        ▼
[ 서버: 유효성 검증 + 패치 버전 자동 태깅 ]
        ▼
[ 6자리 난수 코드 발급 → 클라이언트 반환 ]
```

### 7.3. 추천(좋아요) 흐름

```
[ 유저: 루트 탐색 중 '추천' 버튼 클릭 ]
        ▼
[ 서버: { uuid, route_code, patch_version } 중복 확인 ]
        ├─► 중복: 요청 거부
        └─► 최초: 추천수 +1 (패치 버전 단위)
```

### 7.4. 이미지 로딩 흐름 (Phase 2~)

```
[ UI에서 이미지 요청 ]
        ├─► 로컬 캐시 존재: 즉시 로드
        └─► 캐시 없음
                ├─► CDN 정상: 다운로드 → 캐시 저장 → 표시
                └─► CDN 다운: KeywordBadge(텍스트) 폴백
```

---

## 8. 데이터 스키마

### 8.1. 로컬 — `user_settings.json`

```json
{
  "uuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "app_version": "1.0.0",
  "current_patch": "2.7",
  "theme": "dark",
  "overlay_opacity": 0.85
}
```

### 8.2. 로컬 — `my_routes.json`

```json
{
  "routes": [
    {
      "local_id": "route_001",
      "name": "주간 하드 5층",
      "created_at": "2025-06-01T12:00:00Z",
      "patch_version": "2.7",
      "verified": false,
      "verified_method": "self_report",
      "verified_at": null,
      "shared_code": null,
      "target_rewards": ["주간보상"],
      "difficulty_tag": "보통",
      "route_type": "파밍 효율 중심",
      "difficulty_mode": "hard",
      "difficulty_switch_floor": 3,
      "floors": [1, 2, 3, 4, 5],
      "memo": "3층부터 하드 전환. 심야청소 4층 필수.",
      "gift_order": [
        {
          "gift_id": "gift_네뷸라이저",
          "priority": 1,
          "floor_target": 2,
          "difficulty": "normal",
          "required": true
        },
        {
          "gift_id": "gift_물부리",
          "priority": 2,
          "floor_target": 3,
          "difficulty": "normal",
          "required": true
        },
        {
          "gift_id": "gift_묘각",
          "priority": 3,
          "floor_target": 4,
          "difficulty": "hard",
          "required": true
        }
      ],
      "pack_order": [
        {
          "pack_id": "pack_사랑할_수_없는",
          "floor": 2,
          "difficulty": "normal",
          "priority": 1,
          "memo": null
        },
        {
          "pack_id": "pack_심야청소",
          "floor": 4,
          "difficulty": "hard",
          "priority": 2,
          "memo": "묘각 필수 획득"
        },
        {
          "pack_id": "pack_LCB_정기검진",
          "floor": 5,
          "difficulty": "hard",
          "priority": 3,
          "memo": null
        }
      ],
      "starting_gift": {
        "keyword_type": "호흡",
        "gift_id": "gift_물부리",
        "name": "물부리"
      },
      "gahos": [
        {
          "gaho_id": "gaho_시작의_별",
          "name": "시작의 별",
          "stage": 1
        }
      ],
      "restrictions": {
        "11": [
          { "name": "쇠약", "score": 1 }
        ],
        "12": [
          { "name": "정신력 고갈 I", "score": 3 },
          { "name": "레벨 강화", "score": 1 }
        ],
        "13": [],
        "14": [],
        "15": []
      }
    }
  ]
}
```

**주요 필드 정의**

| 필드 | 설명 |
|---|---|
| `difficulty_mode` | 루트 최종 목표 난이도. `"normal"` / `"hard"` / `"extreme"` |
| `difficulty_switch_floor` | 노말 → 하드로 전환하는 층 번호. `null`이면 전체 단일 난이도 |
| `gift_order[].difficulty` | 해당 기프트를 획득하는 시점의 난이도. 팩 방문 계획과 연동 |
| `gift_order[].required` | 루트의 핵심 기프트 여부. `false`면 "있으면 좋은" 옵션 기프트 |
| `pack_order` | 방문할 팩을 순서, 층, 난이도와 함께 명시 |
| `pack_order[].floor` | 해당 팩을 방문할 목표 층 |
| `pack_order[].difficulty` | 해당 팩을 방문할 시점의 난이도 |
| `starting_gift` | 탐사 시작 시 선택한 기프트 1개. `dungeon_meta.json`의 `starting_gifts`에서 선택. `null`이면 미선택 |
| `gahos[].stage` | 0 = 기본 / 1 = + / 2 = ++ |
| `restrictions` | `difficulty_mode: "extreme"`일 때만 유효. 층별 선택한 제약 목록 |

> 📌 `verified_method`: `"self_report"` (Phase 1) / `"ocr"` (Phase 2~)

### 8.3. 로컬 — 플레이 세션 상태 (`playStore` 메모리)

세션 종료 시 `my_routes.json`에 병합 저장됩니다.

```json
{
  "session_id": "sess_20250601_001",
  "active_route_id": "route_001",
  "started_at": "2025-06-01T14:00:00Z",
  "current_floor": 3,
  "current_difficulty": "normal",
  "difficulty_switched": false,
  "acquired_gifts": ["gift_네뷸라이저", "gift_물부리"],
  "visited_packs": ["pack_사랑할_수_없는"],
  "route_switched_at_floor": null
}
```

**추가 필드 정의**

| 필드 | 설명 |
|---|---|
| `current_difficulty` | 현재 플레이 중인 난이도 (`"normal"` / `"hard"` / `"extreme"`) |
| `difficulty_switched` | 이번 세션에서 하드 전환이 이미 이루어졌는지 여부 |

### 8.4. 서버 — 루트 공개 데이터

```json
{
  "route_code": "X7R2B9",
  "patch_version": "2.7",
  "name": "주간 하드 5층",
  "difficulty_tag": "보통",
  "route_type": "파밍 효율 중심",
  "difficulty_mode": "hard",
  "difficulty_switch_floor": 3,
  "target_rewards": ["주간보상"],
  "floors": [1, 2, 3, 4, 5],
  "memo": "3층부터 하드 전환. 심야청소 4층 필수.",
  "gift_order": [
    { "gift_id": "gift_네뷸라이저", "priority": 1, "floor_target": 2, "difficulty": "normal", "required": true },
    { "gift_id": "gift_물부리",    "priority": 2, "floor_target": 3, "difficulty": "normal", "required": true },
    { "gift_id": "gift_묘각",      "priority": 3, "floor_target": 4, "difficulty": "hard",   "required": true }
  ],
  "pack_order": [
    { "pack_id": "pack_사랑할_수_없는", "floor": 2, "difficulty": "normal", "priority": 1, "memo": null },
    { "pack_id": "pack_심야청소",       "floor": 4, "difficulty": "hard",   "priority": 2, "memo": "묘각 필수 획득" },
    { "pack_id": "pack_LCB_정기검진",   "floor": 5, "difficulty": "hard",   "priority": 3, "memo": null }
  ],
  "verified_method": "self_report",
  "stats": {
    "2.7": { "likes": 18, "view_count": 42 },
    "2.6": { "likes": 55, "view_count": 130 }
  },
  "uploaded_at": "2025-06-01T15:00:00Z"
}
```

### 8.5. CDN — 게임 데이터 JSON 구조

앱 시작 시 4개 파일을 병렬로 요청합니다.

```
data/
├── patch_version.json
├── gifts.json
├── packs.json
├── events.json
├── dependencies.json
└── dungeon_meta.json
```

#### `gifts.json` — 에고기프트 (449개, 실제 데이터 기준)

```json
[
  {
    "id": "gift_묘각",
    "name": "묘각",
    "image_key": null,
    "ocr_keywords": ["묘각"],
    "keyword_type": "파열",
    "keyword_color": "#E67E22",
    "grade": "3",
    "hard_mode_only": false,
    "pack_exclusive": true,
    "pack_id": null,
    "effect": "...",
    "upgradeable": true,
    "first_appeared": "...",
    "related": "...",
    "is_craftable": false,
    "craft_recipe": null,
    "craft_result_of": null,
    "source_type": "테마팩_전용",
    "source_category": "테마팩_전용",
    "added_patch": null,
    "tags": ["파열"]
  }
]
```

**주요 필드 정의**

| 필드 | 설명 |
|---|---|
| `keyword_type` | 화상 / 출혈 / 진동 / 파열 / 침잠 / 호흡 / 충전 / 참격 / 관통 / 타격 / 범용 |
| `keyword_color` | 키워드 배지 색상 (이미지 없는 Phase 1의 시각 식별 핵심) |
| `hard_mode_only` | 하드 난이도에서만 등장하는 기프트 여부 |
| `pack_exclusive` | 특정 팩에서만 획득 가능한 기프트 여부 |
| `source_type` | 기본_7키워드 / 기본_7키워드_외 / 테마팩_전용 |
| `craft_recipe` | 합성 기프트 재료 gift_id 배열 |
| `craft_result_of` | 이 기프트가 재료로 쓰일 때의 결과물 gift_id |

#### `packs.json` — 팩 (118개, 실제 데이터 기준)

```json
[
  {
    "id": "pack_심야청소",
    "name": "심야청소",
    "image_key": null,
    "ocr_keywords": ["심야청소"],
    "pack_type": "테마",
    "story_chapter": "7.5장",
    "available_floors_normal": [4, 5],
    "available_floors_hard": [5],
    "available_in_normal": true,
    "available_in_hard": true,
    "floor_length": 3,
    "bosses": ["도시의 청소부"],
    "gift_groups": [],
    "exclusive_gifts": [
      "파열 기프트", "괴문자 부적", "묘각", "새겨넣어진 괴문자",
      "그림자 삿갓", "강화 문신 - 중지", "의리 사슬",
      "찰랑이는 연료통", "앙갚음 장부", "오래된 조각상"
    ],
    "is_hidden": false,
    "is_extreme_only": false,
    "added_patch": null,
    "tags": []
  }
]
```

**주요 필드 정의**

| 필드 | 설명 |
|---|---|
| `available_floors_normal` | 노말 난이도에서 등장 가능한 층 목록. `null`이면 노말에서 미등장 |
| `available_floors_hard` | 하드 난이도에서 등장 가능한 층 목록. `null`이면 하드에서 미등장 |
| `available_in_normal` | 노말 난이도 등장 여부 (boolean, null 체크 생략용) |
| `available_in_hard` | 하드 난이도 등장 여부 (boolean, null 체크 생략용) |
| `gift_groups` | 통상 기프트 풀 그룹 코드 목록 (A~J) |
| `exclusive_gifts` | 이 팩에서만 얻을 수 있는 전용 기프트 이름 목록 |
| `is_hidden` | 히든 팩 여부 (관측 불가, 낮은 확률 등장) |
| `is_extreme_only` | EXTREME 모드 전용 팩 여부 |

**난이도별 팩 분포 (거울 던전 7 기준)**

| 구분 | 수량 |
|---|---|
| 노말+하드 모두 등장 | 51개 |
| 하드 전용 (노말 미등장) | 44개 |
| EXTREME 전용 | 21개 |
| 히든 팩 | 2개 |

#### `events.json` — 선택지 이벤트

```json
[
  {
    "id": "event_기습",
    "name": "기습",
    "image_key": null,
    "ocr_keywords": ["기습"],
    "pack_id": "pack_심야청소",
    "is_field_event": true,
    "description": "갑작스러운 기습 상황.",
    "choices": [
      {
        "choice_id": "c1",
        "text": "맞서 싸운다",
        "has_skill_check": true,
        "check_sin": ["분노", "색욕"],
        "check_threshold": 8,
        "on_success": { "reward_type": "gift", "reward_id": "gift_묘각", "description": "에고기프트 획득" },
        "on_failure": { "reward_type": "damage", "description": "수감자 피해" }
      },
      {
        "choice_id": "c2",
        "text": "도망친다",
        "has_skill_check": false,
        "on_success": { "reward_type": "none", "description": "아무 일도 없음" }
      }
    ],
    "recommended_choice_id": "c1",
    "recommended_reason": "판정 성공 시 팩 한정 기프트 획득",
    "added_patch": null,
    "tags": ["전투선택지", "심야청소"]
  }
]
```

> 📌 `check_sin`: 판정 죄종 — 분노 / 색욕 / 우울 / 나태 / 폭식 / 질투 / 오만
> 📌 `reward_type`: gift / currency / damage / nothing / combat

#### `dependencies.json` — 기프트 순서 의존성

```json
[
  {
    "gift_id": "gift_물부리",
    "dependencies": [
      {
        "target_gift_id": "gift_네뷸라이저",
        "type": "before",
        "required": false,
        "reason": "네뷸라이저 보유 시 물부리의 호흡 위력 증가 효과가 즉시 적용됨. 역순 시 효과 손실."
      }
    ]
  }
]
```

**`type` 정의**

| type | 의미 |
|---|---|
| `before` | 이 기프트는 대상보다 나중에 획득해야 함 |
| `after` | 이 기프트는 대상보다 먼저 획득해야 함 |
| `with` | 같이 보유해야 효과 발동 (순서 무관, 시너지) |
| `excludes` | 같이 가져가면 효과 충돌 (상충 관계) |

> ⚠️ `dependencies.json` 빌드 시 DAG 검증 스크립트를 실행하여 순환 참조를 사전 차단합니다.

#### `dungeon_meta.json` - 시즌별 던전 메타 데이터 (시작 기프트 / 별의 가호 / EXTREME 제약)

```json
{
  "dungeon_name": "이름과 거미의 거울",
  "dungeon_season": 7,

  "starting_gifts": [
    {
      "keyword_type": "화상",
      "grade": "2",
      "gifts": [
        { "name": "지옥나비의 꿈", "gift_id": "gift_지옥나비의_꿈" },
        { "name": "작열우모",      "gift_id": "gift_작열우모" },
        { "name": "울화통",        "gift_id": "gift_울화통" }
      ]
    }
  ],

  "gahos": [
    {
      "id": "gaho_시작의_별",
      "name": "시작의 별",
      "required_bonus_points": 10,
      "description": "시작 코스트+150/250/250 ...",
      "stages": ["기본", "+", "++"],
      "max_stage": 2
    }
  ],

  "restrictions_by_floor": {
    "11": [
      {
        "name": "레벨 강화",
        "effect": "모든 적 레벨 3 증가",
        "score": 1,
        "bonus": "1515"
      }
    ]
  }
}
```

**필드 설명**

| 필드 | 설명 |
|---|---|
| `starting_gifts` | 키워드별 시작 기프트 선택지. 키워드당 3개 중 1개 선택. 시즌마다 교체 |
| `starting_gifts[].grade` | 시작 기프트 등급. 현재 시즌 기준 모두 `"2"` |
| `gahos` | 별의 가호 전체 목록. 루트 작성 시 `gaho_id` 참조 |
| `gahos[].required_bonus_points` | 해당 가호 해금에 필요한 별빛 보너스 점수 |
| `gahos[].max_stage` | 최대 강화 단계. 항상 `2` (기본/+/++) |
| `restrictions_by_floor` | EXTREME 모드(11~15층)에서 층별 선택 가능한 제약 목록 |
| `restrictions_by_floor[층].score` | 제약 선택 시 획득하는 점수 |
| `restrictions_by_floor[층].bonus` | 별빛 보너스 + 투영도 획득량 (예: `"1515"` = 별빛 15 + 투영도 15) |

> 📌 `dungeon_meta.json`은 시즌 교체 시 전체 갱신됩니다. `patch_version.json`과 달리 패치마다 바뀌지 않고 새 거울 던전 시즌이 시작될 때만 교체합니다.

### 8.6. 의존성 기반 루트 편집기 동작

**루트 편집 시 경고**
```
⚠️ 물부리는 네뷸라이저보다 나중에 획득하는 것을 권장합니다.
   현재 순서: 물부리(1번) → 네뷸라이저(2번)
   [순서 자동 수정]  [무시하고 유지]
```

**플레이화면 에고기프트 탭 잠금 표시**
```
✅ 네뷸라이저          ← 획득 목표 (상단)
🔒 물부리              ← [네뷸라이저 먼저 필요] 배지
```

**팩 호환성 검증**
루트 편집 시 `pack_order`에 추가한 팩이 선택한 `difficulty_mode` 및 `floor`와 호환되는지 자동 검증합니다.

```
⚠️ 심야청소는 하드 5층에서만 등장합니다.
   현재 설정: 3층 · 노말
   [수정하기]  [무시]
```

### 8.7. 팩 데이터 해석 규칙

**층수별 등장 팩 풀**

| 층 범위 | 등장 팩 기준 |
|---|---|
| 1~5층 | `available_floors_normal` 또는 `available_floors_hard`에 해당 층 포함 여부 |
| 6~10층 | 5층 등장 가능 팩과 동일한 풀 (`available_floors`에 `5` 포함 여부로 판단) |
| 11~15층 | `available_floors_extreme`이 존재하는 팩만 등장 (EXTREME 모드 전용) |

**`gift_pool_type: "모든_통상_기프트"` 팩 처리**

`gift_pool`이 비어있는 EXTREME 팩은 `gifts.json` 전체 중 `pack_exclusive: false`인 기프트를 드랍 풀로 간주합니다. 별도 목록 없이 앱 런타임에 동적으로 계산합니다.

---

## 9. 기술 명세 및 제약 조항

### 9.1. 세부 기술 스택

| 구분 | Phase 1 | Phase 2~ |
|---|---|---|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui | 동일 |
| **상태 관리** | Zustand | 동일 |
| **Backend Bridge** | Tauri v2 Core (Rust) | 동일 |
| **Screen Capture** | — | Windows Graphics Capture API |
| **OCR** | — | Tesseract.js → leptess Rust 바인딩 |
| **Image Processing** | — | OpenCV (Rust Binding) |
| **CDN** | GitHub Raw | Cloudflare (트래픽 증가 시 전환) |
| **이미지 표현** | KeywordBadge (텍스트+색상) | 512×512 WebP (30~50KB/장) |

### 9.2. 개발 제약

- 🚫 **No Memory Touch:** `OpenProcess` 등 게임 프로세스 직접 접근 금지
- 🚫 **No Input Injection:** 마우스/키보드 자동화 코드 포함 불가
- ✅ **서버 오프라인 대응:** 로컬 캐시 기반으로 오버레이 가이드 기능 100% 정상 작동 (루트 공유/탐색/추천만 제한)
- ✅ **화면 캡처 권한 명시 (Phase 2~):** 앱 UI에서 명시적 권한 요청 및 용도 안내
- ✅ **저작권 준수:** 게임 이미지 에셋 도입 시 Project Moon 정책 검토 후 진행

---

## 10. 배포 및 운영 정책

### 10.1. 배포 방식

- GitHub Releases를 통한 `.exe` 설치 파일 배포
- 각 릴리즈에 VirusTotal 스캔 결과 링크 첨부
- 오픈소스 공개로 코드 투명성 보장

### 10.2. 베타 출시 전략

1. 디시인사이드 림버스 컴퍼니 갤러리에 베타 테스트 모집 공고
2. "OCR 없이도 루트 공유/검색 즉시 사용 가능" 강조
3. 오버레이 실시간 가이드 데모 영상 (유튜브/X) 선공개
4. 초기 피드백 기반으로 OCR Phase 2 개발 방향 결정

### 10.3. 유지보수 정책

- 패치 적용 시 `gifts.json` / `packs.json` / `events.json` / `dependencies.json` 업데이트 + `patch_version.json` 갱신
- Phase 2~ OCR 도입 시 해상도/DPI별 캡처 보정 템플릿 별도 관리
- 앱 최초 실행 시 비공식 팬 프로젝트 고지 팝업 필수 노출

---

## 11. 화면 구조 및 UI 명세

### 11.1. 화면 구성 개요

| 화면 | 진입 조건 | 이탈 조건 |
|---|---|---|
| **기본화면** | 앱 실행 시 기본 / 플레이화면 뒤로가기 | 플레이 시작 버튼 클릭 시 전환 (Phase 2: 자동 전환) |
| **플레이화면** | 플레이 시작 버튼 클릭 시 (Phase 2: 자동 감지) | 탐사 종료/완료 버튼 클릭 시 (Phase 2: 자동 감지) |

### 11.2. 기본화면 (Base Screen)

#### 섹션 A — 루트 관리 (My Routes)
- 내 루트 목록 카드 리스트 (이름 / 패치 버전 배지 / 난이도 배지 / 검증 여부 배지)
- 각 카드에서 수정 / 삭제 / 공유코드 복사 가능
- FAB(+) 버튼으로 새 루트 작성
  - 기프트 추가 시 의존성 경고 자동 표시
  - 팩 추가 시 난이도/층 호환성 자동 검증
  - `gift_order` 드래그로 순서 조정
  - `pack_order` 드래그로 방문 순서 조정
- 코드 직접 입력으로 외부 루트 다운로드

#### 섹션 B — 루트 탐색 (Route Hub)
- 필터 패널 + 루트 카드 리스트
- 카드 클릭 시 상세 모달: 루트 정보 / 추천수 / 조회수 / 추천 버튼 / 내 루트로 저장

#### 섹션 C — 설정 (Settings)
- 오버레이 투명도 슬라이더
- 테마 설정 (다크 고정)
- 앱 버전 정보
- UUID 초기화 (경고 다이얼로그)
- 비공식 팬 프로젝트 고지 확인

#### 거던 진행 중 복귀 배너
```
┌──────────────────────────────────────┐
│  🗺️  거던 탐사 진행 중 — 복귀하기  →  │
└──────────────────────────────────────┘
```

### 11.3. 플레이화면 (Play Screen)

#### 레이아웃 구조

```
┌────────────────────────────────────────────────────────┐
│  ←    [루트명 선택 ▼]         [탐사 완료]  [탐사 종료]  │
├────────────────────────────────────────────────────────┤
│  [에고기프트]   [팩]                                     │
├────────────────────────────────────────────────────────┤
│                                          │
│              탭별 콘텐츠 영역              │
│                                          │
└──────────────────────────────────────────┘
```

#### 탭 1 — 에고기프트 (기본 탭)

- 루트 목표 에고기프트 전체 리스트
- 선행 조건 미충족 기프트: 🔒 잠금 배지 + 조건 표시
- 미획득 기프트: 밝게, 상단 / 획득 완료: opacity 감소 + 하단 이동
- Phase 1: 카드 탭으로 수동 토글 / Phase 2: OCR 자동 반영

#### 탭 2 — 선택지 (⚠️ Phase 1 제외)

> ⚠️ **Phase 1 제외:** 해당 탭 가이드는 Phase 1에서는 오버레이 창으로만 제공되며, 플레이 화면 탭 가이드는 제외되었습니다.

#### 탭 3 — 팩

- 루트 `pack_order` 기준 방문 계획 전체 목록
- 난이도 전환 시점 기준으로 구분선 표시

```
┌─────────────────────────────────────┐
│ ✅ 2층 · 노말 · 사랑할 수 없는       │  방문 완료
│ ─────────── 3층부터 하드 전환 ─────── │  ← 구분선
│ 🔶 4층 · 하드 · 심야청소 [전용기프트]  │  현재 목표 (Amber)
│    └ 묘각 필수 획득                  │
│ ⬜ 5층 · 하드 · LCB 정기검진         │  미방문
└─────────────────────────────────────┘
```

- 팩 한정 기프트 보유 팩: Amber 배지 강조
- 방문 완료 팩: opacity 감소 + 하단 이동
- Phase 1: 카드 탭으로 방문 여부 수동 토글

#### 팩 호환성 실시간 안내

현재 층과 현재 난이도가 `pack_order`의 다음 팩과 맞지 않을 경우 인라인 경고를 표시합니다.

```
⚠️ 심야청소는 하드 5층에서만 등장합니다.
   (현재: 4층 · 노말)
```

### 11.4. 루트 중간 변경 처리

- 변경 전 획득/방문 완료 데이터 세션에 보존
- 새 루트 목표 리스트와 기존 완료 데이터 대조 → 겹치는 항목 완료 상태 유지
- 새 루트에만 있는 미완료 항목 상단에 추가
- `route_switched_at_floor` 필드에 변경 시점 층 번호 기록

---

## 12. 디자인 시스템

### 12.1. 브랜드 컨셉

**Charcoal Black** 중심의 다크 모드 전용 팔레트. 어두운 여정을 안내하는 Amber 등불의 시각적 서사.

### 12.2. 컬러 토큰

| 토큰 | Hex | 용도 |
|---|---|---|
| `color-bg-base` | `#121315` | 메인 배경 (Deep Abyss) |
| `color-bg-surface` | `#25282C` | 카드, 팝업, 입력창 (Card Surface) |
| `color-brand` | `#1C1E21` | 로고, 네비게이션 바 (Charcoal Black) |
| `color-accent` | `#E67E22` | 활성 상태, CTA, 최적 선택지 하이라이트 (Flame Amber) |
| `color-text-primary` | `#E1E4E6` | 본문, 헤드라인 (Ash White) |
| `color-text-muted` | `#90969D` | 힌트 텍스트, 부제목 (Muted Slate) |

> 📌 Muted Slate는 원안 `#888E95`에서 `#90969D`로 조정. Card Surface 위 WCAG AA 기준 미달(4.48) 수정 (→ 4.96)

### 12.3. 명도 대비 검증 결과 (WCAG 2.1)

| 조합 | 대비비 | AA (4.5) | AA Large (3.0) | AAA (7.0) |
|---|---|---|---|---|
| 본문 텍스트 on 메인 배경 | 14.55 | ✅ | ✅ | ✅ |
| 본문 텍스트 on 카드 | 11.59 | ✅ | ✅ | ✅ |
| 힌트 텍스트 on 메인 배경 | 5.62 | ✅ | ✅ | — |
| 힌트 텍스트 on 카드 | 4.96 | ✅ | ✅ | — |
| 액센트 on 메인 배경 | 6.53 | ✅ | ✅ | — |
| 액센트 on 카드 | 5.20 | ✅ | ✅ | — |
| 액센트 on 브랜드색 | 5.86 | ✅ | ✅ | — |
| 본문 텍스트 on 브랜드색 | 13.08 | ✅ | ✅ | ✅ |

### 12.4. 키워드 배지 색상

| 키워드 | 색상 |
|---|---|
| 화상 | `#E74C3C` |
| 출혈 | `#C0392B` |
| 진동 | `#9B59B6` |
| 파열 | `#E67E22` |
| 침잠 | `#2980B9` |
| 호흡 | `#27AE60` |
| 충전 | `#F39C12` |
| 참격 | `#7F8C8D` |
| 관통 | `#1ABC9C` |
| 타격 | `#D35400` |
| 범용 | `#90969D` |

### 12.5. 난이도 배지 색상

| 난이도 | 색상 | 용도 |
|---|---|---|
| 노말 | `#27AE60` | 노말 전용 팩, 루트 난이도 표시 |
| 하드 | `#E67E22` | 하드 전용 팩, 난이도 전환 구분선 |
| EXTREME | `#C0392B` | EXTREME 전용 팩 |
| 히든 | `#9B59B6` | 히든 팩 배지 |

### 12.6. UI 적용 가이드

**스플래시:** `color-bg-base` 배경에 `color-text-primary` 로고.

**네비게이션:** `color-brand` 배경, 활성 메뉴만 `color-accent` 점등.

**버튼:** 보조 버튼은 `color-bg-surface` 계열, 핵심 CTA에만 `color-accent` 적용.

**에고기프트 / 팩 상태:**
- 미완료: 정상 밝기
- 완료: opacity 0.35 + 하단 배치
- 선행 미충족: 🔒 + `color-text-muted`

**난이도 전환 구분선:** 하드 배지 색상(`#E67E22`)의 얇은 구분선 + "N층부터 하드 전환" 레이블.

---

## 📜 License

본 프로젝트는 **MIT License** 하에 배포됩니다.

### ⚠️ 비공식 팬 프로젝트 고지

본 프로젝트는 Project Moon의 팬이 제작한 **비공식 서드파티 도구**입니다.
림버스 컴퍼니(Limbus Company)의 저작권 및 관련 지식재산권 일체는 **Project Moon**에 귀속됩니다.
본 프로젝트는 Project Moon과 공식적인 제휴 또는 후원 관계가 없으며, 어떠한 상업적 목적으로도 사용되지 않습니다.

> This project is an unofficial fan-made tool and is not affiliated with, endorsed by, or sponsored by Project Moon.
> All rights to Limbus Company and related intellectual property belong to Project Moon.

---

*This document is the living specification of the Guida project.*